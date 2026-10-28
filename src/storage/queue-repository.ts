import {
  beginFsaWrite as decideFsaWrite,
  selectChromeFallback as decideChromeFallback,
} from "@/src/domain/queue/kernel"
import { getEffectiveTaskDestination } from "@/src/domain/queue/task-destination"
import {
  applyNativeOutputSettlement as decideNativeOutputSettlement,
  bindDispatchLeaseIncarnation as decideLeaseIncarnationBinding,
  beginChapterDispatch as decideChapterDispatch,
  blockTaskForProviderPolicy as decideProviderPolicyBlock,
  cancelDownloadTask as decideTaskCancellation,
  clearDispatchLease as decideLeaseClear,
  clearTerminalHistory as decideClearTerminalHistory,
  enqueueDownloadTask as decideTaskEnqueue,
  finalizeDownloadTask as decideTaskFinalization,
  finalizePendingUndoAction as decidePendingUndoFinalization,
  interruptDownloadTask as decideTaskInterruption,
  failTaskForSave as decideSaveFailure,
  moveQueuedTaskToTop as decideMoveQueuedTaskToTop,
  reconcileExpiredPendingUndoActions as decideExpiredPendingUndoReconciliation,
  recoverQueueAfterStartup as decideStartupRecovery,
  recordTaskDispatchError as decideTaskDispatchError,
  releaseProviderPolicyBlock as decideProviderPolicyBlockRelease,
  releaseProviderPolicyBlocks as decideProviderPolicyBlocksRelease,
  removeTerminalDownloadTask as decideTerminalTaskRemoval,
  renewDispatchLease as decideLeaseRenewal,
  restartDownloadTask as decideTaskRestart,
  restorePendingUndoAction as decidePendingUndoRestore,
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
import type { HistoryRepository } from "@/src/storage/history-repository"
import { reconcileCompletedChapterHistory } from "@/src/storage/completed-chapter-history"
import { composeDownloadedChapterKey } from "@/src/domain/history/types"

export class QueueRepository {
  private readonly mutations = new StorageMutationQueue()
  private hydrated = false
  private queueCache: DownloadTaskState[] = []
  private leaseCache: ActiveDispatchLease | null = null
  private pendingUndoCache: QueueAggregateState["pendingUndoActions"] = []

  constructor(
    private readonly projectionService: QueueProjectionService,
    private readonly historyRepository: HistoryRepository
  ) {}

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

      const retainedCompletions = new Map<
        string,
        { latest: number; confirmed?: number }
      >()
      for (const task of [
        ...decision.next.queue,
        ...decision.next.pendingUndoActions.map(
          (action) => action.taskSnapshot
        ),
      ]) {
        for (const chapter of task.chapters) {
          if (chapter.status !== "completed") continue
          const key = composeDownloadedChapterKey(
            task.siteIntegrationId,
            task.mangaId,
            chapter.id
          )
          const retained = retainedCompletions.get(key)
          retainedCompletions.set(key, {
            latest: Math.max(retained?.latest ?? 0, chapter.lastUpdated),
            confirmed:
              chapter.saveConfirmedAt === undefined
                ? retained?.confirmed
                : Math.max(retained?.confirmed ?? 0, chapter.lastUpdated),
          })
        }
      }
      const lostHistorySources = [
        ...state.queue,
        ...state.pendingUndoActions.map((action) => action.taskSnapshot),
      ]
        .map((task) => ({
          ...task,
          chapters: task.chapters.filter((chapter) => {
            if (chapter.status !== "completed") return false
            const key = composeDownloadedChapterKey(
              task.siteIntegrationId,
              task.mangaId,
              chapter.id
            )
            const retained = retainedCompletions.get(key)
            const retainedAt =
              chapter.saveConfirmedAt === undefined
                ? retained?.latest
                : retained?.confirmed
            return retainedAt === undefined || retainedAt < chapter.lastUpdated
          }),
        }))
        .filter((task) => task.chapters.length > 0)
      // Store chapter history before deleting its last durable repair source.
      // A failed history write aborts this queue/Undo mutation.
      if (lostHistorySources.length > 0) {
        await reconcileCompletedChapterHistory(
          lostHistorySources,
          this.historyRepository
        )
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

  async getRetainedHandleIds(): Promise<Set<string>> {
    return this.mutations.run(async () => {
      const state = await this.hydrateLocked()
      const ids = new Set(
        [
          ...state.queue,
          ...state.pendingUndoActions.map((action) => action.taskSnapshot),
        ].flatMap((task) => {
          const destination = getEffectiveTaskDestination(task)
          return destination.kind === "file-system-access" &&
            destination.handleId
            ? [destination.handleId]
            : []
        })
      )
      if (state.lease?.destinationHandleId)
        ids.add(state.lease.destinationHandleId)
      return ids
    })
  }

  async getTask(taskId: string): Promise<DownloadTaskState | undefined> {
    const queue = await this.getQueue()
    return queue.find((task) => task.id === taskId)
  }

  async beginFsaWrite(input: Parameters<typeof decideFsaWrite>[1]) {
    const detachedInput = structuredClone(input)
    return await this.executeDecision((state) =>
      decideFsaWrite(state, detachedInput)
    )
  }

  async selectChromeFallback(
    input: Parameters<typeof decideChromeFallback>[1]
  ) {
    const detachedInput = structuredClone(input)
    return await this.executeDecision((state) =>
      decideChromeFallback(state, detachedInput)
    )
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

  async failTaskForSave(
    input: Parameters<typeof decideSaveFailure>[1]
  ): Promise<ReturnType<typeof decideSaveFailure>["result"]> {
    const detachedInput = structuredClone(input)
    return this.executeDecision((state) =>
      decideSaveFailure(state, detachedInput)
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
