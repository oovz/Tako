import type {
  DownloadTaskState,
  NativeOutputSettlement,
} from "@/src/domain/queue/state"
import type { DownloadErrorCategory } from "@/src/shared/download-contract"

import logger from "@/src/runtime/logger"
import {
  canReleaseNativeOutputBlob,
  nativeOutputIdentityMatches,
  nativeOutputJobIdentityMatches,
  type NativeOutputIdentity,
  type NativeOutputState,
  type NativeOutputJobIdentity,
  type NativeOutputManifest,
  type NativeOutputRecord,
} from "@/src/domain/native-output/state"
import type { OffscreenJobState } from "@/src/runtime/offscreen-job-contracts"
import type { QueueRepository } from "@/src/storage/queue-repository"
import type { NativeOutputRepository } from "@/src/storage/native-output-repository"
import type { SettingsRepository } from "@/src/storage/settings-repository"

import {
  toIdentity,
  ownsNativeOutputProducer,
  trackedResponse,
  notPersistedResponse,
  errorMessage,
  isValidDownloadId,
  manifestTrackedOutputIds,
  calculateNativeOutputSettlementStats,
  manifestRecords,
  allTrackedDependenciesReleased,
  manifestAccountingResolved,
  manifestReadyForAccounting,
  settlementContinuationReady,
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

function settlementReceiptMatches(
  identity: Pick<
    NativeOutputManifest,
    "jobId" | "attempt" | "taskId" | "chapterId" | "outputsRequested"
  >,
  settlement: NativeOutputSettlement | undefined
): boolean {
  return (
    settlement !== undefined &&
    settlement.jobId === identity.jobId &&
    settlement.attempt === identity.attempt &&
    settlement.taskId === identity.taskId &&
    settlement.chapterId === identity.chapterId &&
    settlement.requested === identity.outputsRequested
  )
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

function accountingDisposition(
  outcome: Awaited<
    ReturnType<QueueRepository["applyNativeOutputSettlement"]>
  >["outcome"]
): "accounted" | "not_owner" | undefined {
  if (outcome === "applied" || outcome === "already_applied") return "accounted"
  if (outcome === "not_owner") return "not_owner"
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

  /** Keeps offscreen ownership alive until accounting and Blob cleanup finish. */
  async hasLiveDependencies(): Promise<boolean> {
    return await this.deps.repository.hasLiveDependencies()
  }

  async getLiveTaskIds(): Promise<string[]> {
    const snapshot = await this.deps.repository.snapshot()
    return [
      ...new Set(
        Object.values(snapshot.manifestsByJobId)
          .filter((manifest) => manifest.settlementAcknowledgedAt === undefined)
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
      const identity = toIdentity(payload)
      const preparation = await this.prepareOutputLocked(identity, effects)
      if (preparation) return { response: preparation, effects }

      const record = await this.deps.repository.getByOutputId(identity.outputId)
      if (!record) {
        return {
          response: notPersistedResponse("prepared-record-missing"),
          effects,
        }
      }
      if (record.phase !== "prepared") {
        return { response: trackedResponse(record), effects }
      }
      const accepting = await this.beginAcceptanceLocked(record)
      const accepted = accepting
        ? await this.acceptOutputLocked(accepting, effects)
        : record
      return { response: trackedResponse(accepted), effects }
    })
  }

  private async getProducingTask(
    identity: NativeOutputJobIdentity
  ): Promise<DownloadTaskState | undefined> {
    const [lease, task] = await Promise.all([
      this.deps.queueRepository.getActiveDispatchLease(),
      this.deps.queueRepository.getTask(identity.taskId),
    ])
    if (!ownsNativeOutputProducer(lease, identity)) return
    return task?.status === "downloading" ? task : undefined
  }

  private async prepareOutputLocked(
    identity: NativeOutputIdentity,
    effects: NativeOutputSettlementEffect[]
  ): Promise<OutputReadyResponse | undefined> {
    const existing = await this.deps.repository.getByOutputId(identity.outputId)
    if (existing)
      return await this.resumeExistingOutputLocked(existing, identity, effects)
    if (!(await this.getProducingTask(identity)))
      return notPersistedResponse("stale-job")
    try {
      const prepared = await this.deps.repository.prepare({
        ...identity,
        now: Date.now(),
      })
      if (prepared.outcome === "rejected")
        return notPersistedResponse(prepared.reason)
    } catch (error) {
      return notPersistedResponse(errorMessage(error))
    }
  }

  private async resumeExistingOutputLocked(
    existing: NativeOutputRecord,
    identity: NativeOutputIdentity,
    effects: NativeOutputSettlementEffect[]
  ): Promise<OutputReadyResponse | undefined> {
    if (!nativeOutputIdentityMatches(existing, identity)) {
      return notPersistedResponse("output-identity-conflict")
    }
    if (existing.phase !== "prepared") {
      addSettlementEffects(effects, await this.reconcileRecordLocked(existing))
      return trackedResponse(
        (await this.deps.repository.getByOutputId(identity.outputId)) ??
          existing
      )
    }
    if (await this.getProducingTask(identity)) return
    const interrupted = await this.deps.repository.interruptBeforeAcceptance({
      outputId: identity.outputId,
      error: "Output producer no longer owns an active task",
      now: Date.now(),
    })
    if (interrupted.outcome === "rejected")
      return notPersistedResponse(interrupted.reason)
    addSettlementEffects(effects, await this.reconcileJobLocked(identity.jobId))
    return trackedResponse(interrupted.record)
  }

  private async beginAcceptanceLocked(
    record: NativeOutputRecord
  ): Promise<NativeOutputRecord | undefined> {
    try {
      const marked = await this.deps.repository.markAcceptanceUnknown({
        outputId: record.outputId,
        now: Date.now(),
      })
      if (marked.outcome !== "rejected") return marked.record
    } catch (error) {
      logger.warn(
        "Native output remains prepared; acceptance was not attempted",
        {
          outputId: record.outputId,
          error,
        }
      )
    }
    await this.armLivenessLocked()
  }

  private async startChromeDownloadLocked(
    record: NativeOutputRecord
  ): Promise<number> {
    const settings = await this.deps.settingsRepository.getSettings()
    const task = await this.getProducingTask(record)
    if (
      !task?.chapters.some(
        (chapter) =>
          chapter.id === record.chapterId && chapter.status === "downloading"
      )
    ) {
      throw new Error("Output producer no longer owns an active task")
    }
    const downloadId = await chrome.downloads.download({
      url: record.blobUrl,
      filename: record.filename,
      conflictAction: task.settingsSnapshot.conflictPolicy,
      saveAs: settings.downloads.suppressSaveAsDialog === false,
    })
    if (!isValidDownloadId(downloadId)) {
      throw new Error("downloads.download returned no download id")
    }
    return downloadId
  }

  private async interruptRejectedOutputLocked(
    record: NativeOutputRecord,
    error: unknown
  ): Promise<NativeOutputRecord> {
    try {
      const interrupted = await this.deps.repository.interruptBeforeAcceptance({
        outputId: record.outputId,
        error: errorMessage(error),
        now: Date.now(),
      })
      if (interrupted.outcome !== "rejected") return interrupted.record
    } catch (persistenceError) {
      logger.warn(
        "Native output remains in acceptance-unknown safety quarantine",
        {
          outputId: record.outputId,
          persistenceError,
        }
      )
    }
    await this.armLivenessLocked()
    return record
  }

  private async acceptOutputLocked(
    record: NativeOutputRecord,
    effects: NativeOutputSettlementEffect[]
  ): Promise<NativeOutputRecord> {
    let acceptedId: number
    try {
      acceptedId = await this.startChromeDownloadLocked(record)
    } catch (error) {
      const interrupted = await this.interruptRejectedOutputLocked(
        record,
        error
      )
      addSettlementEffects(effects, await this.reconcileJobLocked(record.jobId))
      return interrupted
    }
    try {
      const attached = await this.deps.repository.attachDownload({
        outputId: record.outputId,
        downloadId: acceptedId,
      })
      if (attached.outcome !== "rejected") record = attached.record
    } catch (error) {
      logger.warn("Native download ID persistence will be reconciled", {
        outputId: record.outputId,
        downloadId: acceptedId,
        error,
      })
      await this.armLivenessLocked()
      return record
    }
    await this.armLivenessLocked()
    addSettlementEffects(effects, await this.reconcileJobLocked(record.jobId))
    return (await this.deps.repository.getByOutputId(record.outputId)) ?? record
  }

  async sealManifest(
    input: NativeOutputJobIdentity & {
      outputsRequested: number
      outputsFailedBeforeHandoff: number
      errorMessage?: string
      errorCategory?: DownloadErrorCategory
    }
  ): Promise<void> {
    await this.serialized(async () => await this.sealManifestLocked(input))
  }

  private async sealManifestLocked(
    input: NativeOutputJobIdentity & {
      outputsRequested: number
      outputsFailedBeforeHandoff: number
      errorMessage?: string
      errorCategory?: DownloadErrorCategory
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
        confirmedByBrowser: true,
      })
      if (result.outcome === "rejected") return { handled: false, effects }
      const record = await this.deps.repository.getByOutputId(
        result.record.outputId
      )
      if (record) {
        await this.releaseJobBlobsLocked([record])
      }
      addSettlementEffects(
        effects,
        await this.reconcileJobLocked(current.jobId)
      )
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

      const acknowledged = await this.deps.repository.acknowledgeSettlement({
        jobId: effect.jobId,
        now: Date.now(),
      })
      if (acknowledged.outcome === "rejected") return

      if (!allTrackedDependenciesReleased(snapshot, manifest)) return

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
        await this.observeActiveStartupProducerLocked(
          manifest,
          input.offscreenJob,
          input.activeLease
        )
        return { observedJobSealed: false, effects }
      }

      if (manifest.phase === "sealed") {
        return { observedJobSealed: true, effects }
      }

      const sealed = await this.sealObservedStoppedProducerLocked(
        manifest,
        input.offscreenJob
      )
      addSettlementEffects(effects, sealed.effects)
      return { observedJobSealed: sealed.sealed, effects }
    })
  }

  private async observeActiveStartupProducerLocked(
    manifest: NativeOutputManifest,
    job: OffscreenJobState,
    activeLease: NativeOutputJobIdentity | null
  ): Promise<void> {
    if (manifest.phase === "sealed") {
      logger.warn(
        "Exact active offscreen producer conflicts with a sealed native output manifest; lease remains owned",
        { jobId: manifest.jobId, taskId: manifest.taskId }
      )
      await this.armLivenessLocked()
      return
    }
    if (
      activeLease === null ||
      !nativeOutputJobIdentityMatches(activeLease, job)
    ) {
      logger.warn(
        "Exact active offscreen producer has no matching startup lease; manifest remains open",
        { jobId: manifest.jobId, taskId: manifest.taskId }
      )
      await this.armLivenessLocked()
    }
  }

  private async sealObservedStoppedProducerLocked(
    manifest: NativeOutputManifest,
    job: OffscreenJobState
  ): Promise<{ sealed: boolean; effects: NativeOutputSettlementEffects }> {
    const outcome = job.status === "terminal" ? job.outcome : undefined
    return await this.sealStoppedOpenManifestLocked({
      identity: manifest,
      error: classifyProducerStoppedError(job.status),
      errorMessage: outcome?.errorMessage,
      errorCategory: outcome?.errorCategory,
    })
  }

  async cancelTask(
    taskId: string,
    canceledJob?: NativeOutputJobIdentity
  ): Promise<void> {
    const effects = await this.serialized(async () => {
      const effects: NativeOutputSettlementEffect[] = []
      if (!canceledJob) {
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

  private async sealStoppedOpenManifestLocked(input: {
    identity: NativeOutputJobIdentity
    error: string
    errorMessage?: string
    errorCategory?: DownloadErrorCategory
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

    await this.interruptPreparedOutputsLocked(manifest, snapshot, input.error)

    const sealed = await this.deps.repository.sealManifest({
      ...input.identity,
      outputsRequested: manifest.outputsRequested,
      outputsFailedBeforeHandoff: nullSlotCount,
      now: Date.now(),
      error: input.error,
      errorMessage: input.errorMessage,
      errorCategory: input.errorCategory,
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
      addSettlementEffects(
        effects,
        await this.reconcileOpenProducerLocked(manifest)
      )
    }

    const snapshot = await this.deps.repository.snapshot()
    for (const record of Object.values(snapshot.outputsByOutputId)) {
      try {
        addSettlementEffects(effects, await this.reconcileRecordLocked(record))
      } catch (error) {
        logger.warn("Native output observation will be retried", {
          outputId: record.outputId,
          error,
        })
        await this.armLivenessLocked()
      }
    }
    for (const jobId of Object.keys(snapshot.manifestsByJobId)) {
      addSettlementEffects(effects, await this.reconcileJobLocked(jobId))
    }
    return effects
  }

  private async reconcileOpenProducerLocked(
    manifest: NativeOutputManifest
  ): Promise<NativeOutputSettlementEffects> {
    let observedJob: OffscreenJobState | null
    try {
      observedJob = await this.deps.queryOffscreenJob({
        jobId: manifest.jobId,
        attempt: manifest.attempt,
        taskId: manifest.taskId,
        chapterId: manifest.chapterId,
        fingerprint: manifest.fingerprint,
        documentInstanceId: manifest.documentInstanceId,
      })
    } catch (error) {
      logger.warn("Unable to query an open native output producer", {
        jobId: manifest.jobId,
        error,
      })
      await this.armLivenessLocked()
      return []
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
      return []
    }
    if (observedJob?.status === "active") return []
    return await this.sealReconciledProducerLocked(manifest, observedJob)
  }

  private async sealReconciledProducerLocked(
    manifest: NativeOutputManifest,
    observedJob: OffscreenJobState | null
  ): Promise<NativeOutputSettlementEffects> {
    try {
      const sealed = await this.sealStoppedOpenManifestLocked({
        identity: manifest,
        error: classifyProducerStoppedError(observedJob?.status),
        errorMessage: observedJob?.outcome?.errorMessage,
        errorCategory: observedJob?.outcome?.errorCategory,
      })
      return sealed.effects
    } catch (error) {
      logger.warn("Unable to seal an exact stopped native output producer", {
        jobId: manifest.jobId,
        error,
      })
      await this.armLivenessLocked()
      return []
    }
  }

  private async reconcileRecordLocked(
    record: NativeOutputRecord
  ): Promise<NativeOutputSettlementEffects> {
    const current = await this.deps.repository.getByOutputId(record.outputId)
    if (!current) return []
    if (
      current.phase === "acceptance_unknown" ||
      (current.phase === "outcome_unknown" && current.downloadId === undefined)
    ) {
      return await this.recoverDownloadIdentityLocked(current)
    }
    if (
      (current.phase === "waiting" || current.phase === "outcome_unknown") &&
      current.downloadId !== undefined
    ) {
      return await this.observeKnownDownloadLocked(current, current.downloadId)
    }
    return []
  }

  private async searchOutputEvidenceLocked(
    record: NativeOutputRecord,
    query: chrome.downloads.DownloadQuery,
    evidence: "handoff" | "file-save"
  ): Promise<chrome.downloads.DownloadItem[] | undefined> {
    try {
      return await chrome.downloads.search(query)
    } catch (error) {
      logger.warn(`Chrome ${evidence} evidence is unavailable`, {
        outputId: record.outputId,
        error,
      })
      await this.deps.repository.markOutcomeUnknown({
        outputId: record.outputId,
      })
      await this.armLivenessLocked()
    }
  }

  private async recoverDownloadIdentityLocked(
    record: NativeOutputRecord
  ): Promise<NativeOutputSettlementEffects> {
    const matches = await this.searchOutputEvidenceLocked(
      record,
      { url: record.blobUrl },
      "handoff"
    )
    if (!matches) return []
    const snapshot = await this.deps.repository.snapshot()
    const claimedIds = new Set(
      Object.values(snapshot.outputsByOutputId).flatMap((candidate) =>
        candidate.downloadId === undefined ? [] : [candidate.downloadId]
      )
    )
    const exactUnclaimed = matches.filter(
      (item) =>
        isValidDownloadId(item.id) &&
        item.url === record.blobUrl &&
        !claimedIds.has(item.id)
    )
    if (exactUnclaimed.length !== 1) {
      await this.deps.repository.markOutcomeUnknown({
        outputId: record.outputId,
      })
      await this.armLivenessLocked()
      return []
    }
    const candidate = exactUnclaimed[0]
    const attached = await this.deps.repository.attachDownload({
      outputId: record.outputId,
      downloadId: candidate.id,
    })
    if (attached.outcome === "rejected") return []
    return await this.observeDownloadItemLocked(attached.record, candidate)
  }

  private async observeKnownDownloadLocked(
    record: NativeOutputRecord,
    downloadId: number
  ): Promise<NativeOutputSettlementEffects> {
    const items = await this.searchOutputEvidenceLocked(
      record,
      { id: downloadId },
      "file-save"
    )
    if (!items) return []
    const item = items.find((candidate) => candidate.id === downloadId)
    if (item) return await this.observeDownloadItemLocked(record, item)
    const erased = await this.deps.repository.observeErased({
      downloadId,
      now: Date.now(),
      confirmedByBrowser: false,
    })
    if (erased.outcome === "rejected") {
      await this.armLivenessLocked()
    } else if (
      await this.deps.repository.getByOutputId(erased.record.outputId)
    ) {
      await this.armLivenessLocked()
    }
    return []
  }

  private async restoreObservedPendingLocked(
    record: NativeOutputRecord,
    downloadId: number
  ): Promise<void> {
    const task = await this.deps.queueRepository.getTask(record.taskId)
    const chapter = task?.chapters.find(
      (chapter) => chapter.id === record.chapterId
    )
    if (
      task?.status === "downloading" &&
      chapter?.dispatchAttempt === record.attempt &&
      !settlementReceiptMatches(
        { ...record, outputsRequested: record.outputCount },
        chapter.nativeOutputSettlement
      )
    ) {
      await this.deps.repository.observePending({ downloadId })
    }
  }

  private async observeDownloadItemLocked(
    record: NativeOutputRecord,
    item: chrome.downloads.DownloadItem
  ): Promise<NativeOutputSettlementEffects> {
    if (
      item.state === "in_progress" &&
      record.phase === "outcome_unknown" &&
      record.accountingDisposition === "pending"
    ) {
      await this.restoreObservedPendingLocked(record, item.id)
      return []
    }
    if (item.state !== "complete" && item.state !== "interrupted") return []
    await this.deps.repository.markTerminal({
      downloadId: item.id,
      phase: item.state,
      now: Date.now(),
      error: item.error,
    })
    return await this.reconcileJobLocked(record.jobId)
  }

  private async interruptPreparedOutputsLocked(
    manifest: NativeOutputManifest,
    snapshot: NativeOutputState,
    error: string
  ): Promise<boolean> {
    const preparedOutputIds = manifestTrackedOutputIds(manifest).filter(
      (outputId) => snapshot.outputsByOutputId[outputId]?.phase === "prepared"
    )
    for (const outputId of preparedOutputIds) {
      const interrupted = await this.deps.repository.interruptBeforeAcceptance({
        outputId,
        error,
        now: Date.now(),
      })
      if (interrupted.outcome === "rejected") {
        throw new Error(
          `Native output interruption rejected: ${interrupted.reason}`
        )
      }
    }
    return preparedOutputIds.length > 0
  }

  private async accountManifestOutputsLocked(
    manifest: NativeOutputManifest,
    records: NativeOutputRecord[],
    queueSettlementProven: boolean
  ): Promise<boolean> {
    const stats = calculateNativeOutputSettlementStats(manifest, records)
    const settlement = queueSettlementProven
      ? { outcome: "already_applied" as const }
      : await this.deps.queueRepository.applyNativeOutputSettlement({
          jobId: manifest.jobId,
          attempt: manifest.attempt,
          taskId: manifest.taskId,
          chapterId: manifest.chapterId,
          requested: manifest.outputsRequested,
          completed: stats.completed,
          interrupted: stats.interrupted,
          outputUncertain: stats.outputUncertain || undefined,
          errorMessage: stats.errorMessage,
          errorCategory: stats.errorCategory,
          lastSuccessfulDownloadId: stats.lastSuccessfulDownloadId,
          now: Date.now(),
        })
    const disposition = accountingDisposition(settlement.outcome)
    if (!disposition) {
      await this.armLivenessLocked()
      return false
    }
    for (const record of records) {
      await this.deps.repository.markAccountingDisposition({
        outputId: record.outputId,
        disposition,
        now: Date.now(),
      })
    }
    return true
  }

  private async releaseAccountedDependenciesLocked(
    records: NativeOutputRecord[]
  ): Promise<void> {
    for (const record of records) {
      const released = await this.deps.repository.getByOutputId(record.outputId)
      if (
        released &&
        canReleaseNativeOutputBlob(released) &&
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
  }

  private async collectJobSettlementEffectsLocked(
    jobId: string,
    queueSettlementProven: boolean,
    settlementResolved: boolean
  ): Promise<NativeOutputSettlementEffects> {
    const finalState = await this.deps.repository.snapshot()
    const manifest = finalState.manifestsByJobId[jobId]
    if (!manifest) return []
    const dependenciesReleased = allTrackedDependenciesReleased(
      finalState,
      manifest
    )
    if (manifest.settlementAcknowledgedAt !== undefined) {
      if (dependenciesReleased) {
        await this.deps.repository.markJobDependencyReleased({
          jobId,
          now: Date.now(),
        })
      }
      return []
    }
    if (
      settlementContinuationReady(
        manifest,
        queueSettlementProven,
        settlementResolved,
        dependenciesReleased
      )
    ) {
      // Accounted records can be pruned before the continuation is acknowledged.
      // Released tracked slots retain that effect even if its queue owner was removed.
      // Empty manifests still require queue accounting and its producer-lease guard.
      return [settlementEffect(manifest)]
    }
    return []
  }

  private async reconcileJobLocked(
    jobId: string
  ): Promise<NativeOutputSettlementEffects> {
    let snapshot = await this.deps.repository.snapshot()
    let manifest = snapshot.manifestsByJobId[jobId]
    if (!manifest) return []
    if (
      manifest.phase === "sealed" &&
      (await this.interruptPreparedOutputsLocked(
        manifest,
        snapshot,
        "Native output was not accepted before manifest sealing"
      ))
    ) {
      snapshot = await this.deps.repository.snapshot()
      manifest = snapshot.manifestsByJobId[jobId]
      if (!manifest) return []
    }
    const records = manifestRecords(snapshot, manifest)
    let settlementResolved = manifestAccountingResolved(manifest, records)
    await this.releaseJobBlobsLocked(records)
    const task = await this.deps.queueRepository.getTask(manifest.taskId)
    const chapterSettlement = task?.chapters.find(
      (chapter) => chapter.id === manifest.chapterId
    )?.nativeOutputSettlement
    const queueSettlementProven = settlementReceiptMatches(
      manifest,
      chapterSettlement
    )
    if (manifestReadyForAccounting(manifest, records, settlementResolved)) {
      settlementResolved = await this.accountManifestOutputsLocked(
        manifest,
        records,
        queueSettlementProven
      )
    }
    const refreshed = await this.deps.repository.snapshot()
    const refreshedManifest = refreshed.manifestsByJobId[jobId]
    if (!refreshedManifest) return []
    await this.releaseAccountedDependenciesLocked(
      manifestRecords(refreshed, refreshedManifest)
    )
    return await this.collectJobSettlementEffectsLocked(
      jobId,
      queueSettlementProven,
      settlementResolved
    )
  }

  private async releaseJobBlobsLocked(
    records: NativeOutputRecord[]
  ): Promise<void> {
    for (const record of records) {
      if (
        record.blobReleasedAt !== undefined ||
        !canReleaseNativeOutputBlob(record)
      )
        continue
      try {
        await this.deps.requestBlobRevocation(record)
        const released = await this.deps.repository.markBlobReleased({
          outputId: record.outputId,
          now: Date.now(),
        })
        if (released.outcome === "rejected") {
          throw new Error(
            `Native output Blob release rejected: ${released.reason}`
          )
        }
      } catch (error) {
        logger.warn("Native output Blob release will be retried", {
          outputId: record.outputId,
          error,
        })
        await this.armLivenessLocked()
      }
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
