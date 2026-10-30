/**
 * Background-side offscreen lifecycle helpers.
 *
 * Responsible for creating, querying, and tearing down the single MV3
 * offscreen document used by the archive pipeline.
 */

import logger from "@/src/runtime/logger"
import type { QueueRepository } from "@/src/storage/queue-repository"
import type { SettingsRepository } from "@/src/storage/settings-repository"
import type { OffscreenJobState } from "@/src/runtime/offscreen-job-contracts"
import {
  nativeOutputJobIdentityMatches,
  type NativeOutputJobIdentity,
} from "@/src/domain/native-output/state"
import type {
  ActiveDispatchLease,
  DownloadTaskState,
} from "@/src/domain/queue/state"
import type { OffscreenInitializationState } from "@/src/runtime/runtime-message-contracts"
import type {
  OffscreenDocumentAdmissionContext,
  OffscreenDocumentLifecycleReservation,
} from "@/src/runtime/resolve-series-data-offscreen"
import { sendRuntimeMessage } from "@/src/runtime/send-runtime-message"
import type { NativeOutputCoordinator } from "@/entrypoints/background/native-output-coordinator"
import type { NativeOutputSettlementEffects } from "@/entrypoints/background/native-output-coordinator"
import { notifyTerminalDownloadTask } from "@/entrypoints/background/download-queue-finalization"
import { clearActiveTaskProgress } from "@/entrypoints/background/active-task-progress-bus"
import { runTaskSideEffectExclusive } from "@/entrypoints/background/download-task-side-effect-gate"
import type { OffscreenJobTerminalCoordinator } from "@/entrypoints/background/offscreen-job-terminal-coordinator"
import type { QueueScheduler } from "@/entrypoints/background/queue-scheduler"
import {
  isExecutingDownloadTask,
  isWatchdogEligibleTask,
} from "@/src/domain/queue/task-lifecycle"

// Coalesce ensure callers while serializing every create and close for the
// single targetless offscreen-document API.
let ensuringOffscreen: Promise<void> | null = null
let offscreenLifecycleTail: Promise<void> = Promise.resolve()
export const LIVENESS_ALARM_NAME = "offscreen-liveness"

export type CloseOffscreenDocumentResult = "closed" | "stale"

export type CloseOffscreenDocumentInput = {
  documentInstanceId: string
  browserDocumentId?: string
}

type RuntimeGetContexts = (params: {
  contextTypes: Array<"OFFSCREEN_DOCUMENT">
  documentUrls: string[]
}) => Promise<unknown[]>

const activeTransientWorkReservations = new Set<object>()

function reserveTransientWork(): OffscreenDocumentLifecycleReservation {
  const reservation = {}
  activeTransientWorkReservations.add(reservation)
  return {
    release: () => activeTransientWorkReservations.delete(reservation),
  }
}

function releaseAllTransientWorkReservations(): void {
  activeTransientWorkReservations.clear()
}

export async function getOffscreenContexts(): Promise<unknown[]> {
  const offscreenUrl = chrome.runtime.getURL("offscreen.html")
  const runtimeWithGetContexts = chrome.runtime as unknown as {
    getContexts?: RuntimeGetContexts
  }
  if (typeof runtimeWithGetContexts.getContexts !== "function") {
    throw new Error("chrome.runtime.getContexts is unavailable")
  }
  return await runtimeWithGetContexts.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [offscreenUrl],
  })
}

export async function hasOffscreenDocument(): Promise<boolean> {
  return await chrome.offscreen.hasDocument()
}

export async function terminateOffscreenDocumentForUnboundLease(): Promise<void> {
  await runOffscreenLifecycleOperation(async () => {
    if (!(await chrome.offscreen.hasDocument())) {
      releaseAllTransientWorkReservations()
      return
    }
    await chrome.offscreen.closeDocument()
    releaseAllTransientWorkReservations()
  })
}

function runOffscreenLifecycleOperation<T>(
  operation: () => Promise<T>
): Promise<T> {
  const result = offscreenLifecycleTail.then(operation)
  offscreenLifecycleTail = result.then(
    () => undefined,
    () => undefined
  )
  return result
}

async function closeOffscreenDocumentIfCurrentInLifecycle(
  input: CloseOffscreenDocumentInput
): Promise<CloseOffscreenDocumentResult> {
  const status = await queryOffscreenStatus()
  if (!status || status.documentInstanceId !== input.documentInstanceId) {
    return "stale"
  }

  const contexts = await getOffscreenContexts()
  if (contexts.length === 0) {
    releaseAllTransientWorkReservations()
    return "stale"
  }
  if (
    input.browserDocumentId !== undefined &&
    !contexts.some(
      (context) =>
        typeof context === "object" &&
        context !== null &&
        "documentId" in context &&
        (context as { documentId?: unknown }).documentId ===
          input.browserDocumentId
    )
  ) {
    return "stale"
  }

  await chrome.offscreen.closeDocument()
  releaseAllTransientWorkReservations()
  return "closed"
}

export async function closeOffscreenDocumentIfCurrent(
  input: CloseOffscreenDocumentInput
): Promise<CloseOffscreenDocumentResult> {
  return await runOffscreenLifecycleOperation(async () =>
    closeOffscreenDocumentIfCurrentInLifecycle(input)
  )
}

export async function ensureLivenessAlarm(): Promise<void> {
  const existing = await chrome.alarms.get(LIVENESS_ALARM_NAME)
  if (existing && existing.periodInMinutes === undefined) {
    return
  }
  if (existing) await chrome.alarms.clear(LIVENESS_ALARM_NAME)
  await chrome.alarms.create(LIVENESS_ALARM_NAME, {
    delayInMinutes: 0.5,
    persistAcrossSessions: true,
  })
}

export async function setLivenessAlarmArmed(shouldArm: boolean): Promise<void> {
  if (shouldArm) {
    await ensureLivenessAlarm()
    return
  }
  await chrome.alarms.clear(LIVENESS_ALARM_NAME)
}

export async function refreshLivenessAlarmForDurableWork(
  stateManager: QueueRepository,
  nativeOutputCoordinator: NativeOutputCoordinator
): Promise<void> {
  const [queue, lease, nativeOutputTaskIds, hasNativeOutputDependencies] =
    await Promise.all([
      stateManager.getQueue(),
      stateManager.getActiveDispatchLease(),
      nativeOutputCoordinator.getLiveTaskIds(),
      nativeOutputCoordinator.hasLiveDependencies(),
    ])
  const nativeTaskIds = new Set(nativeOutputTaskIds)
  const hasOffscreenExecutingTask = queue.some(
    (task) => isExecutingDownloadTask(task) && !nativeTaskIds.has(task.id)
  )
  await setLivenessAlarmArmed(
    hasOffscreenExecutingTask || lease !== null || hasNativeOutputDependencies
  )
}

export async function queryOffscreenJob(
  identity: NativeOutputJobIdentity
): Promise<OffscreenJobState | null> {
  if (!(await hasOffscreenDocument())) return null
  const requestId = crypto.randomUUID()
  const response = await sendRuntimeMessage({
    target: "offscreen",
    type: "OFFSCREEN_QUERY_JOB",
    payload: { requestId, identity },
  })
  if (!response.success || response.requestId !== requestId) {
    throw new Error("Invalid offscreen job-state response")
  }
  return response.job
}

export async function cancelOffscreenJob(
  input: NativeOutputJobIdentity
): Promise<boolean> {
  try {
    const response = await sendRuntimeMessage({
      target: "offscreen",
      type: "OFFSCREEN_CANCEL_JOB",
      payload: input,
    })
    const exactIdentity =
      response.success && nativeOutputJobIdentityMatches(response, input)
    return (
      exactIdentity &&
      ((response.canceled && response.status === "canceled") ||
        (!response.canceled &&
          (response.status === "terminal" || response.status === "absent")))
    )
  } catch (error) {
    logger.debug("Cooperative offscreen cancellation failed", error)
    return false
  }
}

class OffscreenLivenessRecovery {
  private nativeOutputTaskIds = new Set<string>()
  private queue: DownloadTaskState[] = []
  private activeTasks: DownloadTaskState[] = []
  private lease: Awaited<
    ReturnType<QueueRepository["getActiveDispatchLease"]>
  > = null
  private startupNativeSettlementEffects: NativeOutputSettlementEffects = []
  private queriedJob: OffscreenJobState | null = null
  private exactQueriedJob: OffscreenJobState | null = null
  private nativeOutputPhase: Awaited<
    ReturnType<NativeOutputCoordinator["getJobPhase"]>
  > = null
  private recoveredAt = 0
  private clearedCapturedLease = false
  constructor(
    private readonly stateManager: QueueRepository,
    private readonly nativeOutputCoordinator: NativeOutputCoordinator,
    private readonly terminalCoordinator: OffscreenJobTerminalCoordinator,
    private readonly queueScheduler: QueueScheduler,
    private readonly settingsRepository: Pick<SettingsRepository, "getSettings">
  ) {}
  async run(): Promise<void> {
    this.nativeOutputTaskIds = new Set(
      await this.nativeOutputCoordinator.getLiveTaskIds()
    )
    this.queue = await this.stateManager.getQueue()
    this.activeTasks = this.queue.filter(
      (task) =>
        isWatchdogEligibleTask(task) && !this.nativeOutputTaskIds.has(task.id)
    )
    this.lease = await this.stateManager.getActiveDispatchLease()
    this.startupNativeSettlementEffects = []
    if (await this.resumeIdleQueue()) return
    if (await this.recoverUnboundLease()) return
    if (await this.reconcileBoundLease()) return
    await this.interruptUnresponsiveTasks()
    await this.finishInterruption()
  }
  private async finishInterruption(): Promise<void> {
    try {
      await clearActiveTaskProgress()
    } catch (error) {
      logger.warn("Unable to clear watchdog progress projection", error)
    }
    const currentLease = await this.stateManager.getActiveDispatchLease()
    if (
      this.clearedCapturedLease &&
      !currentLease &&
      !(await this.nativeOutputCoordinator.hasLiveDependencies()) &&
      this.lease?.documentInstanceId
    ) {
      await closeOffscreenDocumentIfCurrent({
        documentInstanceId: this.lease.documentInstanceId,
      })
    }
    await this.queueScheduler.activate()
  }
  private async reconcileBoundLease(): Promise<boolean> {
    if (!(await this.queryExpiredJob())) return true
    this.nativeOutputPhase = this.lease
      ? await this.nativeOutputCoordinator.getJobPhase(this.lease.jobId)
      : null
    if (await this.renewLiveLease()) return true
    if (await this.reconcileNativeOutput()) return true
    if (await this.settleTerminalJob()) return true

    return false
  }

  private async resumeIdleQueue(): Promise<boolean> {
    if (this.activeTasks.length === 0 && !this.lease) {
      await this.queueScheduler.activate()
      return true
    }
    const idleDispatchTask = this.lease
      ? undefined
      : this.findIdleDispatchTask()
    if (!this.lease && idleDispatchTask) {
      await this.queueScheduler.resumeTask(idleDispatchTask.id)
      return true
    }
    if (this.lease && Date.now() <= this.lease.leaseExpiresAt) {
      return true
    }

    return false
  }
  private findIdleDispatchTask(): DownloadTaskState | undefined {
    const idleDispatchTask =
      this.activeTasks.length === 1 ? this.activeTasks[0] : undefined
    if (
      idleDispatchTask &&
      idleDispatchTask.chapters.every(
        (chapter) => chapter.status !== "downloading"
      ) &&
      !this.queueScheduler.isTaskActive(idleDispatchTask.id)
    )
      return idleDispatchTask
    return undefined
  }

  private async recoverUnboundLease(): Promise<boolean> {
    const lease = this.lease
    if (!lease || lease.documentInstanceId) return false
    const interrupted = await runTaskSideEffectExclusive(lease.taskId, () =>
      this.interruptUnboundLease(lease)
    )
    if (interrupted)
      await notifyTerminalDownloadTask({
        task: interrupted,
        finalStatus: interrupted.status,
        completedCount: interrupted.chapters.filter(
          (chapter) => chapter.status === "completed"
        ).length,
        totalChapters: interrupted.chapters.length,
        settingsRepository: this.settingsRepository,
      })
    await clearActiveTaskProgress()
    await this.queueScheduler.activate()
    return true
  }

  private async interruptUnboundLease(
    lease: ActiveDispatchLease
  ): Promise<DownloadTaskState | undefined> {
    const current = await this.stateManager.getActiveDispatchLease()
    if (!canExpireUnboundLease(current, lease)) return undefined
    await terminateOffscreenDocumentForUnboundLease()
    const task = await this.stateManager.getTask(current.taskId)
    if (task?.status === "queued" || task?.status === "downloading") {
      const interruption = await this.stateManager.interruptDownloadTask({
        taskId: current.taskId,
        errorMessage: "Download interrupted before offscreen acceptance",
        now: Date.now(),
        clearLease: current,
      })
      return interruption.outcome === "applied" ? interruption.task : undefined
    }
    await this.stateManager.clearDispatchLease(current)
    return undefined
  }
  private async queryExpiredJob(): Promise<boolean> {
    const lease = this.lease
    if (!lease?.documentInstanceId) return false
    const job = await this.readExpiredJob({
      jobId: lease.jobId,
      attempt: lease.attempt,
      taskId: lease.taskId,
      chapterId: lease.chapterId,
      fingerprint: lease.fingerprint,
      documentInstanceId: lease.documentInstanceId,
    })
    if (job === undefined) {
      await ensureLivenessAlarm()
      return false
    }
    this.queriedJob = job
    this.exactQueriedJob = job && sameJobCoordinates(job, lease) ? job : null
    if (job !== null && this.exactQueriedJob === null) {
      await ensureLivenessAlarm()
      return false
    }
    return true
  }
  private async readExpiredJob(
    identity: NativeOutputJobIdentity
  ): Promise<OffscreenJobState | null | undefined> {
    try {
      return await queryOffscreenJob(identity)
    } catch (error) {
      logger.warn("Unable to query an expired offscreen job lease", error)
      return undefined
    }
  }
  private async renewLiveLease(): Promise<boolean> {
    const lease = this.lease
    const leaseOwnerAcceptsEvents =
      lease !== null && this.leaseOwnerAcceptsEvents(lease)
    if (
      lease &&
      leaseOwnerAcceptsEvents &&
      this.exactQueriedJob?.status === "active"
    ) {
      const renewal = await this.stateManager.renewDispatchLease({
        jobId: this.exactQueriedJob.jobId,
        taskId: this.exactQueriedJob.taskId,
        chapterId: this.exactQueriedJob.chapterId,
        attempt: this.exactQueriedJob.attempt,
        stage: this.exactQueriedJob.stage,
        sequence: this.exactQueriedJob.lastSequence,
        fingerprint: this.exactQueriedJob.fingerprint,
        documentInstanceId: this.exactQueriedJob.documentInstanceId,
        eventSignature: JSON.stringify(this.exactQueriedJob),
        activityAt: Date.now(),
        requireSequenceAdvance: true,
      })
      if (renewal.outcome !== "rejected") return true
      if (this.nativeOutputPhase !== null) return true
    }

    return false
  }
  private leaseOwnerAcceptsEvents(lease: ActiveDispatchLease): boolean {
    return this.queue.some(
      (task) =>
        task.id === lease.taskId &&
        task.status === "downloading" &&
        task.chapters.some(
          (chapter) =>
            chapter.id === lease.chapterId && chapter.status === "downloading"
        )
    )
  }
  private async reconcileNativeOutput(): Promise<boolean> {
    const lease = this.lease
    await this.reconcileOpenManifest(lease)
    if (lease && this.nativeOutputPhase === "sealed") {
      const clearing = await this.stateManager.clearDispatchLease(lease)
      if (clearing.outcome === "applied") {
        const effects = [
          ...this.startupNativeSettlementEffects,
          ...(await this.nativeOutputCoordinator.reconcile()),
        ]
        await this.terminalCoordinator.continueAfterNativeOutputSettlement(
          effects
        )
        await this.queueScheduler.activate()
      }
      return true
    }
    if (this.nativeOutputPhase === "open") {
      // Open manifests retain output dependencies while expired producers
      // without an active chapter owner pass through cooperative cancellation.
      return (
        lease === null ||
        this.exactQueriedJob?.status !== "active" ||
        this.leaseOwnerAcceptsEvents(lease)
      )
    }

    return false
  }
  private async reconcileOpenManifest(
    lease: ActiveDispatchLease | null
  ): Promise<void> {
    if (
      lease &&
      this.nativeOutputPhase === "open" &&
      (this.queriedJob === null || this.exactQueriedJob?.status !== "active")
    ) {
      const startupReconciliation =
        await this.nativeOutputCoordinator.reconcileStartupOpenManifests({
          offscreenJob: this.queriedJob,
          activeLease: lease.documentInstanceId
            ? {
                jobId: lease.jobId,
                attempt: lease.attempt,
                taskId: lease.taskId,
                chapterId: lease.chapterId,
                fingerprint: lease.fingerprint,
                documentInstanceId: lease.documentInstanceId,
              }
            : null,
        })
      this.startupNativeSettlementEffects = startupReconciliation.effects
      this.nativeOutputPhase = await this.nativeOutputCoordinator.getJobPhase(
        lease.jobId
      )
    }
  }

  private async settleTerminalJob(): Promise<boolean> {
    const lease = this.lease
    const exactQueriedJob = this.exactQueriedJob
    if (lease && exactQueriedJob?.status === "terminal") {
      const outcome = exactQueriedJob.outcome
      if (!outcome) throw new Error("Terminal offscreen job has no outcome")
      const settlement = await runTaskSideEffectExclusive(
        exactQueriedJob.taskId,
        async () =>
          await this.terminalCoordinator.settle({
            jobId: exactQueriedJob.jobId,
            attempt: exactQueriedJob.attempt,
            taskId: exactQueriedJob.taskId,
            chapterId: exactQueriedJob.chapterId,
            fingerprint: exactQueriedJob.fingerprint,
            documentInstanceId: exactQueriedJob.documentInstanceId,
            stage: exactQueriedJob.stage,
            sequence: exactQueriedJob.lastSequence,
            terminalAt: Date.now(),
            outcome,
          })
      )
      if (
        settlement === "chapter-settled" &&
        this.queueScheduler.isTaskActive(exactQueriedJob.taskId)
      )
        return true
      await this.terminalCoordinator.afterSettlement(
        exactQueriedJob.taskId,
        settlement
      )
      return true
    }

    return false
  }
  private async interruptUnresponsiveTasks(): Promise<void> {
    const lease = this.lease
    this.recoveredAt = Date.now()
    this.clearedCapturedLease = lease === null
    const leaseOwnerIsActive =
      lease !== null &&
      this.activeTasks.some((task) => task.id === lease.taskId)
    for (const activeTask of this.activeTasks) {
      await runTaskSideEffectExclusive(activeTask.id, () =>
        this.interruptActiveTask(activeTask, lease)
      )
    }
    if (lease && !leaseOwnerIsActive) {
      await runTaskSideEffectExclusive(lease.taskId, () =>
        this.clearOrphanLease(lease)
      )
    }
  }

  private async stopLeaseProducer(
    lease: ActiveDispatchLease
  ): Promise<boolean> {
    return (
      this.queriedJob === null ||
      (await cancelOffscreenJob({
        jobId: lease.jobId,
        attempt: lease.attempt,
        taskId: lease.taskId,
        chapterId: lease.chapterId,
        fingerprint: lease.fingerprint,
        documentInstanceId: lease.documentInstanceId!,
      }))
    )
  }
  private async applyInterruptionEffects(
    taskId: string,
    ownsLease: boolean,
    producerStopped: boolean,
    clearedLease: ActiveDispatchLease | null
  ): Promise<void> {
    if (ownsLease && producerStopped) {
      this.clearedCapturedLease = clearedLease !== null
    }
    if (!ownsLease || producerStopped) {
      await this.nativeOutputCoordinator.cancelTask(taskId)
    }
  }

  private async clearOrphanLease(lease: ActiveDispatchLease): Promise<void> {
    const producerStopped = await this.stopLeaseProducer(lease)
    if (!producerStopped) {
      await ensureLivenessAlarm()
      return
    }
    const clearing = await this.stateManager.clearDispatchLease(lease)
    this.clearedCapturedLease = clearing.outcome === "applied"
    if (this.clearedCapturedLease) {
      await this.nativeOutputCoordinator.cancelTask(lease.taskId)
    }
  }

  private async interruptActiveTask(
    activeTask: DownloadTaskState,
    lease: ActiveDispatchLease | null
  ): Promise<void> {
    logger.warn(`Liveness timeout for task ${activeTask.id}`)
    const successfulChapters = activeTask.chapters.filter(
      (chapter) => chapter.status === "completed"
    ).length
    const ownsLease = lease?.taskId === activeTask.id
    const producerStopped = ownsLease
      ? await this.stopLeaseProducer(lease)
      : true
    const interruption = await this.stateManager.interruptDownloadTask({
      taskId: activeTask.id,
      errorMessage: "Download process unresponsive",
      now: this.recoveredAt,
      clearLease: ownsLease && producerStopped ? lease : undefined,
    })
    if (interruption.outcome !== "applied") {
      return
    }
    await this.applyInterruptionEffects(
      activeTask.id,
      ownsLease,
      producerStopped,
      interruption.clearedLease
    )
    try {
      await notifyTerminalDownloadTask({
        task: interruption.task,
        finalStatus: interruption.task.status,
        completedCount: successfulChapters,
        totalChapters: activeTask.chapters.length,
        settingsRepository: this.settingsRepository,
      })
    } catch (error) {
      logger.warn("Unable to publish watchdog terminal notification", {
        taskId: activeTask.id,
        error,
      })
    }
  }
}

export async function recoverFromLivenessTimeout(
  stateManager: QueueRepository,
  nativeOutputCoordinator: NativeOutputCoordinator,
  terminalCoordinator: OffscreenJobTerminalCoordinator,
  queueScheduler: QueueScheduler,
  settingsRepository: Pick<SettingsRepository, "getSettings">
): Promise<void> {
  await new OffscreenLivenessRecovery(
    stateManager,
    nativeOutputCoordinator,
    terminalCoordinator,
    queueScheduler,
    settingsRepository
  ).run()
}

async function ensureOffscreenDocumentAdmission(): Promise<void> {
  if (await hasOffscreenDocument()) {
    const status = await queryOffscreenStatus()
    if (!status) {
      throw new Error("Existing offscreen document status is unavailable")
    }
    if (status.initializationState !== "failed") {
      logger.info("Offscreen document already present")
      return
    }
    const closeResult = await closeOffscreenDocumentIfCurrentInLifecycle({
      documentInstanceId: status.documentInstanceId,
    })
    if (closeResult !== "closed") {
      throw new Error(
        "Offscreen document changed during failed-document replacement"
      )
    }
  }

  releaseAllTransientWorkReservations()
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: [
      chrome.offscreen.Reason.BLOBS,
      chrome.offscreen.Reason.WORKERS,
      chrome.offscreen.Reason.DOM_PARSER,
    ],
    justification:
      "Create archives in a Web Worker (fflate), handle Blob-based downloads, and parse fetched series page HTML with DOMParser when no content script is available",
  })
  logger.info("Offscreen document created")
}

/**
 * Ensure the offscreen document exists before work is dispatched.
 */
export async function ensureOffscreenDocumentReady(): Promise<void> {
  await ensureLivenessAlarm()
  const admission =
    ensuringOffscreen ??
    (ensuringOffscreen = runOffscreenLifecycleOperation(
      ensureOffscreenDocumentAdmission
    ))

  try {
    await admission
  } finally {
    if (ensuringOffscreen === admission) ensuringOffscreen = null
  }
}

/**
 * Admit immediate offscreen work while holding the same lifecycle chain that
 * owns document creation and closure.
 */
export async function runOffscreenDocumentAdmissionExclusive<T>(
  operation: (context: OffscreenDocumentAdmissionContext) => Promise<T>
): Promise<T> {
  await ensureLivenessAlarm()
  return await runOffscreenLifecycleOperation(async () => {
    await ensureOffscreenDocumentAdmission()
    return await operation({ reserveTransientWork })
  })
}

/**
 * Query whether the offscreen document is ready and how much work it is doing.
 */
export async function queryOffscreenStatus(): Promise<{
  initializationState: OffscreenInitializationState
  activeJobCount: number
  activeTransientWorkCount: number
  activeTaskIds: string[]
  documentInstanceId: string
} | null> {
  try {
    if (!(await hasOffscreenDocument())) {
      return null
    }

    const response = await sendRuntimeMessage({
      target: "offscreen",
      type: "OFFSCREEN_STATUS",
    })

    if (response.success) {
      const activeTaskIds = [...new Set(response.activeTaskIds)].sort(
        (left, right) => left.localeCompare(right)
      )
      const activeJobCount = response.activeJobCount
      const activeTransientWorkCount = response.activeTransientWorkCount
      if (activeJobCount !== activeTaskIds.length) {
        return null
      }
      return {
        initializationState: response.initializationState,
        activeJobCount,
        activeTransientWorkCount,
        activeTaskIds,
        documentInstanceId: response.documentInstanceId,
      }
    }

    return null
  } catch (error) {
    logger.error("Error querying offscreen status:", error)
    return null
  }
}

/**
 * Close the offscreen document when it is idle and no native downloads remain.
 */
export async function scheduleOffscreenCloseIfIdle(
  queueRepository: QueueRepository,
  nativeOutputCoordinator: NativeOutputCoordinator
): Promise<void> {
  try {
    await runOffscreenLifecycleOperation(() =>
      closeIdleOffscreenDocument(queueRepository, nativeOutputCoordinator)
    )
  } catch (error) {
    logger.error("Error scheduling offscreen close:", error)
  }
}

async function closeIdleOffscreenDocument(
  queueRepository: QueueRepository,
  nativeOutputCoordinator: NativeOutputCoordinator
): Promise<void> {
  const candidate = await queryOffscreenStatus()
  if (!isIdleOffscreenStatus(candidate)) return
  const contexts = await getOffscreenContexts()
  if (contexts.length === 0) return
  const browserId = contexts
    .map(browserDocumentId)
    .find((id) => id !== undefined)
  const browserIsCurrent = await browserDocumentIsCurrent(contexts, browserId)
  const [lease, hasDependencies] = await Promise.all([
    queueRepository.getActiveDispatchLease(),
    nativeOutputCoordinator.hasLiveDependencies(),
  ])
  const current = await queryOffscreenStatus()
  if (
    !browserIsCurrent ||
    lease !== null ||
    hasDependencies ||
    !isIdleOffscreenStatus(current) ||
    current.documentInstanceId !== candidate.documentInstanceId
  )
    return
  await chrome.offscreen.closeDocument()
  logger.info("Offscreen document closed due to inactivity")
}

function isIdleOffscreenStatus(
  status: Awaited<ReturnType<typeof queryOffscreenStatus>>
): status is NonNullable<Awaited<ReturnType<typeof queryOffscreenStatus>>> {
  return (
    status !== null &&
    status.initializationState === "ready" &&
    status.activeJobCount === 0 &&
    status.activeTransientWorkCount === 0 &&
    activeTransientWorkReservations.size === 0
  )
}

function browserDocumentId(context: unknown): string | undefined {
  if (
    typeof context !== "object" ||
    context === null ||
    !("documentId" in context)
  )
    return undefined
  return typeof context.documentId === "string" ? context.documentId : undefined
}

function sameJobCoordinates(
  left: Pick<ActiveDispatchLease, "jobId" | "attempt" | "taskId" | "chapterId">,
  right: Pick<ActiveDispatchLease, "jobId" | "attempt" | "taskId" | "chapterId">
): boolean {
  return (
    left.jobId === right.jobId &&
    left.attempt === right.attempt &&
    left.taskId === right.taskId &&
    left.chapterId === right.chapterId
  )
}

function sameDispatchIdentity(
  left: ActiveDispatchLease,
  right: ActiveDispatchLease
): boolean {
  return (
    sameJobCoordinates(left, right) && left.fingerprint === right.fingerprint
  )
}

function canExpireUnboundLease(
  current: ActiveDispatchLease | null,
  captured: ActiveDispatchLease
): current is ActiveDispatchLease {
  return (
    current !== null &&
    current.documentInstanceId === undefined &&
    sameDispatchIdentity(current, captured) &&
    Date.now() > current.leaseExpiresAt
  )
}

async function browserDocumentIsCurrent(
  contexts: unknown[],
  documentId?: string
): Promise<boolean> {
  const current =
    documentId !== undefined ? await getOffscreenContexts() : contexts
  return (
    documentId === undefined ||
    current.some((context) => browserDocumentId(context) === documentId)
  )
}
