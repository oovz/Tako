import logger from "@/src/runtime/logger"
import {
  isNativeOutputAcceptanceProvenAbsent,
  isNativeOutputLive,
  isNativeOutputTerminal,
  isNativeOutputUnobservable,
  nativeOutputIdentityMatches,
  nativeOutputJobIdentityMatches,
  type NativeOutputJobIdentity,
  type NativeOutputManifest,
  type NativeOutputRecord,
} from "@/src/domain/native-output/state"
import { isTerminalDownloadTask } from "@/src/domain/queue/task-lifecycle"
import type { OffscreenJobState } from "@/src/runtime/offscreen-job-contracts"
import type { QueueRepository } from "@/src/storage/queue-repository"
import type { NativeOutputRepository } from "@/src/storage/native-output-repository"
import type { SettingsRepository } from "@/src/storage/settings-repository"

import {
  toIdentity,
  trackedResponse,
  notPersistedResponse,
  errorMessage,
  isValidDownloadId,
  manifestTrackedOutputIds,
  calculateNativeOutputSettlementStats,
  classifyProducerStoppedError,
  type OutputReadyPayload,
  type OutputReadyResponse,
} from "./native-output-coordinator-helpers"

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
}

export interface NativeOutputSettlementEffect {
  jobId: string
  attempt: number
  taskId: string
  chapterId: string
}

export type NativeOutputSettlementEffects =
  readonly NativeOutputSettlementEffect[]

export interface NativeOutputForgetResult {
  surrendered: number
  effects: NativeOutputSettlementEffects
  queueCanContinue: boolean
}

function addSettlementEffect(
  effects: NativeOutputSettlementEffect[],
  effect: NativeOutputSettlementEffect
): void {
  if (
    !effects.some(
      (candidate) =>
        candidate.jobId === effect.jobId &&
        candidate.attempt === effect.attempt &&
        candidate.taskId === effect.taskId &&
        candidate.chapterId === effect.chapterId
    )
  ) {
    effects.push(effect)
  }
}

function addSettlementEffects(
  effects: NativeOutputSettlementEffect[],
  additions: NativeOutputSettlementEffects
): void {
  for (const effect of additions) addSettlementEffect(effects, effect)
}

function settlementEffect(
  identity: Pick<
    NativeOutputManifest,
    "jobId" | "attempt" | "taskId" | "chapterId"
  >
): NativeOutputSettlementEffect {
  return {
    jobId: identity.jobId,
    attempt: identity.attempt,
    taskId: identity.taskId,
    chapterId: identity.chapterId,
  }
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

  async initialize(): Promise<NativeOutputSettlementEffects> {
    return await this.serialized(async () => {
      await this.deps.repository.initialize()
      return await this.reconcileLocked()
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

  async handleOutputReady(payload: OutputReadyPayload): Promise<{
    response: OutputReadyResponse
    effects: NativeOutputSettlementEffects
  }> {
    return await this.serialized(async () => {
      const effects: NativeOutputSettlementEffect[] = []
      const respond = (response: OutputReadyResponse) => ({
        response,
        effects,
      })
      const identity = toIdentity(payload)
      const existing = await this.deps.repository.getByOutputId(
        identity.outputId
      )
      if (existing) {
        if (!nativeOutputIdentityMatches(existing, identity)) {
          return respond(notPersistedResponse("output-identity-conflict"))
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
              return respond(notPersistedResponse(interrupted.reason))
            }
            addSettlementEffects(
              effects,
              await this.reconcileJobLocked(identity.jobId)
            )
            return respond(trackedResponse(interrupted.record))
          }
        }
        if (existing.phase !== "prepared") {
          addSettlementEffects(
            effects,
            await this.reconcileRecordLocked(existing)
          )
          return respond(
            trackedResponse(
              (await this.deps.repository.getByOutputId(identity.outputId)) ??
                existing
            )
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
          return respond(notPersistedResponse("stale-job"))
        }

        try {
          const prepared = await this.deps.repository.prepare({
            ...identity,
            now: Date.now(),
          })
          if (prepared.outcome === "rejected") {
            return respond(notPersistedResponse(prepared.reason))
          }
        } catch (error) {
          return respond(notPersistedResponse(errorMessage(error)))
        }
      }

      let record = await this.deps.repository.getByOutputId(identity.outputId)
      if (!record)
        return respond(notPersistedResponse("prepared-record-missing"))
      if (record.phase !== "prepared") return respond(trackedResponse(record))

      try {
        const marked = await this.deps.repository.markAcceptanceUnknown({
          outputId: identity.outputId,
          now: Date.now(),
        })
        if (marked.outcome === "rejected") {
          await this.armLivenessLocked()
          return respond(trackedResponse(record))
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
        return respond(trackedResponse(record))
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
        if (!isValidDownloadId(acceptedId)) {
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
        addSettlementEffects(
          effects,
          await this.reconcileJobLocked(identity.jobId)
        )
        return respond(trackedResponse(record))
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
        return respond(trackedResponse(record))
      }

      addSettlementEffects(effects, await this.reconcileRecordLocked(record))
      return respond(
        trackedResponse(
          (await this.deps.repository.getByOutputId(identity.outputId)) ??
            record
        )
      )
    })
  }

  async sealManifest(
    input: NativeOutputJobIdentity & {
      outputsRequested: number
      outputsFailedBeforeHandoff: number
    }
  ): Promise<void> {
    await this.serialized(async () => await this.sealManifestLocked(input))
  }

  private async sealManifestLocked(
    input: NativeOutputJobIdentity & {
      outputsRequested: number
      outputsFailedBeforeHandoff: number
    }
  ): Promise<void> {
    const result = await this.deps.repository.sealManifest({
      ...input,
      now: Date.now(),
      error: "Output was not durably handed to the background runtime",
    })
    if (result.outcome === "rejected") {
      throw new Error(`Native output manifest rejected: ${result.reason}`)
    }
  }

  async handleDownloadChanged(delta: chrome.downloads.DownloadDelta): Promise<{
    handled: boolean
    effects: NativeOutputSettlementEffects
  }> {
    return await this.serialized(async () => {
      const effects: NativeOutputSettlementEffect[] = []
      if (typeof delta.id !== "number") return { handled: false, effects }
      const phase = delta.state?.current
      if (phase !== "complete" && phase !== "interrupted") {
        return { handled: false, effects }
      }
      const current = await this.deps.repository.getByDownloadId(delta.id)
      if (!current) return { handled: false, effects }
      const terminal = await this.deps.repository.markTerminal({
        downloadId: delta.id,
        phase,
        now: Date.now(),
        error: delta.error?.current,
      })
      if (terminal.outcome === "rejected") {
        return { handled: false, effects }
      }
      addSettlementEffects(
        effects,
        await this.reconcileJobLocked(terminal.record.jobId)
      )
      return { handled: true, effects }
    })
  }

  async handleDownloadErased(downloadId: number): Promise<{
    handled: boolean
    effects: NativeOutputSettlementEffects
  }> {
    return await this.serialized(async () => {
      const effects: NativeOutputSettlementEffect[] = []
      const current = await this.deps.repository.getByDownloadId(downloadId)
      if (!current) return { handled: false, effects }
      const result = await this.deps.repository.observeErased({
        downloadId,
        now: Date.now(),
      })
      if (result.outcome === "rejected") return { handled: false, effects }
      const record = await this.deps.repository.getByOutputId(
        result.record.outputId
      )
      if (record) {
        const blocked = await this.blockTaskForUnobservableLocked(record)
        addSettlementEffects(effects, blocked.effects)
      }
      return { handled: true, effects }
    })
  }

  async reconcile(): Promise<NativeOutputSettlementEffects> {
    return await this.serialized(async () => await this.reconcileLocked())
  }

  async acknowledgeSettlement(
    effect: NativeOutputSettlementEffect
  ): Promise<void> {
    await this.serialized(async () => {
      const snapshot = await this.deps.repository.snapshot()
      const manifest = snapshot.manifestsByJobId[effect.jobId]
      if (!manifest) return
      if (
        manifest.phase !== "sealed" ||
        manifest.attempt !== effect.attempt ||
        manifest.taskId !== effect.taskId ||
        manifest.chapterId !== effect.chapterId
      ) {
        return
      }

      // Released native dependencies are durable proof of resolved accounting.
      // Queue history may have been removed after the continuation was emitted.
      const allTrackedDependenciesReleased = manifestTrackedOutputIds(
        manifest
      ).every((outputId) => {
        const record = snapshot.outputsByOutputId[outputId]
        return record === undefined || record.dependencyReleasedAt !== undefined
      })
      if (!allTrackedDependenciesReleased) return

      await this.deps.repository.markJobDependencyReleased({
        jobId: effect.jobId,
        now: Date.now(),
      })
    })
  }

  async reconcileStartupOpenManifests(input: {
    offscreenJob: OffscreenJobState | null
    activeLease: NativeOutputJobIdentity | null
  }): Promise<{
    observedJobSealed: boolean
    effects: NativeOutputSettlementEffects
  }> {
    return await this.serialized(async () => {
      const effects: NativeOutputSettlementEffect[] = []
      const snapshot = await this.deps.repository.snapshot()
      const openManifests = Object.values(snapshot.manifestsByJobId).filter(
        (manifest) => manifest.phase === "open"
      )

      if (input.offscreenJob === null) {
        for (const manifest of openManifests) {
          const sealed = await this.sealStoppedOpenManifestLocked({
            identity: manifest,
            error: "Offscreen producer was absent during startup recovery",
          })
          addSettlementEffects(effects, sealed.effects)
        }
        return { observedJobSealed: false, effects }
      }

      const manifest = Object.values(snapshot.manifestsByJobId).find(
        (candidate) =>
          nativeOutputJobIdentityMatches(candidate, input.offscreenJob!)
      )
      if (!manifest) return { observedJobSealed: false, effects }

      if (input.offscreenJob.status === "active") {
        if (manifest.phase === "sealed") {
          logger.warn(
            "Exact active offscreen producer conflicts with a sealed native output manifest; lease remains owned",
            { jobId: manifest.jobId, taskId: manifest.taskId }
          )
          await this.armLivenessLocked()
          return { observedJobSealed: false, effects }
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
        return { observedJobSealed: false, effects }
      }

      if (manifest.phase === "sealed") {
        return { observedJobSealed: true, effects }
      }

      if (input.offscreenJob.status === "terminal") {
        const sealed = await this.sealStoppedOpenManifestLocked({
          identity: manifest,
          error:
            "Offscreen producer stopped before every output was handed off",
        })
        addSettlementEffects(effects, sealed.effects)
        return { observedJobSealed: sealed.sealed, effects }
      }

      const sealed = await this.sealStoppedOpenManifestLocked({
        identity: manifest,
        error:
          "Offscreen producer was canceled before every output was handed off",
      })
      addSettlementEffects(effects, sealed.effects)
      return { observedJobSealed: sealed.sealed, effects }
    })
  }

  async cancelTask(
    taskId: string,
    canceledJob?: NativeOutputJobIdentity
  ): Promise<void> {
    const effects = await this.serialized(async () => {
      const effects: NativeOutputSettlementEffect[] = []
      if (!canceledJob) {
        // The queue task is already durably canceled. Erased downloads that
        // were waiting for the user's forget confirmation cannot settle on
        // their own: surrender them so Blob ownership and queue accounting
        // are released instead of leaking for the task's lifetime.
        try {
          const surrendered = await this.surrenderTaskUnobservableLocked(taskId)
          addSettlementEffects(effects, surrendered.effects)
        } catch (error) {
          logger.warn(
            "Unobservable native output surrender failed during cancellation",
            { taskId, error }
          )
        }
        await this.armLivenessLocked()
        return effects
      }
      try {
        if (canceledJob.taskId !== taskId) {
          throw new Error("Canceled native output identity does not match task")
        }
        const sealed = await this.sealStoppedOpenManifestLocked({
          identity: canceledJob,
          error: "Download task canceled before every output was handed off",
        })
        addSettlementEffects(effects, sealed.effects)
        // A task can be blocked for an erased browser download while it still
        // owns the producer lease. Sealing stops further handoff, but the
        // already-erased output remains unobservable until it is explicitly
        // surrendered. Cancellation is that terminal user decision.
        const surrendered = await this.surrenderTaskUnobservableLocked(taskId)
        addSettlementEffects(effects, surrendered.effects)
        await this.armLivenessLocked()
        return effects
      } catch (error) {
        await this.armLivenessLocked()
        throw error
      }
    })
    for (const effect of effects) {
      await this.acknowledgeSettlement(effect)
    }
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
  ): Promise<NativeOutputForgetResult> {
    const result = await this.serialized(async () => {
      const surrendered = await this.surrenderTaskUnobservableLocked(taskId)
      const released =
        await this.deps.queueRepository.releaseNativeOutputActionBlock(taskId)
      return {
        surrendered: surrendered.surrendered,
        effects: surrendered.effects,
        queueCanContinue:
          released.outcome === "applied" || released.outcome === "unchanged",
      }
    })
    return result
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
  ): Promise<{
    blocked: boolean
    effects: NativeOutputSettlementEffects
  }> {
    if (!isNativeOutputUnobservable(record)) {
      return { blocked: false, effects: [] }
    }
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
      return { blocked: true, effects: [] }
    }
    const task = await this.deps.queueRepository.getTask(record.taskId)
    if (!task || isTerminalDownloadTask(task)) {
      return {
        blocked: false,
        effects: (await this.surrenderTaskUnobservableLocked(record.taskId))
          .effects,
      }
    }
    return { blocked: false, effects: [] }
  }

  private async surrenderTaskUnobservableLocked(taskId: string): Promise<{
    surrendered: number
    effects: NativeOutputSettlementEffects
  }> {
    const snapshot = await this.deps.repository.snapshot()
    const manifests = Object.values(snapshot.manifestsByJobId).filter(
      (manifest) => manifest.taskId === taskId
    )
    let surrendered = 0
    const effects: NativeOutputSettlementEffect[] = []
    const jobsToReconcile = new Set<string>()
    for (const manifest of manifests) {
      jobsToReconcile.add(manifest.jobId)
      for (const outputId of manifestTrackedOutputIds(manifest)) {
        const record = snapshot.outputsByOutputId[outputId]
        if (!record) continue
        if (record.phase === "surrendered") {
          jobsToReconcile.add(manifest.jobId)
          continue
        }
        if (!isNativeOutputUnobservable(record)) continue
        const result = await this.deps.repository.markSurrendered({
          outputId,
          now: Date.now(),
        })
        if (result.outcome === "rejected") {
          throw new Error(`Native output surrender rejected: ${result.reason}`)
        }
        if (result.outcome === "applied") surrendered += 1
        jobsToReconcile.add(manifest.jobId)
      }
    }
    for (const jobId of jobsToReconcile) {
      addSettlementEffects(effects, await this.reconcileJobLocked(jobId))
    }
    return { surrendered, effects }
  }

  private async sealStoppedOpenManifestLocked(input: {
    identity: NativeOutputJobIdentity
    error: string
  }): Promise<{
    sealed: boolean
    effects: NativeOutputSettlementEffects
  }> {
    const snapshot = await this.deps.repository.snapshot()
    const manifest = snapshot.manifestsByJobId[input.identity.jobId]
    if (!manifest || manifest.phase !== "open") {
      return { sealed: false, effects: [] }
    }
    if (!nativeOutputJobIdentityMatches(manifest, input.identity)) {
      return { sealed: false, effects: [] }
    }

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
    const effects = await this.reconcileJobLocked(manifest.jobId)

    const refreshed = await this.deps.repository.snapshot()
    const needsObservation = manifestTrackedOutputIds(manifest).some(
      (outputId) => {
        const phase = refreshed.outputsByOutputId[outputId]?.phase
        return phase === "acceptance_unknown" || phase === "waiting"
      }
    )
    if (needsObservation) await this.armLivenessLocked()
    return { sealed: true, effects }
  }

  private async reconcileLocked(): Promise<NativeOutputSettlementEffects> {
    const effects: NativeOutputSettlementEffect[] = []
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

      const error = classifyProducerStoppedError(observedJob?.status)
      try {
        const sealed = await this.sealStoppedOpenManifestLocked({
          identity,
          error,
        })
        addSettlementEffects(effects, sealed.effects)
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
      addSettlementEffects(effects, await this.reconcileRecordLocked(record))
    }
    for (const jobId of Object.keys(snapshot.manifestsByJobId)) {
      addSettlementEffects(effects, await this.reconcileJobLocked(jobId))
    }
    return effects
  }

  private async reconcileRecordLocked(
    record: NativeOutputRecord
  ): Promise<NativeOutputSettlementEffects> {
    const effects: NativeOutputSettlementEffect[] = []
    const current = await this.deps.repository.getByOutputId(record.outputId)
    if (!current) return []

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
          isValidDownloadId(item.id) &&
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
          addSettlementEffects(
            effects,
            await this.observeDownloadItemLocked(attached.record, candidate)
          )
        }
      } else {
        await this.armLivenessLocked()
      }
      return effects
    }

    if (current.phase === "waiting" && current.downloadId !== undefined) {
      const items = await chrome.downloads.search({ id: current.downloadId })
      const item = items.find(
        (candidate) => candidate.id === current.downloadId
      )
      if (item) {
        addSettlementEffects(
          effects,
          await this.observeDownloadItemLocked(current, item)
        )
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
            addSettlementEffects(effects, blocked.effects)
            if (!blocked.blocked) await this.armLivenessLocked()
          }
        } else {
          await this.armLivenessLocked()
        }
      }
    }
    return effects
  }

  private async observeDownloadItemLocked(
    record: NativeOutputRecord,
    item: chrome.downloads.DownloadItem
  ): Promise<NativeOutputSettlementEffects> {
    if (item.state !== "complete" && item.state !== "interrupted") return []
    await this.deps.repository.markTerminal({
      downloadId: item.id,
      phase: item.state,
      now: Date.now(),
      error: item.error,
    })
    return await this.reconcileJobLocked(record.jobId)
  }

  private async reconcileJobLocked(
    jobId: string
  ): Promise<NativeOutputSettlementEffects> {
    let snapshot = await this.deps.repository.snapshot()
    let manifest = snapshot.manifestsByJobId[jobId]
    if (!manifest) return []

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
        if (!manifest) return []
      }
    }

    const outputIds = manifestTrackedOutputIds(manifest)
    const records = outputIds.flatMap((outputId) => {
      const record = snapshot.outputsByOutputId[outputId]
      return record ? [record] : []
    })
    const effects: NativeOutputSettlementEffect[] = []
    let settlementResolved = false

    if (
      manifest.phase === "sealed" &&
      records.length === outputIds.length &&
      records.every(
        (record) =>
          isNativeOutputTerminal(record) || record.phase === "surrendered"
      )
    ) {
      const stats = calculateNativeOutputSettlementStats(manifest, records)
      const { completed, surrendered, interrupted, lastSuccessfulDownloadId } =
        stats
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
        addSettlementEffect(effects, settlementEffect(manifest))
      } else {
        await this.armLivenessLocked()
      }
    }

    const refreshed = await this.deps.repository.snapshot()
    const refreshedManifest = refreshed.manifestsByJobId[jobId]
    if (!refreshedManifest) return effects
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
      (queueSettlementProven ||
        settlementResolved ||
        (finalOutputIds.length > 0 && allTrackedDependenciesReleased))
    ) {
      // Pruning removes accounted output records before the outer effect is
      // acknowledged. Reconstruct that effect from the released tracked slots
      // even when its queue owner has since been removed. Empty manifests still
      // require queue accounting above, including its producer-lease guard.
      addSettlementEffect(effects, settlementEffect(finalManifest))
    }
    return effects
  }

  private async armLivenessLocked(): Promise<void> {
    try {
      await this.deps.ensureLivenessAlarm()
    } catch (error) {
      logger.warn("Unable to arm native output reconciliation", error)
    }
  }
}
