import {
  applyNativeOutputSettlement as decideNativeOutputSettlement,
  bindDispatchLeaseIncarnation as decideLeaseIncarnationBinding,
  beginChapterDispatch as decideChapterDispatch,
  blockTaskForDestination as decideDestinationBlock,
  blockTaskForNativeOutputAction as decideNativeOutputActionBlock,
  blockTaskForProviderPolicy as decideProviderPolicyBlock,
  cancelDownloadTask as decideTaskCancellation,
  clearDispatchLease as decideLeaseClear,
  clearTerminalHistory as decideClearTerminalHistory,
  enqueueDownloadTask as decideTaskEnqueue,
  finalizeDownloadTask as decideTaskFinalization,
  finalizePendingUndoAction as decidePendingUndoFinalization,
  interruptDownloadTask as decideTaskInterruption,
  moveQueuedTaskToTop as decideMoveQueuedTaskToTop,
  reconcileExpiredPendingUndoActions as decideExpiredPendingUndoReconciliation,
  recoverQueueAfterStartup as decideStartupRecovery,
  recordTaskDispatchError as decideTaskDispatchError,
  releaseDestinationBlock as decideDestinationBlockRelease,
  releaseNativeOutputActionBlock as decideNativeOutputActionBlockRelease,
  releaseProviderPolicyBlock as decideProviderPolicyBlockRelease,
  releaseProviderPolicyBlocks as decideProviderPolicyBlocksRelease,
  removeTerminalDownloadTask as decideTerminalTaskRemoval,
  renewDispatchLease as decideLeaseRenewal,
  restartDownloadTask as decideTaskRestart,
  restorePendingUndoAction as decidePendingUndoRestore,
  resumeDestinationTask as decideDestinationResume,
  retryFailedChapters as decideFailedChapterRetry,
  setNextChapterDispatchAt as decideNextChapterDispatch,
  settleTaskChapter as decideChapterSettlement,
  startDownloadTask as decideTaskStart,
  updateChapterProgress as decideChapterProgress,
  type QueueKernelDecision,
  type TaskChapterUpdate,
} from "@/src/domain/queue/kernel"
import type {
  ActiveDispatchLease,
  DispatchLeaseAuthority,
  DownloadTaskState,
  OffscreenJobStage,
  QueueAggregateState,
} from "@/src/domain/queue/state"
import { LOCAL_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import type { QueueProjectionService } from "@/src/storage/queue-projection-service"
import { StorageMutationQueue } from "./storage-mutation-queue"
import {
  parseCurrentActiveDispatchLease,
  parseCurrentDownloadQueue,
  parseCurrentPendingUndoActions,
} from "./queue-state-codecs"
import logger from "@/src/runtime/logger"

export class QueueRepository {
  private readonly mutations = new StorageMutationQueue()
  private hydrated = false
  private queueCache: DownloadTaskState[] = []
  private leaseCache: ActiveDispatchLease | null = null
  private pendingUndoCache: QueueAggregateState["pendingUndoActions"] = []

  constructor(private readonly projectionService: QueueProjectionService) {}

  private invalidate(): void {
    this.hydrated = false
    this.queueCache = []
    this.leaseCache = null
    this.pendingUndoCache = []
  }

  private snapshot(): QueueAggregateState {
    return structuredClone({
      queue: this.queueCache,
      lease: this.leaseCache,
      pendingUndoActions: this.pendingUndoCache,
    })
  }

  private async hydrateLocked(): Promise<QueueAggregateState> {
    if (this.hydrated) return this.snapshot()

    try {
      const stored = await chrome.storage.local.get([
        LOCAL_STORAGE_KEYS.downloadQueue,
        LOCAL_STORAGE_KEYS.activeDispatchLease,
        LOCAL_STORAGE_KEYS.pendingUndoActions,
      ])
      this.queueCache = structuredClone(
        parseCurrentDownloadQueue(stored[LOCAL_STORAGE_KEYS.downloadQueue])
      )
      this.leaseCache = structuredClone(
        parseCurrentActiveDispatchLease(
          stored[LOCAL_STORAGE_KEYS.activeDispatchLease]
        )
      )
      this.pendingUndoCache = structuredClone(
        parseCurrentPendingUndoActions(
          stored[LOCAL_STORAGE_KEYS.pendingUndoActions]
        )
      )
      this.hydrated = true
      return this.snapshot()
    } catch (error) {
      this.invalidate()
      throw error
    }
  }

  private async writeLocked(
    values: Record<string, unknown>,
    next: QueueAggregateState
  ): Promise<void> {
    try {
      await chrome.storage.local.set(structuredClone(values))
    } catch (error) {
      this.invalidate()
      throw error
    }

    if (Object.hasOwn(values, LOCAL_STORAGE_KEYS.downloadQueue)) {
      this.queueCache = structuredClone(next.queue)
    }
    if (Object.hasOwn(values, LOCAL_STORAGE_KEYS.activeDispatchLease)) {
      this.leaseCache = structuredClone(next.lease)
    }
    if (Object.hasOwn(values, LOCAL_STORAGE_KEYS.pendingUndoActions)) {
      this.pendingUndoCache = structuredClone(next.pendingUndoActions)
    }
    this.hydrated = true
  }

  private async executeDecision<TResult>(
    decide: (state: QueueAggregateState) => QueueKernelDecision<TResult>
  ): Promise<TResult> {
    const committed = await this.mutations.run(async () => {
      const state = await this.hydrateLocked()
      const decision = decide(state)
      if (decision.changedKeys.length === 0) {
        return { result: decision.result, queue: null }
      }

      const values: Record<string, unknown> = {}
      for (const key of decision.changedKeys) {
        switch (key) {
          case "queue":
            values[LOCAL_STORAGE_KEYS.downloadQueue] = decision.next.queue
            break
          case "lease":
            values[LOCAL_STORAGE_KEYS.activeDispatchLease] = decision.next.lease
            break
          case "pendingUndoActions":
            values[LOCAL_STORAGE_KEYS.pendingUndoActions] =
              decision.next.pendingUndoActions
            break
        }
      }

      await this.writeLocked(values, decision.next)
      return {
        result: decision.result,
        queue: decision.changedKeys.includes("queue")
          ? decision.next.queue
          : null,
      }
    })
    if (committed.queue) {
      try {
        await this.projectionService.publish(committed.queue)
      } catch (error) {
        logger.warn(
          "Durable queue commit succeeded but its session projection failed",
          error
        )
      }
    }
    return structuredClone(committed.result)
  }

  async initialize(): Promise<void> {
    const queue = await this.mutations.run(async () => {
      this.invalidate()
      const state = await this.hydrateLocked()
      return structuredClone(state.queue)
    })
    await this.projectionService.publish(queue)
  }

  async getQueue(): Promise<DownloadTaskState[]> {
    return await this.mutations.run(async () => {
      const state = await this.hydrateLocked()
      return structuredClone(state.queue)
    })
  }

  async getTask(taskId: string): Promise<DownloadTaskState | undefined> {
    const queue = await this.getQueue()
    return queue.find((task) => task.id === taskId)
  }

  async getActiveDispatchLease(): Promise<ActiveDispatchLease | null> {
    return await this.mutations.run(async () => {
      const state = await this.hydrateLocked()
      return structuredClone(state.lease)
    })
  }

  async enqueueDownloadTask(
    task: DownloadTaskState
  ): Promise<ReturnType<typeof decideTaskEnqueue>["result"]> {
    const detachedTask = structuredClone(task)
    return await this.executeDecision((state) =>
      decideTaskEnqueue(state, { task: detachedTask })
    )
  }

  async recoverQueueAfterStartup(
    input: Parameters<typeof decideStartupRecovery>[1]
  ): Promise<ReturnType<typeof decideStartupRecovery>["result"]> {
    const detachedInput = structuredClone(input)
    return await this.executeDecision((state) =>
      decideStartupRecovery(state, detachedInput)
    )
  }

  async applyNativeOutputSettlement(
    input: Parameters<typeof decideNativeOutputSettlement>[1]
  ): Promise<ReturnType<typeof decideNativeOutputSettlement>["result"]> {
    const detachedInput = structuredClone(input)
    return await this.executeDecision((state) =>
      decideNativeOutputSettlement(state, detachedInput)
    )
  }

  async startDownloadTask(input: {
    taskId: string
    now: number
  }): Promise<ReturnType<typeof decideTaskStart>["result"]> {
    const detachedInput = structuredClone(input)
    return await this.executeDecision((state) =>
      decideTaskStart(state, detachedInput)
    )
  }

  async recordTaskDispatchError(input: {
    taskId: string
    errorMessage?: string
    errorCategory?: DownloadTaskState["errorCategory"]
  }): Promise<ReturnType<typeof decideTaskDispatchError>["result"]> {
    const detachedInput = structuredClone(input)
    return await this.executeDecision((state) =>
      decideTaskDispatchError(state, detachedInput)
    )
  }

  async setNextChapterDispatchAt(input: {
    taskId: string
    nextChapterDispatchAt: number | undefined
  }): Promise<ReturnType<typeof decideNextChapterDispatch>["result"]> {
    const detachedInput = structuredClone(input)
    return await this.executeDecision((state) =>
      decideNextChapterDispatch(state, detachedInput)
    )
  }

  async releaseProviderPolicyBlocks(): Promise<
    ReturnType<typeof decideProviderPolicyBlocksRelease>["result"]
  > {
    return await this.executeDecision(decideProviderPolicyBlocksRelease)
  }

  async retryFailedChapters(input: {
    taskId: string
    retryTaskId: string
    now: number
  }): Promise<ReturnType<typeof decideFailedChapterRetry>["result"]> {
    const detachedInput = structuredClone(input)
    return await this.executeDecision((state) =>
      decideFailedChapterRetry(state, detachedInput)
    )
  }

  async restartDownloadTask(input: {
    taskId: string
    restartTaskId: string
    now: number
  }): Promise<ReturnType<typeof decideTaskRestart>["result"]> {
    const detachedInput = structuredClone(input)
    return await this.executeDecision((state) =>
      decideTaskRestart(state, detachedInput)
    )
  }

  async moveQueuedTaskToTop(
    taskId: string
  ): Promise<ReturnType<typeof decideMoveQueuedTaskToTop>["result"]> {
    return await this.executeDecision((state) =>
      decideMoveQueuedTaskToTop(state, { taskId })
    )
  }

  async clearTerminalHistory(): Promise<
    ReturnType<typeof decideClearTerminalHistory>["result"]
  > {
    return await this.executeDecision(decideClearTerminalHistory)
  }

  async resumeDestinationTask(input: {
    taskId: string
    destinationOverride: "downloads-api" | undefined
    now: number
  }): Promise<ReturnType<typeof decideDestinationResume>["result"]> {
    const detachedInput = structuredClone(input)
    return await this.executeDecision((state) =>
      decideDestinationResume(state, detachedInput)
    )
  }

  async updateChapterProgress(input: {
    taskId: string
    chapterId: string
    lease: DispatchLeaseAuthority
    now: number
    updates?: TaskChapterUpdate
  }): Promise<ReturnType<typeof decideChapterProgress>["result"]> {
    const detachedInput = structuredClone(input)
    return await this.executeDecision((state) =>
      decideChapterProgress(state, detachedInput)
    )
  }

  async settleTaskChapter(input: {
    taskId: string
    chapterId: string
    status: "completed" | "partial_success" | "failed"
    lease?: DispatchLeaseAuthority
    now: number
    updates?: TaskChapterUpdate
  }): Promise<ReturnType<typeof decideChapterSettlement>["result"]> {
    const detachedInput = structuredClone(input)
    return await this.executeDecision((state) =>
      decideChapterSettlement(state, detachedInput)
    )
  }

  async beginChapterDispatch(input: {
    taskId: string
    chapterId: string
    lease: ActiveDispatchLease
    expectedPreviousLease: DispatchLeaseAuthority | null
    now: number
  }): Promise<ReturnType<typeof decideChapterDispatch>["result"]> {
    const detachedInput = structuredClone(input)
    return await this.executeDecision((state) =>
      decideChapterDispatch(state, detachedInput)
    )
  }

  async renewDispatchLease(input: {
    jobId: string
    taskId: string
    chapterId: string
    attempt: number
    fingerprint: string
    documentInstanceId: string
    eventSignature: string
    stage: OffscreenJobStage
    sequence: number
    activityAt: number
    requireSequenceAdvance?: boolean
  }): Promise<ReturnType<typeof decideLeaseRenewal>["result"]> {
    const detachedInput = structuredClone(input)
    return await this.executeDecision((state) =>
      decideLeaseRenewal(state, detachedInput)
    )
  }

  async bindDispatchLeaseIncarnation(input: {
    jobId: string
    taskId: string
    chapterId: string
    attempt: number
    fingerprint: string
    documentInstanceId: string
  }): Promise<ReturnType<typeof decideLeaseIncarnationBinding>["result"]> {
    const detachedInput = structuredClone(input)
    return await this.executeDecision((state) =>
      decideLeaseIncarnationBinding(state, detachedInput)
    )
  }

  async clearDispatchLease(
    identity: DispatchLeaseAuthority
  ): Promise<ReturnType<typeof decideLeaseClear>["result"]> {
    const detachedIdentity = structuredClone(identity)
    return await this.executeDecision((state) =>
      decideLeaseClear(state, { identity: detachedIdentity })
    )
  }

  async blockTaskForDestination(
    input: Parameters<typeof decideDestinationBlock>[1]
  ): Promise<ReturnType<typeof decideDestinationBlock>["result"]> {
    const detachedInput = structuredClone(input)
    return await this.executeDecision((state) =>
      decideDestinationBlock(state, detachedInput)
    )
  }

  async releaseDestinationBlock(
    taskId: string
  ): Promise<ReturnType<typeof decideDestinationBlockRelease>["result"]> {
    return await this.executeDecision((state) =>
      decideDestinationBlockRelease(state, { taskId })
    )
  }

  async blockTaskForProviderPolicy(input: {
    taskId: string
    block:
      | "provider_network_policy_pending"
      | "provider_network_policy_action_required"
  }): Promise<ReturnType<typeof decideProviderPolicyBlock>["result"]> {
    const detachedInput = structuredClone(input)
    return await this.executeDecision((state) =>
      decideProviderPolicyBlock(state, detachedInput)
    )
  }

  async releaseProviderPolicyBlock(
    taskId: string
  ): Promise<ReturnType<typeof decideProviderPolicyBlockRelease>["result"]> {
    return await this.executeDecision((state) =>
      decideProviderPolicyBlockRelease(state, { taskId })
    )
  }

  async blockTaskForNativeOutputAction(input: {
    taskId: string
    errorMessage: string
  }): Promise<ReturnType<typeof decideNativeOutputActionBlock>["result"]> {
    const detachedInput = structuredClone(input)
    return await this.executeDecision((state) =>
      decideNativeOutputActionBlock(state, detachedInput)
    )
  }

  async releaseNativeOutputActionBlock(
    taskId: string
  ): Promise<
    ReturnType<typeof decideNativeOutputActionBlockRelease>["result"]
  > {
    return await this.executeDecision((state) =>
      decideNativeOutputActionBlockRelease(state, { taskId })
    )
  }

  async interruptDownloadTask(
    input: Parameters<typeof decideTaskInterruption>[1]
  ): Promise<ReturnType<typeof decideTaskInterruption>["result"]> {
    const detachedInput = structuredClone(input)
    return await this.executeDecision((state) =>
      decideTaskInterruption(state, detachedInput)
    )
  }

  async finalizeDownloadTask(
    input: Parameters<typeof decideTaskFinalization>[1]
  ): Promise<ReturnType<typeof decideTaskFinalization>["result"]> {
    const detachedInput = structuredClone(input)
    return await this.executeDecision((state) =>
      decideTaskFinalization(state, detachedInput)
    )
  }

  async cancelDownloadTask(
    input: Parameters<typeof decideTaskCancellation>[1]
  ): Promise<ReturnType<typeof decideTaskCancellation>["result"]> {
    const detachedInput = structuredClone(input)
    return await this.executeDecision((state) =>
      decideTaskCancellation(state, detachedInput)
    )
  }

  async removeTerminalDownloadTask(
    input: Parameters<typeof decideTerminalTaskRemoval>[1]
  ): Promise<ReturnType<typeof decideTerminalTaskRemoval>["result"]> {
    const detachedInput = structuredClone(input)
    return await this.executeDecision((state) =>
      decideTerminalTaskRemoval(state, detachedInput)
    )
  }

  async restorePendingUndoAction(
    input: Parameters<typeof decidePendingUndoRestore>[1]
  ): Promise<ReturnType<typeof decidePendingUndoRestore>["result"]> {
    const detachedInput = structuredClone(input)
    return await this.executeDecision((state) =>
      decidePendingUndoRestore(state, detachedInput)
    )
  }

  async finalizePendingUndoAction(
    token: string
  ): Promise<ReturnType<typeof decidePendingUndoFinalization>["result"]> {
    return await this.executeDecision((state) =>
      decidePendingUndoFinalization(state, { token })
    )
  }

  async reconcileExpiredPendingUndoActions(
    now: number
  ): Promise<
    ReturnType<typeof decideExpiredPendingUndoReconciliation>["result"]
  > {
    return await this.executeDecision((state) =>
      decideExpiredPendingUndoReconciliation(state, { now })
    )
  }
}
