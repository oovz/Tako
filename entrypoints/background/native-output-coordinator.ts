import logger from "@/src/runtime/logger"
import type {
  RuntimeMessageRequest,
  RuntimeMessageResponse,
} from "@/src/runtime/runtime-message-contracts"
import {
  isNativeOutputAcceptanceProvenAbsent,
  isNativeOutputLive,
  isNativeOutputTerminal,
  isNativeOutputUnobservable,
  nativeOutputIdentityMatches,
  nativeOutputJobIdentityMatches,
  type NativeOutputIdentity,
  type NativeOutputJobIdentity,
  type NativeOutputManifest,
  type NativeOutputRecord,
} from "@/src/domain/native-output/state"
import { isTerminalDownloadTask } from "@/src/domain/queue/task-lifecycle"
import type { OffscreenJobState } from "@/src/runtime/offscreen-job-contracts"
import type { QueueRepository } from "@/src/storage/queue-repository"
import type { NativeOutputRepository } from "@/src/storage/native-output-repository"
import type { SettingsRepository } from "@/src/storage/settings-repository"

type OutputReadyPayload =
  RuntimeMessageRequest<"OFFSCREEN_OUTPUT_READY">["payload"]
type OutputReadyResponse = RuntimeMessageResponse<"OFFSCREEN_OUTPUT_READY">

export interface NativeOutputCoordinatorDependencies {
  settingsRepository: Pick<SettingsRepository, "getSettings">
  repository: NativeOutputRepository
  queueRepository: QueueRepository
  queryOffscreenJob: (
    identity: NativeOutputJobIdentity
  ) => Promise<OffscreenJobState | null>
  requestBlobRevocation: (
    record: Pick<
      NativeOutputRecord,
      | "jobId"
      | "attempt"
      | "taskId"
      | "chapterId"
      | "fingerprint"
      | "documentInstanceId"
      | "outputId"
      | "blobUrl"
    >
  ) => Promise<void>
  ensureLivenessAlarm: () => Promise<void>
  onQueueSettlement: (taskId: string) => Promise<void>
  activateQueue: () => Promise<void>
}

function toIdentity(payload: OutputReadyPayload): NativeOutputIdentity {
  return {
    jobId: payload.jobId,
    attempt: payload.attempt,
    taskId: payload.taskId,
    chapterId: payload.chapterId,
    fingerprint: payload.fingerprint,
    documentInstanceId: payload.documentInstanceId,
    outputId: payload.outputId,
    outputIndex: payload.outputIndex,
    outputCount: payload.outputCount,
    blobUrl: payload.fileUrl,
    filename: payload.filename,
    outputKind: payload.outputKind,
  }
}

function trackedResponse(record: NativeOutputRecord): OutputReadyResponse {
  if (record.phase === "complete" || record.phase === "interrupted") {
    return {
      success: true,
      disposition: "tracked",
      phase: record.phase,
      terminalOutcome: record.phase,
    }
  }
  return { success: true, disposition: "tracked", phase: record.phase }
}

function notPersistedResponse(reason: string): OutputReadyResponse {
  return { success: true, disposition: "not_persisted", reason }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isPositiveDownloadId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
}

function manifestTrackedOutputIds(manifest: NativeOutputManifest): string[] {
  return manifest.slots.flatMap((slot) =>
    slot?.disposition === "tracked" ? [slot.outputId] : []
  )
}

/**
 * Sole owner of native Chrome Downloads state and its durable reconciliation.
 * Every public command is serialized so API acceptance, event observation,
 * queue settlement, and Blob release cannot interleave stale snapshots.
 */
export class NativeOutputCoordinator {
  private tail: Promise<void> = Promise.resolve()

  constructor(private readonly deps: NativeOutputCoordinatorDependencies) {}

  private async serialized<TResult>(
    operation: () => Promise<TResult>
  ): Promise<TResult> {
    const previous = this.tail
    let release!: () => void
    this.tail = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await operation()
    } finally {
      release()
    }
  }

  async initialize(): Promise<void> {
    await this.serialized(async () => {
      await this.deps.repository.initialize()
      await this.reconcileLocked()
    })
  }

  /**
   * True while any native-output record or manifest is still live. Erased
   * downloads awaiting a user decision REMAIN live: the offscreen document
   * owns their Blob URL and must not be closed before terminal state or
   * explicit surrender.
   */
  async hasLiveDependencies(): Promise<boolean> {
    return await this.deps.repository.hasLiveDependencies()
  }

  /**
   * True while durable work exists that can progress WITHOUT user action.
   * Erased downloads blocked behind `native_output_action_required` are
   * excluded: their only next step is the user's forget/cancel decision, so
   * the crash-recovery alarm must not re-arm forever for them.
   */
  async hasReconcilableLiveDependencies(): Promise<boolean> {
    if (!(await this.deps.repository.hasLiveDependencies())) return false
    const [snapshot, queue] = await Promise.all([
      this.deps.repository.snapshot(),
      this.deps.queueRepository.getQueue(),
    ])
    const userPendingTaskIds = new Set(
      queue
        .filter((task) => task.activeBlock === "native_output_action_required")
        .map((task) => task.id)
    )
    const hasLiveNonUserPendingRecord = Object.values(
      snapshot.outputsByOutputId
    ).some(
      (record) =>
        isNativeOutputLive(record) &&
        !(
          isNativeOutputUnobservable(record) &&
          userPendingTaskIds.has(record.taskId)
        )
    )
    if (hasLiveNonUserPendingRecord) return true
    return Object.values(snapshot.manifestsByJobId).some(
      (manifest) =>
        manifest.dependencyReleasedAt === undefined &&
        !userPendingTaskIds.has(manifest.taskId)
    )
  }

  async getLiveTaskIds(): Promise<string[]> {
    const snapshot = await this.deps.repository.snapshot()
    return [
      ...new Set(
        Object.values(snapshot.manifestsByJobId)
          .filter((manifest) => manifest.dependencyReleasedAt === undefined)
          .map((manifest) => manifest.taskId)
      ),
    ].sort((left, right) => left.localeCompare(right))
  }

  async armLiveness(): Promise<void> {
    await this.armLivenessLocked()
  }

  async getJobPhase(
    jobId: string
  ): Promise<NativeOutputManifest["phase"] | null> {
    const snapshot = await this.deps.repository.snapshot()
    return snapshot.manifestsByJobId[jobId]?.phase ?? null
  }

  async handleOutputReady(
    payload: OutputReadyPayload
  ): Promise<OutputReadyResponse> {
    return await this.serialized(async () => {
      const identity = toIdentity(payload)
      const existing = await this.deps.repository.getByOutputId(
        identity.outputId
      )
      if (existing) {
        if (!nativeOutputIdentityMatches(existing, identity)) {
          return notPersistedResponse("output-identity-conflict")
        }
        if (existing.phase === "prepared") {
          const [lease, task] = await Promise.all([
            this.deps.queueRepository.getActiveDispatchLease(),
            this.deps.queueRepository.getTask(identity.taskId),
          ])
          if (
            !lease ||
            lease.jobId !== identity.jobId ||
            lease.attempt !== identity.attempt ||
            lease.taskId !== identity.taskId ||
            lease.chapterId !== identity.chapterId ||
            lease.fingerprint !== identity.fingerprint ||
            lease.documentInstanceId !== identity.documentInstanceId ||
            task?.status !== "downloading"
          ) {
            const interrupted =
              await this.deps.repository.interruptBeforeAcceptance({
                outputId: identity.outputId,
                error: "Output producer no longer owns an active task",
                now: Date.now(),
              })
            if (interrupted.outcome === "rejected") {
              return notPersistedResponse(interrupted.reason)
            }
            await this.reconcileJobLocked(identity.jobId)
            return trackedResponse(interrupted.record)
          }
        }
        if (existing.phase !== "prepared") {
          await this.reconcileRecordLocked(existing)
          return trackedResponse(
            (await this.deps.repository.getByOutputId(identity.outputId)) ??
              existing
          )
        }
      } else {
        const [lease, task] = await Promise.all([
          this.deps.queueRepository.getActiveDispatchLease(),
          this.deps.queueRepository.getTask(identity.taskId),
        ])
        if (
          !lease ||
          lease.jobId !== identity.jobId ||
          lease.attempt !== identity.attempt ||
          lease.taskId !== identity.taskId ||
          lease.chapterId !== identity.chapterId ||
          lease.fingerprint !== identity.fingerprint ||
          lease.documentInstanceId !== identity.documentInstanceId ||
          task?.status !== "downloading"
        ) {
          return notPersistedResponse("stale-job")
        }

        try {
          const prepared = await this.deps.repository.prepare({
            ...identity,
            now: Date.now(),
          })
          if (prepared.outcome === "rejected") {
            return notPersistedResponse(prepared.reason)
          }
        } catch (error) {
          return notPersistedResponse(errorMessage(error))
        }
      }

      let record = await this.deps.repository.getByOutputId(identity.outputId)
      if (!record) return notPersistedResponse("prepared-record-missing")
      if (record.phase !== "prepared") return trackedResponse(record)

      try {
        const marked = await this.deps.repository.markAcceptanceUnknown({
          outputId: identity.outputId,
          now: Date.now(),
        })
        if (marked.outcome === "rejected") {
          await this.armLivenessLocked()
          return trackedResponse(record)
        }
        record = marked.record
      } catch (error) {
        logger.warn(
          "Native output remains prepared; acceptance was not attempted",
          {
            outputId: identity.outputId,
            error,
          }
        )
        await this.armLivenessLocked()
        return trackedResponse(record)
      }

      let acceptedId: unknown
      try {
        const settings = await this.deps.settingsRepository.getSettings()
        const [task, lease] = await Promise.all([
          this.deps.queueRepository.getTask(identity.taskId),
          this.deps.queueRepository.getActiveDispatchLease(),
        ])
        if (
          task?.status !== "downloading" ||
          !task.chapters.some(
            (chapter) =>
              chapter.id === identity.chapterId &&
              chapter.status === "downloading"
          ) ||
          !lease ||
          lease.jobId !== identity.jobId ||
          lease.attempt !== identity.attempt ||
          lease.taskId !== identity.taskId ||
          lease.chapterId !== identity.chapterId ||
          lease.fingerprint !== identity.fingerprint ||
          lease.documentInstanceId !== identity.documentInstanceId
        ) {
          throw new Error("Output producer no longer owns an active task")
        }
        acceptedId = await chrome.downloads.download({
          url: identity.blobUrl,
          filename: identity.filename,
          conflictAction: task.settingsSnapshot.conflictPolicy,
          saveAs: settings.downloads.suppressSaveAsDialog === false,
        })
        if (!isPositiveDownloadId(acceptedId)) {
          throw new Error("downloads.download returned no download id")
        }
      } catch (error) {
        try {
          const interrupted =
            await this.deps.repository.interruptBeforeAcceptance({
              outputId: identity.outputId,
              error: errorMessage(error),
              now: Date.now(),
            })
          if (interrupted.outcome !== "rejected") {
            record = interrupted.record
          } else {
            await this.armLivenessLocked()
          }
        } catch (persistenceError) {
          logger.warn(
            "Native output remains in acceptance-unknown safety quarantine",
            {
              outputId: identity.outputId,
              persistenceError,
            }
          )
          await this.armLivenessLocked()
        }
        await this.reconcileJobLocked(identity.jobId)
        return trackedResponse(record)
      }

      try {
        const attached = await this.deps.repository.attachDownload({
          outputId: identity.outputId,
          downloadId: acceptedId,
        })
        if (attached.outcome !== "rejected") record = attached.record
      } catch (error) {
        logger.warn("Native download ID persistence will be reconciled", {
          outputId: identity.outputId,
          downloadId: acceptedId,
          error,
        })
        await this.armLivenessLocked()
        return trackedResponse(record)
      }

      await this.reconcileRecordLocked(record)
      return trackedResponse(
        (await this.deps.repository.getByOutputId(identity.outputId)) ?? record
      )
    })
  }

  async sealManifest(
    input: NativeOutputJobIdentity & {
      outputsRequested: number
      outputsFailedBeforeHandoff: number
    }
  ): Promise<void> {
    await this.serialized(async () => {
      const result = await this.deps.repository.sealManifest({
        ...input,
        now: Date.now(),
        error: "Output was not durably handed to the background runtime",
      })
      if (result.outcome === "rejected") {
        throw new Error(`Native output manifest rejected: ${result.reason}`)
      }
      await this.reconcileJobLocked(input.jobId)
    })
  }

  async handleDownloadChanged(
    delta: chrome.downloads.DownloadDelta
  ): Promise<boolean> {
    return await this.serialized(async () => {
      if (typeof delta.id !== "number") return false
      const phase = delta.state?.current
      if (phase !== "complete" && phase !== "interrupted") return false
      const current = await this.deps.repository.getByDownloadId(delta.id)
      if (!current) return false
      const terminal = await this.deps.repository.markTerminal({
        downloadId: delta.id,
        phase,
        now: Date.now(),
        error: delta.error?.current,
      })
      if (terminal.outcome === "rejected") return false
      await this.reconcileJobLocked(terminal.record.jobId)
      return true
    })
  }

  async handleDownloadErased(downloadId: number): Promise<boolean> {
    return await this.serialized(async () => {
      const current = await this.deps.repository.getByDownloadId(downloadId)
      if (!current) return false
      const result = await this.deps.repository.observeErased({
        downloadId,
        now: Date.now(),
      })
      if (result.outcome === "rejected") return false
      const record = await this.deps.repository.getByOutputId(
        result.record.outputId
      )
      if (record) await this.blockTaskForUnobservableLocked(record)
      return true
    })
  }

  async reconcile(): Promise<void> {
    await this.serialized(async () => await this.reconcileLocked())
  }

  async reconcileStartupOpenManifests(input: {
    offscreenJob: OffscreenJobState | null
    activeLease: NativeOutputJobIdentity | null
  }): Promise<{ observedJobSealed: boolean }> {
    return await this.serialized(async () => {
      const snapshot = await this.deps.repository.snapshot()
      const openManifests = Object.values(snapshot.manifestsByJobId).filter(
        (manifest) => manifest.phase === "open"
      )

      if (input.offscreenJob === null) {
        for (const manifest of openManifests) {
          await this.sealStoppedOpenManifestLocked({
            identity: manifest,
            error: "Offscreen producer was absent during startup recovery",
          })
        }
        return { observedJobSealed: false }
      }

      const manifest = Object.values(snapshot.manifestsByJobId).find(
        (candidate) =>
          nativeOutputJobIdentityMatches(candidate, input.offscreenJob!)
      )
      if (!manifest) return { observedJobSealed: false }

      if (input.offscreenJob.status === "active") {
        if (manifest.phase === "sealed") {
          logger.warn(
            "Exact active offscreen producer conflicts with a sealed native output manifest; lease remains owned",
            { jobId: manifest.jobId, taskId: manifest.taskId }
          )
          await this.armLivenessLocked()
          return { observedJobSealed: false }
        }
        if (
          input.activeLease === null ||
          !nativeOutputJobIdentityMatches(input.activeLease, input.offscreenJob)
        ) {
          logger.warn(
            "Exact active offscreen producer has no matching startup lease; manifest remains open",
            { jobId: manifest.jobId, taskId: manifest.taskId }
          )
          await this.armLivenessLocked()
        }
        return { observedJobSealed: false }
      }

      if (manifest.phase === "sealed") {
        return { observedJobSealed: true }
      }

      if (input.offscreenJob.status === "terminal") {
        const sealed = await this.sealStoppedOpenManifestLocked({
          identity: manifest,
          error:
            "Offscreen producer stopped before every output was handed off",
        })
        return { observedJobSealed: sealed }
      }

      const sealed = await this.sealStoppedOpenManifestLocked({
        identity: manifest,
        error:
          "Offscreen producer was canceled before every output was handed off",
      })
      return { observedJobSealed: sealed }
    })
  }

  async cancelTask(
    taskId: string,
    canceledJob?: NativeOutputJobIdentity
  ): Promise<void> {
    await this.serialized(async () => {
      if (!canceledJob) {
        // The queue task is already durably canceled. Erased downloads that
        // were waiting for the user's forget confirmation cannot settle on
        // their own: surrender them so Blob ownership and queue accounting
        // are released instead of leaking for the task's lifetime.
        try {
          await this.surrenderTaskUnobservableLocked(taskId)
        } catch (error) {
          logger.warn(
            "Unobservable native output surrender failed during cancellation",
            { taskId, error }
          )
        }
        await this.armLivenessLocked()
        return
      }
      try {
        if (canceledJob.taskId !== taskId) {
          throw new Error("Canceled native output identity does not match task")
        }
        await this.sealStoppedOpenManifestLocked({
          identity: canceledJob,
          error: "Download task canceled before every output was handed off",
        })
      } catch (error) {
        await this.armLivenessLocked()
        throw error
      }
    })
  }

  /**
   * Task-wide FORGET_UNOBSERVABLE_OUTPUTS command. Surrenders every waiting
   * output whose Chrome download was erased, releases the task's
   * action-required block so the queue can continue, and reconciles each
   * affected job (Blob revocation, settlement, dependency release). A replay
   * after an already-applied forget converges with `surrendered: 0`.
   */
  async forgetTaskUnobservableOutputs(
    taskId: string
  ): Promise<{ surrendered: number }> {
    return await this.serialized(async () => {
      const surrendered = await this.surrenderTaskUnobservableLocked(taskId)
      if (surrendered === 0) {
        return { surrendered }
      }
      const released =
        await this.deps.queueRepository.releaseNativeOutputActionBlock(taskId)
      if (released.outcome === "applied") {
        await this.deps.activateQueue()
      }
      return { surrendered }
    })
  }

  /**
   * Set the durable action-required block on the record's task so the queue
   * stops and the UI can offer the forget/cancel decision. When the task is
   * already terminal (or gone) there is nobody to ask, so the unobservable
   * output is surrendered immediately instead of leaking forever.
   *
   * Returns true when the block is durably in place (reconciliation can stop
   * arming the liveness alarm for this record).
   */
  private async blockTaskForUnobservableLocked(
    record: NativeOutputRecord
  ): Promise<boolean> {
    if (!isNativeOutputUnobservable(record)) return false
    const transition =
      await this.deps.queueRepository.blockTaskForNativeOutputAction({
        taskId: record.taskId,
        errorMessage:
          "A browser download was erased from Chrome history; its result can no longer be observed.",
      })
    if (
      transition.outcome === "applied" ||
      transition.outcome === "unchanged"
    ) {
      return true
    }
    const task = await this.deps.queueRepository.getTask(record.taskId)
    if (!task || isTerminalDownloadTask(task)) {
      await this.surrenderTaskUnobservableLocked(record.taskId)
    }
    return false
  }

  private async surrenderTaskUnobservableLocked(
    taskId: string
  ): Promise<number> {
    const snapshot = await this.deps.repository.snapshot()
    const manifests = Object.values(snapshot.manifestsByJobId).filter(
      (manifest) => manifest.taskId === taskId
    )
    let surrendered = 0
    for (const manifest of manifests) {
      for (const outputId of manifestTrackedOutputIds(manifest)) {
        const record = snapshot.outputsByOutputId[outputId]
        if (!record || !isNativeOutputUnobservable(record)) continue
        const result = await this.deps.repository.markSurrendered({
          outputId,
          now: Date.now(),
        })
        if (result.outcome === "rejected") {
          throw new Error(`Native output surrender rejected: ${result.reason}`)
        }
        surrendered += 1
      }
      if (surrendered > 0) await this.reconcileJobLocked(manifest.jobId)
    }
    return surrendered
  }

  private async sealStoppedOpenManifestLocked(input: {
    identity: NativeOutputJobIdentity
    error: string
  }): Promise<boolean> {
    const snapshot = await this.deps.repository.snapshot()
    const manifest = snapshot.manifestsByJobId[input.identity.jobId]
    if (!manifest || manifest.phase !== "open") return false
    if (!nativeOutputJobIdentityMatches(manifest, input.identity)) return false

    const nullSlotCount = manifest.slots.filter((slot) => slot === null).length

    for (const outputId of manifestTrackedOutputIds(manifest)) {
      const record = snapshot.outputsByOutputId[outputId]
      if (record?.phase !== "prepared") continue
      const interrupted = await this.deps.repository.interruptBeforeAcceptance({
        outputId,
        error: input.error,
        now: Date.now(),
      })
      if (interrupted.outcome === "rejected") {
        throw new Error(
          `Native output interruption rejected: ${interrupted.reason}`
        )
      }
    }

    const sealed = await this.deps.repository.sealManifest({
      ...input.identity,
      outputsRequested: manifest.outputsRequested,
      outputsFailedBeforeHandoff: nullSlotCount,
      now: Date.now(),
      error: input.error,
    })
    if (sealed.outcome === "rejected") {
      throw new Error(`Native output manifest rejected: ${sealed.reason}`)
    }
    await this.reconcileJobLocked(manifest.jobId)

    const refreshed = await this.deps.repository.snapshot()
    const needsObservation = manifestTrackedOutputIds(manifest).some(
      (outputId) => {
        const phase = refreshed.outputsByOutputId[outputId]?.phase
        return phase === "acceptance_unknown" || phase === "waiting"
      }
    )
    if (needsObservation) await this.armLivenessLocked()
    return true
  }

  private async reconcileLocked(): Promise<void> {
    const initial = await this.deps.repository.snapshot()
    for (const manifest of Object.values(initial.manifestsByJobId)) {
      if (manifest.phase !== "open") continue
      const identity = {
        jobId: manifest.jobId,
        attempt: manifest.attempt,
        taskId: manifest.taskId,
        chapterId: manifest.chapterId,
        fingerprint: manifest.fingerprint,
        documentInstanceId: manifest.documentInstanceId,
      }

      let observedJob: OffscreenJobState | null
      try {
        observedJob = await this.deps.queryOffscreenJob(identity)
      } catch (error) {
        logger.warn("Unable to query an open native output producer", {
          jobId: manifest.jobId,
          error,
        })
        await this.armLivenessLocked()
        continue
      }
      if (
        observedJob !== null &&
        !nativeOutputJobIdentityMatches(manifest, observedJob)
      ) {
        logger.warn("Exact native output producer query returned a mismatch", {
          jobId: manifest.jobId,
          observedJobId: observedJob.jobId,
        })
        await this.armLivenessLocked()
        continue
      }
      if (observedJob?.status === "active") continue

      const error =
        observedJob?.status === "canceled"
          ? "Offscreen producer was canceled before every output was handed off"
          : observedJob?.status === "terminal"
            ? "Offscreen producer stopped before every output was handed off"
            : "Offscreen producer was absent during native output reconciliation"
      try {
        await this.sealStoppedOpenManifestLocked({
          identity,
          error,
        })
      } catch (sealError) {
        logger.warn("Unable to seal an exact stopped native output producer", {
          jobId: manifest.jobId,
          error: sealError,
        })
        await this.armLivenessLocked()
      }
    }

    const snapshot = await this.deps.repository.snapshot()
    for (const record of Object.values(snapshot.outputsByOutputId)) {
      await this.reconcileRecordLocked(record)
    }
    for (const jobId of Object.keys(snapshot.manifestsByJobId)) {
      await this.reconcileJobLocked(jobId)
    }
  }

  private async reconcileRecordLocked(
    record: NativeOutputRecord
  ): Promise<void> {
    const current = await this.deps.repository.getByOutputId(record.outputId)
    if (!current) return

    if (current.phase === "acceptance_unknown") {
      const matches = await chrome.downloads.search({ url: current.blobUrl })
      const snapshot = await this.deps.repository.snapshot()
      const claimedIds = new Set(
        Object.values(snapshot.outputsByOutputId).flatMap((candidate) =>
          candidate.downloadId === undefined ? [] : [candidate.downloadId]
        )
      )
      const exactUnclaimed = matches.filter(
        (item) =>
          isPositiveDownloadId(item.id) &&
          item.url === current.blobUrl &&
          !claimedIds.has(item.id)
      )
      if (exactUnclaimed.length === 1) {
        const candidate = exactUnclaimed[0]
        const attached = await this.deps.repository.attachDownload({
          outputId: current.outputId,
          downloadId: candidate.id,
        })
        if (attached.outcome !== "rejected") {
          await this.observeDownloadItemLocked(attached.record, candidate)
        }
      } else {
        await this.armLivenessLocked()
      }
      return
    }

    if (current.phase === "waiting" && current.downloadId !== undefined) {
      const items = await chrome.downloads.search({ id: current.downloadId })
      const item = items.find(
        (candidate) => candidate.id === current.downloadId
      )
      if (item) {
        await this.observeDownloadItemLocked(current, item)
      } else {
        const erased = await this.deps.repository.observeErased({
          downloadId: current.downloadId,
          now: Date.now(),
        })
        if (erased.outcome !== "rejected") {
          const record = await this.deps.repository.getByOutputId(
            erased.record.outputId
          )
          if (record) {
            const blocked = await this.blockTaskForUnobservableLocked(record)
            if (!blocked) await this.armLivenessLocked()
          }
        } else {
          await this.armLivenessLocked()
        }
      }
    }
  }

  private async observeDownloadItemLocked(
    record: NativeOutputRecord,
    item: chrome.downloads.DownloadItem
  ): Promise<void> {
    if (item.state !== "complete" && item.state !== "interrupted") return
    await this.deps.repository.markTerminal({
      downloadId: item.id,
      phase: item.state,
      now: Date.now(),
      error: item.error,
    })
    await this.reconcileJobLocked(record.jobId)
  }

  private async reconcileJobLocked(jobId: string): Promise<void> {
    let snapshot = await this.deps.repository.snapshot()
    let manifest = snapshot.manifestsByJobId[jobId]
    if (!manifest) return

    if (manifest.phase === "sealed") {
      const preparedOutputIds = manifestTrackedOutputIds(manifest).filter(
        (outputId) => snapshot.outputsByOutputId[outputId]?.phase === "prepared"
      )
      for (const outputId of preparedOutputIds) {
        const interrupted =
          await this.deps.repository.interruptBeforeAcceptance({
            outputId,
            error: "Native output was not accepted before manifest sealing",
            now: Date.now(),
          })
        if (interrupted.outcome === "rejected") {
          throw new Error(
            `Native output interruption rejected: ${interrupted.reason}`
          )
        }
      }
      if (preparedOutputIds.length > 0) {
        snapshot = await this.deps.repository.snapshot()
        manifest = snapshot.manifestsByJobId[jobId]
        if (!manifest) return
      }
    }

    const outputIds = manifestTrackedOutputIds(manifest)
    const records = outputIds.flatMap((outputId) => {
      const record = snapshot.outputsByOutputId[outputId]
      return record ? [record] : []
    })
    let settlementResolved = false

    if (
      manifest.phase === "sealed" &&
      records.length === outputIds.length &&
      records.every(
        (record) =>
          isNativeOutputTerminal(record) || record.phase === "surrendered"
      )
    ) {
      const completed = records.filter(
        (record) => record.phase === "complete"
      ).length
      const surrendered = records.filter(
        (record) => record.phase === "surrendered"
      ).length
      const interrupted = manifest.outputsRequested - completed - surrendered
      const lastSuccessfulDownloadId = records.reduce<number | undefined>(
        (latest, record) =>
          record.phase === "complete" &&
          record.downloadId !== undefined &&
          (latest === undefined || record.downloadId > latest)
            ? record.downloadId
            : latest,
        undefined
      )
      const settlement =
        await this.deps.queueRepository.applyNativeOutputSettlement({
          jobId: manifest.jobId,
          attempt: manifest.attempt,
          taskId: manifest.taskId,
          chapterId: manifest.chapterId,
          requested: manifest.outputsRequested,
          completed,
          interrupted,
          surrendered,
          lastSuccessfulDownloadId,
          now: Date.now(),
        })
      const disposition =
        settlement.outcome === "applied" ||
        settlement.outcome === "already_applied"
          ? "accounted"
          : settlement.outcome === "not_owner"
            ? "not_owner"
            : undefined
      if (disposition) {
        settlementResolved = true
        for (const record of records) {
          await this.deps.repository.markAccountingDisposition({
            outputId: record.outputId,
            disposition,
            now: Date.now(),
          })
        }
        if (
          settlement.outcome === "applied" ||
          settlement.outcome === "already_applied"
        ) {
          await this.deps.onQueueSettlement(manifest.taskId)
        }
      } else {
        await this.armLivenessLocked()
      }
    }

    const refreshed = await this.deps.repository.snapshot()
    const refreshedManifest = refreshed.manifestsByJobId[jobId]
    if (!refreshedManifest) return
    const refreshedRecords = manifestTrackedOutputIds(
      refreshedManifest
    ).flatMap((outputId) => {
      const record = refreshed.outputsByOutputId[outputId]
      return record ? [record] : []
    })
    for (const record of refreshedRecords) {
      const canRelease =
        (record.phase !== "prepared" &&
          isNativeOutputAcceptanceProvenAbsent(record)) ||
        (isNativeOutputTerminal(record) &&
          record.accountingDisposition !== "pending")
      if (!canRelease) continue
      if (record.blobReleasedAt === undefined) {
        try {
          await this.deps.requestBlobRevocation(record)
          await this.deps.repository.markBlobReleased({
            outputId: record.outputId,
            now: Date.now(),
          })
        } catch (error) {
          logger.warn("Native output Blob release will be retried", {
            outputId: record.outputId,
            error,
          })
          await this.armLivenessLocked()
          continue
        }
      }
      const released = await this.deps.repository.getByOutputId(record.outputId)
      if (
        released &&
        (isNativeOutputTerminal(released) ||
          released.phase === "surrendered") &&
        released.accountingDisposition !== "pending" &&
        released.blobReleasedAt !== undefined &&
        released.dependencyReleasedAt === undefined
      ) {
        await this.deps.repository.markDependencyReleased({
          outputId: released.outputId,
          now: Date.now(),
        })
      }
    }

    const finalState = await this.deps.repository.snapshot()
    const finalManifest = finalState.manifestsByJobId[jobId]
    const finalOutputIds = finalManifest
      ? manifestTrackedOutputIds(finalManifest)
      : []
    // Released output records are pruned from durable storage, so absence of a
    // tracked output is itself release proof.
    const allTrackedDependenciesReleased = finalOutputIds.every((outputId) => {
      const record = finalState.outputsByOutputId[outputId]
      return record === undefined || record.dependencyReleasedAt !== undefined
    })
    const chapterSettlement = await this.deps.queueRepository
      .getTask(manifest.taskId)
      .then(
        (task) =>
          task?.chapters.find((chapter) => chapter.id === manifest.chapterId)
            ?.nativeOutputSettlement
      )
    const queueSettlementProven =
      chapterSettlement !== undefined &&
      chapterSettlement.jobId === manifest.jobId &&
      chapterSettlement.attempt === manifest.attempt
    if (
      finalManifest?.phase === "sealed" &&
      finalManifest.dependencyReleasedAt === undefined &&
      allTrackedDependenciesReleased &&
      (settlementResolved || queueSettlementProven)
    ) {
      await this.deps.repository.markJobDependencyReleased({
        jobId,
        now: Date.now(),
      })
    }
  }

  private async armLivenessLocked(): Promise<void> {
    try {
      await this.deps.ensureLivenessAlarm()
    } catch (error) {
      logger.warn("Unable to arm native output reconciliation", error)
    }
  }
}
