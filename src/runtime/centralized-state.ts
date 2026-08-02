/**
 * Centralized State Management for Chrome Extension
 *
 * Implements a durable-commit cache pattern: storage.local is authoritative,
 * an in-memory copy serves reads after initialization, and storage.session
 * contains best-effort UI projections.
 * The Service Worker is the ONLY component authorized to modify state.
 * All UIs listen to storage changes and render accordingly.
 */

import logger from "@/src/runtime/logger"
import { DEFAULT_SETTINGS } from "@/src/storage/default-settings"
import { initializeChapterStates } from "./state-helpers"
import { tabContextCache } from "@/entrypoints/background/tab-cache"
import {
  LOCAL_STORAGE_KEYS,
  SESSION_STORAGE_KEYS,
} from "@/src/runtime/storage-keys"
import { projectToQueueView, updateActionBadge } from "@/src/runtime/projection"
import { normalizeDestinationIssues } from "@/src/runtime/destination-issue-state"

import { normalizePersistedDownloadTask } from "./persisted-download-task"
import {
  isGlobalAppState,
  isMangaPageState,
  resolveVolumeStates,
} from "./state-shapes"
import type {
  ActiveDispatchLease,
  DestinationIssue,
  DownloadTaskState,
  GlobalAppState,
  PendingUndoAction,
  PendingUndoReceipt,
} from "@/src/types/queue-state"
import type { ChapterState, MangaPageState } from "@/src/types/tab-state"
import { runDispatchPersistenceExclusive } from "./dispatch-persistence-gate"
import { normalizeActiveDispatchLease } from "./active-dispatch-lease"
import {
  normalizePendingUndoActions,
  PENDING_UNDO_WINDOW_MS,
  toPendingUndoReceipt,
} from "./pending-undo-actions"
import {
  beginChapterDispatchInQueue,
  cancelDownloadingTask,
  transitionDownloadTaskInQueue,
  updateDownloadTaskInQueue,
  updateTaskChapterInQueue,
  type BeginChapterDispatchTransitionResult,
  type DownloadingTaskChapterUpdateResult,
  type DownloadTaskTransitionResult,
  type TaskChapterUpdate,
} from "./download-queue-transitions"
import type { ChapterStatus } from "@/src/types/chapter"
import type { DownloadTaskStatus } from "@/src/shared/download-contract"

// Re-export helpers for convenience
export {
  sendStateAction,
  cancelDownloadTask,
  undoPendingAction,
} from "./state-actions"
export { toQueueTaskSummary } from "./queue-task-summary"
export type {
  DownloadTaskTransitionResult,
  DownloadingTaskChapterUpdateResult,
} from "./download-queue-transitions"

export type RemoveTerminalDownloadTaskResult =
  | { success: true; undo: PendingUndoReceipt }
  | { success: false; reason: "not-found" }
  | {
      success: false
      reason: "invalid-status"
      currentStatus: DownloadTaskStatus
    }

export type BeginChapterDispatchResult =
  | { success: true; updated: true }
  | Exclude<DownloadingTaskChapterUpdateResult, { success: true }>
  | { success: false; reason: "chapter-not-dispatchable" }
  | { success: false; reason: "dispatch-lease-conflict" }

export type DestinationIssuesMutation =
  | { type: "upsert"; issue: DestinationIssue }
  | { type: "clear-task"; taskId: string }

export type CancelDownloadTaskTransitionResult =
  | {
      success: true
      task: DownloadTaskState
      canceledLease: ActiveDispatchLease | null
      undo?: PendingUndoReceipt | null
    }
  | Exclude<DownloadTaskTransitionResult, { success: true }>

export type RestorePendingUndoActionResult =
  | { success: true; action: PendingUndoAction }
  | {
      success: false
      reason: "not-found" | "expired"
      action?: PendingUndoAction
    }

export type FinalizePendingUndoActionResult =
  | { success: true; action: PendingUndoAction }
  | { success: false; reason: "not-found" }

export interface ReconcilePendingUndoActionsResult {
  finalized: PendingUndoAction[]
  pending: PendingUndoAction[]
}

/**
 * State Manager - Service Worker Only
 *
 * @internal This class should ONLY be instantiated in the Service Worker (background.ts).
 * Other components should use typed runtime messages and storage-backed subscription hooks.
 *
 * CRITICAL: Do not import and instantiate this class directly in content scripts or popup.
 * The runtime check in the constructor will throw an error if used outside Service Worker context.
 */
export class CentralizedStateManager {
  private initialized = false
  private locks = new Map<string, Promise<void>>()
  // Hydrated from storage.local during initialize() and replaced only after a
  // successful durable write. Callers receive copies so they cannot expose an
  // uncommitted mutation through this cache.
  private globalStateCache: GlobalAppState | null = null

  private cloneGlobalState(state: GlobalAppState): GlobalAppState {
    return structuredClone(state)
  }

  private normalizeDownloadQueue(value: unknown): DownloadTaskState[] {
    if (!Array.isArray(value)) {
      return []
    }

    return value
      .map(normalizePersistedDownloadTask)
      .filter((task): task is DownloadTaskState => task !== null)
  }

  private async readPendingUndoActions(): Promise<PendingUndoAction[]> {
    const result = await chrome.storage.local.get(
      LOCAL_STORAGE_KEYS.pendingUndoActions
    )
    return normalizePendingUndoActions(
      result[LOCAL_STORAGE_KEYS.pendingUndoActions]
    )
  }

  private createPendingUndoAction(
    type: PendingUndoAction["type"],
    taskSnapshot: DownloadTaskState,
    previousQueuePosition: number,
    now: number
  ): PendingUndoAction {
    return {
      token: crypto.randomUUID(),
      type,
      taskSnapshot: structuredClone(taskSnapshot),
      previousQueuePosition,
      createdAt: now,
      expiresAt: now + PENDING_UNDO_WINDOW_MS,
    }
  }

  private insertPendingUndoTask(
    queue: DownloadTaskState[],
    action: PendingUndoAction,
    task: DownloadTaskState
  ): void {
    if (queue.some((candidate) => candidate.id === task.id)) return
    const insertionIndex = Math.min(action.previousQueuePosition, queue.length)
    queue.splice(insertionIndex, 0, structuredClone(task))
  }

  private applyExpiredPendingUndoAction(
    state: GlobalAppState,
    action: PendingUndoAction
  ): void {
    if (action.type !== "cancel_queued") return

    const canceledAt = action.createdAt
    const canceledTask: DownloadTaskState = {
      ...structuredClone(action.taskSnapshot),
      status: "canceled",
      activeBlock: undefined,
      browserDownloadWait: undefined,
      errorMessage: undefined,
      errorCategory: undefined,
      completed: canceledAt,
      chapters: action.taskSnapshot.chapters.map((chapter) => {
        if (chapter.status === "downloading") {
          return {
            ...chapter,
            status: "canceled",
            errorMessage: "Canceled by user",
            lastUpdated: canceledAt,
          }
        }
        if (chapter.status === "queued") {
          return {
            ...chapter,
            status: "skipped",
            errorMessage: "Skipped after task cancellation",
            lastUpdated: canceledAt,
          }
        }
        return structuredClone(chapter)
      }),
    }
    this.insertPendingUndoTask(state.downloadQueue, action, canceledTask)
  }

  private async readSessionGlobalState(): Promise<GlobalAppState | null> {
    try {
      const result = await chrome.storage.session.get(
        SESSION_STORAGE_KEYS.globalState
      )
      const state = result[SESSION_STORAGE_KEYS.globalState]
      return isGlobalAppState(state) ? state : null
    } catch (error) {
      logger.debug("Failed to read global state projection (non-fatal):", error)
      return null
    }
  }

  private async readAuthoritativeGlobalState(): Promise<GlobalAppState> {
    const persistedQueueResult = await chrome.storage.local.get(
      LOCAL_STORAGE_KEYS.downloadQueue
    )
    const downloadQueue = this.normalizeDownloadQueue(
      persistedQueueResult[LOCAL_STORAGE_KEYS.downloadQueue]
    )
    const projectedState = await this.readSessionGlobalState()

    return projectedState
      ? {
          ...this.cloneGlobalState(projectedState),
          downloadQueue,
        }
      : {
          ...this.getDefaultGlobalState(),
          downloadQueue,
        }
  }

  private async syncGlobalStateProjection(
    state: GlobalAppState
  ): Promise<void> {
    try {
      await chrome.storage.session.set({
        [SESSION_STORAGE_KEYS.globalState]: this.cloneGlobalState(state),
      })
    } catch (error) {
      logger.debug("Failed to sync global state projection (non-fatal):", error)
    }
  }

  private async syncQueueProjection(
    downloadQueue: DownloadTaskState[]
  ): Promise<void> {
    try {
      const projection = projectToQueueView(downloadQueue)
      await chrome.storage.session.set({
        [SESSION_STORAGE_KEYS.queueView]: projection.queueView,
        [SESSION_STORAGE_KEYS.historyView]: projection.historyView,
      })
      await updateActionBadge(projection.nonTerminalCount)
    } catch (error) {
      logger.debug("Failed to sync queue projection (non-fatal):", error)
    }
  }

  private async syncActiveTabContext(
    tabId: number,
    context: MangaPageState | null,
    options?: {
      requestId?: number
      windowId?: number
      supersedeInFlight?: boolean
    }
  ): Promise<void> {
    try {
      await tabContextCache.syncActiveTabContext(tabId, context, options)
    } catch (error) {
      logger.debug("Failed to sync active tab context (non-fatal):", error)
    }
  }

  constructor() {
    if (
      typeof chrome === "undefined" ||
      typeof chrome.storage === "undefined"
    ) {
      throw new Error("StateManager can only be used in Service Worker context")
    }
  }

  /**
   * Acquire a lock for a given key
   * @internal Race condition protection for critical operations
   *
   * SW restart safety: The `locks` Map is in-memory and ephemeral. On service
   * worker restart, a fresh `CentralizedStateManager` is constructed with an
   * empty Map, so stale locks from a previous lifetime are automatically
   * cleared. The `setTimeout` timeout below handles within-lifetime hangs
   * where a lock holder's operation stalls indefinitely.
   */
  // Safe under JS's single-threaded model: Map.get → new Promise → Map.set
  // runs synchronously with no await between them, so two concurrent callers
  // cannot both observe an empty lock slot. The first await is at Promise.race
  // below, which is after the Map.set.
  private async acquireLock(
    lockKey: string,
    timeoutMs: number = 5000
  ): Promise<() => void> {
    const previousLock = this.locks.get(lockKey)

    let releaseLock!: () => void
    const lockPromise = new Promise<void>((resolve) => {
      releaseLock = resolve
    })

    const lockChain = (previousLock ?? Promise.resolve()).then(
      () => lockPromise
    )
    this.locks.set(lockKey, lockChain)

    if (previousLock) {
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined

      try {
        await Promise.race([
          previousLock,
          new Promise<never>((_, reject) => {
            timeoutHandle = setTimeout(() => {
              reject(new Error(`Lock timeout: ${lockKey}`))
            }, timeoutMs)
          }),
        ])
      } catch (error) {
        if (timeoutHandle !== undefined) {
          clearTimeout(timeoutHandle)
        }

        releaseLock()

        // The waiter owns this chain node, but it must not remove the node
        // while its predecessor is still live. Resolve this waiter's portion
        // and clean up only after the complete owned chain settles.
        void lockChain.then(() => {
          if (this.locks.get(lockKey) === lockChain) {
            this.locks.delete(lockKey)
          }
        })
        throw error
      }

      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle)
      }
    }

    // Return release function
    return () => {
      if (this.locks.get(lockKey) === lockChain) {
        this.locks.delete(lockKey)
      }
      releaseLock()
    }
  }

  /**
   * Initialize state manager
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    try {
      await chrome.storage.session.setAccessLevel({
        accessLevel: "TRUSTED_CONTEXTS",
      })

      await this.initializeGlobalState()

      this.initialized = true
      logger.info("✅ CentralizedStateManager initialized")
    } catch (error) {
      logger.error("❌ StateManager initialization failed:", error)
      throw error
    }
  }

  /**
   * Initialize global application state
   */
  private async initializeGlobalState(): Promise<void> {
    const initialState = await this.readAuthoritativeGlobalState()

    await chrome.storage.local.set({
      [LOCAL_STORAGE_KEYS.downloadQueue]: structuredClone(
        initialState.downloadQueue
      ),
    })
    this.globalStateCache = this.cloneGlobalState(initialState)
    await this.syncGlobalStateProjection(initialState)
    await this.syncQueueProjection(initialState.downloadQueue)
    logger.info("🌍 Global state initialized")
  }

  /**
   * Get state for specific tab
   */
  async getTabState(tabId: number): Promise<MangaPageState | null> {
    const result = await chrome.storage.session.get(`tab_${tabId}`)
    const maybeState = result[`tab_${tabId}`]
    return isMangaPageState(maybeState) ? maybeState : null
  }

  /**
   * Update state for specific tab
   */
  async updateTabState(
    tabId: number,
    state: Partial<MangaPageState>
  ): Promise<void> {
    const existing = await this.getTabState(tabId)
    // Allow partial updates even if no existing state
    const base: Partial<MangaPageState> = existing ?? {}
    const updatedState: MangaPageState = {
      ...(base as MangaPageState),
      ...(state as MangaPageState),
      volumes: Array.isArray(state.volumes)
        ? state.volumes
        : Array.isArray(base.volumes)
          ? base.volumes
          : [],
      lastUpdated: Date.now(),
    }

    await chrome.storage.session.set({ [`tab_${tabId}`]: updatedState })
    await this.syncActiveTabContext(tabId, updatedState)
    logger.info(`📊 Tab ${tabId} state updated`)
  }

  /**
   * Initialize manga page state for a tab
   *
   * Race condition protection: Uses optimistic locking to prevent simultaneous
   * initialization calls (e.g., from rapid page refreshes) from overwriting each other.
   */
  async initializeTabState(
    tabId: number,
    siteId: string,
    seriesId: string,
    seriesTitle: string,
    chapters: Omit<ChapterState, "status" | "lastUpdated">[],
    metadata?: MangaPageState["metadata"],
    volumes?: MangaPageState["volumes"],
    chaptersLoading?: boolean,
    initializationOptions?: {
      requestId?: number
      windowId?: number
      supersedeInFlight?: boolean
      chapterListNotice?: MangaPageState["chapterListNotice"]
    }
  ): Promise<boolean> {
    const { chapterListNotice, ...projectionOptions } =
      initializationOptions ?? {}
    const lockKey = `tab_${tabId}_init`
    const releaseLock = await this.acquireLock(lockKey)

    try {
      return await tabContextCache.commitTabContextMutation(
        tabId,
        initializationOptions ? projectionOptions : undefined,
        async () => {
          const existingState = await this.getTabState(tabId)

          if (
            existingState &&
            existingState.siteIntegrationId === siteId &&
            existingState.mangaId === seriesId
          ) {
            logger.info(
              `🔄 Updating existing state for tab ${tabId}: ${seriesTitle}`
            )

            const existingChapterStates = new Map<string, ChapterState>()
            existingState.chapters.forEach((chapter) => {
              existingChapterStates.set(chapter.id, chapter)
            })

            const updatedState: MangaPageState = {
              ...existingState,
              seriesTitle,
              chapters: chapters.map((chapter) => {
                const existingChapter = existingChapterStates.get(chapter.id)
                return {
                  ...chapter,
                  status: existingChapter?.status ?? "queued",
                  errorMessage: existingChapter?.errorMessage,
                  totalImages: existingChapter?.totalImages,
                  imagesFailed: existingChapter?.imagesFailed,
                  lastUpdated: existingChapter?.lastUpdated || Date.now(),
                }
              }),
              volumes: resolveVolumeStates(chapters, volumes),
              metadata: metadata ?? existingState.metadata,
              ...(typeof chaptersLoading === "boolean"
                ? { chaptersLoading }
                : {}),
              ...(chapterListNotice
                ? { chapterListNotice }
                : { chapterListNotice: undefined }),
              lastUpdated: Date.now(),
            }

            await chrome.storage.session.remove(`seriesContextError_${tabId}`)
            await chrome.storage.session.set({ [`tab_${tabId}`]: updatedState })
            logger.info(
              `✅ Updated ${updatedState.chapters.length} chapters for tab ${tabId}`
            )
            return updatedState
          }

          logger.info(
            `🆕 Creating fresh state for tab ${tabId}: ${seriesTitle}`
          )

          const initialState: MangaPageState = {
            siteIntegrationId: siteId,
            mangaId: seriesId,
            seriesTitle,
            chapters: initializeChapterStates(chapters),
            volumes: resolveVolumeStates(chapters, volumes),
            metadata,
            ...(typeof chaptersLoading === "boolean"
              ? { chaptersLoading }
              : {}),
            ...(chapterListNotice ? { chapterListNotice } : {}),
            lastUpdated: Date.now(),
          }

          await chrome.storage.session.remove(`seriesContextError_${tabId}`)
          await chrome.storage.session.set({ [`tab_${tabId}`]: initialState })
          logger.info(
            `🆕 Initialized fresh state for tab ${tabId}: ${seriesTitle}`
          )
          return initialState
        }
      )
    } finally {
      releaseLock()
    }
  }

  /**
   * Get global application state
   *
   * Returns a copy of the committed in-memory state when available. On a cache
   * miss, storage.local supplies the authoritative queue while the session
   * projection contributes only transient global metadata.
   */
  async getGlobalState(): Promise<GlobalAppState> {
    if (this.globalStateCache) {
      return this.cloneGlobalState(this.globalStateCache)
    }

    const state = await this.readAuthoritativeGlobalState()
    this.globalStateCache = this.cloneGlobalState(state)
    return this.cloneGlobalState(state)
  }

  private async withGlobalStateLock<T>(
    operation: () => Promise<T>
  ): Promise<T> {
    const releaseLock = await this.acquireLock("global_state_mutation", 10000)
    try {
      return await operation()
    } finally {
      releaseLock()
    }
  }

  private async writeGlobalState(state: GlobalAppState): Promise<void> {
    const committedState = this.cloneGlobalState({
      ...state,
      lastActivity: Date.now(),
    })

    // This is the commit point. Do not mutate the cache or publish session
    // projections before the authoritative local write succeeds.
    await chrome.storage.local.set({
      [LOCAL_STORAGE_KEYS.downloadQueue]: structuredClone(
        committedState.downloadQueue
      ),
    })
    this.globalStateCache = this.cloneGlobalState(committedState)

    await this.syncGlobalStateProjection(committedState)
    await this.syncQueueProjection(committedState.downloadQueue)
    logger.debug("🌍 Global state updated")
  }

  private async writeGlobalStateAndDestinationIssues(
    state: GlobalAppState,
    destinationIssues: DestinationIssue[]
  ): Promise<void> {
    const committedState = this.cloneGlobalState({
      ...state,
      lastActivity: Date.now(),
    })

    await chrome.storage.local.set({
      [LOCAL_STORAGE_KEYS.downloadQueue]: structuredClone(
        committedState.downloadQueue
      ),
      [LOCAL_STORAGE_KEYS.destinationIssues]:
        structuredClone(destinationIssues),
    })
    this.globalStateCache = this.cloneGlobalState(committedState)

    await this.syncGlobalStateProjection(committedState)
    await this.syncQueueProjection(committedState.downloadQueue)
  }

  private async writeGlobalStateAndPendingUndoActions(
    state: GlobalAppState,
    actions: PendingUndoAction[]
  ): Promise<void> {
    const committedState = this.cloneGlobalState({
      ...state,
      lastActivity: Date.now(),
    })

    // Queue visibility and its recovery snapshot form one durable transaction.
    // Publishing session projections happens only after that commit succeeds.
    await chrome.storage.local.set({
      [LOCAL_STORAGE_KEYS.downloadQueue]: structuredClone(
        committedState.downloadQueue
      ),
      [LOCAL_STORAGE_KEYS.pendingUndoActions]: structuredClone(actions),
    })
    this.globalStateCache = this.cloneGlobalState(committedState)
    await this.syncGlobalStateProjection(committedState)
    await this.syncQueueProjection(committedState.downloadQueue)
  }

  private async writeGlobalStateAndDispatchLease(
    state: GlobalAppState,
    lease: ActiveDispatchLease | null
  ): Promise<void> {
    const committedState = this.cloneGlobalState({
      ...state,
      lastActivity: Date.now(),
    })
    await chrome.storage.local.set({
      [LOCAL_STORAGE_KEYS.downloadQueue]: structuredClone(
        committedState.downloadQueue
      ),
      [LOCAL_STORAGE_KEYS.activeDispatchLease]: lease,
    })
    this.globalStateCache = this.cloneGlobalState(committedState)
    await this.syncGlobalStateProjection(committedState)
    await this.syncQueueProjection(committedState.downloadQueue)
  }

  async beginChapterDispatch(input: {
    taskId: string
    chapterId: string
    lease: ActiveDispatchLease
    expectedPreviousLease: Pick<
      ActiveDispatchLease,
      "jobId" | "taskId" | "chapterId" | "attempt"
    > | null
  }): Promise<BeginChapterDispatchResult> {
    return await this.withGlobalStateLock(() =>
      runDispatchPersistenceExclusive(async () => {
        const globalState = await this.getGlobalState()
        const transition = beginChapterDispatchInQueue({
          queue: globalState.downloadQueue,
          taskId: input.taskId,
          chapterId: input.chapterId,
          lease: input.lease,
          now: Date.now(),
        })
        const result: BeginChapterDispatchTransitionResult = transition.result
        if (!result.success) return result

        const stored = await chrome.storage.local.get(
          LOCAL_STORAGE_KEYS.activeDispatchLease
        )
        const currentLease = normalizeActiveDispatchLease(
          stored[LOCAL_STORAGE_KEYS.activeDispatchLease]
        )
        const expected = input.expectedPreviousLease
        const previousLeaseMatches = expected
          ? currentLease?.jobId === expected.jobId &&
            currentLease.attempt === expected.attempt &&
            currentLease.taskId === expected.taskId &&
            currentLease.chapterId === expected.chapterId
          : currentLease === null
        if (
          !previousLeaseMatches ||
          input.lease.taskId !== input.taskId ||
          input.lease.chapterId !== input.chapterId
        ) {
          return { success: false, reason: "dispatch-lease-conflict" }
        }

        globalState.downloadQueue = transition.queue
        await this.writeGlobalStateAndDispatchLease(globalState, input.lease)
        return result
      })
    )
  }

  async cancelDownloadTaskAtomically(
    taskId: string,
    now: number = Date.now()
  ): Promise<CancelDownloadTaskTransitionResult> {
    return await this.withGlobalStateLock(() =>
      runDispatchPersistenceExclusive(async () => {
        const globalState = await this.getGlobalState()
        const taskIndex = globalState.downloadQueue.findIndex(
          (task) => task.id === taskId
        )
        if (taskIndex === -1) return { success: false, reason: "not-found" }
        const currentTask = globalState.downloadQueue[taskIndex]
        if (
          currentTask.status !== "queued" &&
          currentTask.status !== "downloading"
        ) {
          return {
            success: false,
            reason: "invalid-status",
            currentStatus: currentTask.status,
          }
        }

        if (currentTask.status === "queued") {
          const pendingUndoActions = await this.readPendingUndoActions()
          const action = this.createPendingUndoAction(
            "cancel_queued",
            currentTask,
            taskIndex,
            now
          )
          globalState.downloadQueue.splice(taskIndex, 1)
          await this.writeGlobalStateAndPendingUndoActions(globalState, [
            ...pendingUndoActions,
            action,
          ])
          return {
            success: true,
            task: currentTask,
            canceledLease: null,
            undo: toPendingUndoReceipt(action),
          }
        }

        const stored = await chrome.storage.local.get(
          LOCAL_STORAGE_KEYS.activeDispatchLease
        )
        const currentLease = normalizeActiveDispatchLease(
          stored[LOCAL_STORAGE_KEYS.activeDispatchLease]
        )
        const canceledLease =
          currentLease?.taskId === taskId ? currentLease : null
        const updatedTask = cancelDownloadingTask(currentTask, now)
        globalState.downloadQueue[taskIndex] = updatedTask
        await this.writeGlobalStateAndDispatchLease(
          globalState,
          canceledLease ? null : currentLease
        )
        return {
          success: true,
          task: updatedTask,
          canceledLease,
          undo: null,
        }
      })
    )
  }

  /**
   * Update global state
   */
  async updateGlobalState(updates: Partial<GlobalAppState>): Promise<void> {
    await this.withGlobalStateLock(async () => {
      const existing = await this.getGlobalState()
      const updatedState: GlobalAppState = {
        ...existing,
        ...updates,
      }

      await this.writeGlobalState(updatedState)
    })
  }

  async updateDownloadQueueAtomically<T>(
    update: (queue: readonly DownloadTaskState[]) => {
      queue: DownloadTaskState[]
      result: T
    }
  ): Promise<T> {
    return await this.withGlobalStateLock(async () => {
      const globalState = await this.getGlobalState()
      const { queue, result } = update(globalState.downloadQueue)
      await this.writeGlobalState({ ...globalState, downloadQueue: queue })
      return result
    })
  }

  /**
   * Add download task to queue
   */
  async addDownloadTask(task: DownloadTaskState): Promise<void> {
    await this.withGlobalStateLock(async () => {
      const globalState = await this.getGlobalState()
      globalState.downloadQueue.push(task)
      await this.writeGlobalState(globalState)
    })
    logger.debug(`📥 Added download task: ${task.seriesTitle}`)
  }

  /**
   * Update download task status
   */
  async updateDownloadTask(
    taskId: string,
    updates: Omit<Partial<DownloadTaskState>, "id" | "status">
  ): Promise<void> {
    let foundTask = false
    await this.withGlobalStateLock(async () => {
      const globalState = await this.getGlobalState()
      const transition = updateDownloadTaskInQueue(
        globalState.downloadQueue,
        taskId,
        updates
      )
      foundTask = transition.result.found
      if (!foundTask) return

      globalState.downloadQueue = transition.queue
      await this.writeGlobalState(globalState)
    })

    if (!foundTask) {
      logger.warn(`⚠️ Download task not found: ${taskId}`)
      return
    }

    logger.debug(`📋 Download task updated: ${taskId}`)
  }

  /**
   * Atomically move a task between lifecycle states.
   *
   * The expected-state check and write share the global-state lock so stale
   * cancellation, completion, and recovery commands cannot overwrite a task
   * that has already reached a competing terminal state.
   */
  async transitionDownloadTask(
    taskId: string,
    allowedCurrentStatuses: readonly DownloadTaskStatus[],
    updates: Omit<Partial<DownloadTaskState>, "id" | "status"> & {
      status: DownloadTaskStatus
    }
  ): Promise<DownloadTaskTransitionResult> {
    let result: DownloadTaskTransitionResult = {
      success: false,
      reason: "not-found",
    }

    await this.withGlobalStateLock(async () => {
      const globalState = await this.getGlobalState()
      const transition = transitionDownloadTaskInQueue(
        globalState.downloadQueue,
        taskId,
        allowedCurrentStatuses,
        updates
      )
      result = transition.result
      if (!result.success) return

      globalState.downloadQueue = transition.queue
      await this.writeGlobalState(globalState)
    })

    if (!result.success) {
      logger.warn(`Download task transition rejected: ${taskId}`, result)
      return result
    }

    logger.debug(`Download task transitioned: ${taskId}`, {
      status: updates.status,
    })
    return result
  }

  async transitionDownloadTaskWithDestinationIssues(
    taskId: string,
    allowedCurrentStatuses: readonly DownloadTaskStatus[],
    updates: Omit<Partial<DownloadTaskState>, "id" | "status"> & {
      status: DownloadTaskStatus
    },
    mutation: DestinationIssuesMutation
  ): Promise<DownloadTaskTransitionResult> {
    let result: DownloadTaskTransitionResult = {
      success: false,
      reason: "not-found",
    }

    await this.withGlobalStateLock(async () => {
      const globalState = await this.getGlobalState()
      const transition = transitionDownloadTaskInQueue(
        globalState.downloadQueue,
        taskId,
        allowedCurrentStatuses,
        updates
      )
      result = transition.result
      if (!result.success) return

      const stored = await chrome.storage.local.get(
        LOCAL_STORAGE_KEYS.destinationIssues
      )
      const currentIssues = normalizeDestinationIssues(
        stored[LOCAL_STORAGE_KEYS.destinationIssues]
      )
      const nextIssues =
        mutation.type === "upsert"
          ? currentIssues.some((issue) => issue.id === mutation.issue.id)
            ? currentIssues
            : [...currentIssues, mutation.issue]
          : currentIssues.filter((issue) => issue.taskId !== mutation.taskId)

      await this.writeGlobalStateAndDestinationIssues(
        { ...globalState, downloadQueue: transition.queue },
        nextIssues
      )
    })

    if (!result.success) {
      logger.warn(
        `Download task/destination transition rejected: ${taskId}`,
        result
      )
    }
    return result
  }

  /**
   * Update a specific chapter's status within a download task
   * This ensures the UI can track real-time progress during downloads
   */
  async updateDownloadTaskChapter(
    taskId: string,
    chapterId: string,
    status: ChapterStatus,
    updates?: TaskChapterUpdate
  ): Promise<void> {
    let foundTask = false
    let foundChapter = false

    await this.withGlobalStateLock(async () => {
      const globalState = await this.getGlobalState()
      const transition = updateTaskChapterInQueue({
        queue: globalState.downloadQueue,
        taskId,
        chapterId,
        status,
        updates,
        now: Date.now(),
        requireDownloadingTask: false,
      })
      if (transition.result.success) {
        foundTask = true
        foundChapter = true
      } else {
        foundTask = transition.result.reason !== "task-not-found"
        foundChapter =
          foundTask && transition.result.reason !== "chapter-not-found"
      }
      if (!transition.result.success || !transition.result.updated) return

      globalState.downloadQueue = transition.queue
      await this.writeGlobalState(globalState)
    })

    if (!foundTask) {
      logger.warn(`⚠️ Download task not found for chapter update: ${taskId}`)
      return
    }

    if (!foundChapter) {
      logger.warn(`⚠️ Chapter not found in task: ${chapterId}`)
      return
    }
  }

  /**
   * Update a chapter only while its parent task is still downloading.
   *
   * The parent-state check and child write share the global-state lock. This
   * is the cancellation/restart boundary used by offscreen progress and the
   * queue runner so a stale child completion cannot commit after a competing
   * parent transition has won.
   */
  async updateDownloadingTaskChapter(
    taskId: string,
    chapterId: string,
    status: ChapterStatus,
    updates?: TaskChapterUpdate
  ): Promise<DownloadingTaskChapterUpdateResult> {
    return await this.withGlobalStateLock(async () => {
      const globalState = await this.getGlobalState()
      const transition = updateTaskChapterInQueue({
        queue: globalState.downloadQueue,
        taskId,
        chapterId,
        status,
        updates,
        now: Date.now(),
        requireDownloadingTask: true,
      })
      if (!transition.result.success || !transition.result.updated) {
        return transition.result
      }

      globalState.downloadQueue = transition.queue
      await this.writeGlobalState(globalState)
      return transition.result
    })
  }

  /**
   * Remove download task from queue
   */
  async removeDownloadTask(taskId: string): Promise<void> {
    await this.withGlobalStateLock(async () => {
      const globalState = await this.getGlobalState()
      globalState.downloadQueue = globalState.downloadQueue.filter(
        (task) => task.id !== taskId
      )
      await this.writeGlobalState(globalState)
    })
    logger.debug(`🗑️ Removed download task: ${taskId}`)
  }

  async removeTerminalDownloadTask(
    taskId: string
  ): Promise<RemoveTerminalDownloadTaskResult> {
    return await this.withGlobalStateLock(async () => {
      const globalState = await this.getGlobalState()
      const taskIndex = globalState.downloadQueue.findIndex(
        (candidate) => candidate.id === taskId
      )
      if (taskIndex === -1) {
        return { success: false, reason: "not-found" }
      }

      const task = globalState.downloadQueue[taskIndex]
      if (task.status === "queued" || task.status === "downloading") {
        return {
          success: false,
          reason: "invalid-status",
          currentStatus: task.status,
        }
      }

      const pendingUndoActions = await this.readPendingUndoActions()
      const action = this.createPendingUndoAction(
        "remove_history",
        task,
        taskIndex,
        Date.now()
      )
      globalState.downloadQueue.splice(taskIndex, 1)
      await this.writeGlobalStateAndPendingUndoActions(globalState, [
        ...pendingUndoActions,
        action,
      ])
      return { success: true, undo: toPendingUndoReceipt(action) }
    })
  }

  async getPendingUndoActions(): Promise<PendingUndoAction[]> {
    return structuredClone(await this.readPendingUndoActions())
  }

  async restorePendingUndoAction(
    token: string,
    now: number = Date.now()
  ): Promise<RestorePendingUndoActionResult> {
    return await this.withGlobalStateLock(async () => {
      const globalState = await this.getGlobalState()
      const pendingUndoActions = await this.readPendingUndoActions()
      const actionIndex = pendingUndoActions.findIndex(
        (candidate) => candidate.token === token
      )
      if (actionIndex === -1) {
        return { success: false, reason: "not-found" }
      }

      const action = pendingUndoActions[actionIndex]
      const remainingActions = pendingUndoActions.filter(
        (_candidate, index) => index !== actionIndex
      )
      if (now >= action.expiresAt) {
        this.applyExpiredPendingUndoAction(globalState, action)
        await this.writeGlobalStateAndPendingUndoActions(
          globalState,
          remainingActions
        )
        return { success: false, reason: "expired", action }
      }

      this.insertPendingUndoTask(
        globalState.downloadQueue,
        action,
        action.taskSnapshot
      )
      await this.writeGlobalStateAndPendingUndoActions(
        globalState,
        remainingActions
      )
      return { success: true, action }
    })
  }

  async finalizePendingUndoAction(
    token: string
  ): Promise<FinalizePendingUndoActionResult> {
    return await this.withGlobalStateLock(async () => {
      const globalState = await this.getGlobalState()
      const pendingUndoActions = await this.readPendingUndoActions()
      const actionIndex = pendingUndoActions.findIndex(
        (candidate) => candidate.token === token
      )
      if (actionIndex === -1) {
        return { success: false, reason: "not-found" }
      }

      const action = pendingUndoActions[actionIndex]
      this.applyExpiredPendingUndoAction(globalState, action)
      await this.writeGlobalStateAndPendingUndoActions(
        globalState,
        pendingUndoActions.filter((_candidate, index) => index !== actionIndex)
      )
      return { success: true, action }
    })
  }

  async reconcileExpiredPendingUndoActions(
    now: number = Date.now()
  ): Promise<ReconcilePendingUndoActionsResult> {
    return await this.withGlobalStateLock(async () => {
      const globalState = await this.getGlobalState()
      const pendingUndoActions = await this.readPendingUndoActions()
      const finalized = pendingUndoActions.filter(
        (action) => now >= action.expiresAt
      )
      const pending = pendingUndoActions.filter(
        (action) => now < action.expiresAt
      )

      if (finalized.length > 0) {
        for (const action of finalized) {
          this.applyExpiredPendingUndoAction(globalState, action)
        }
        await this.writeGlobalStateAndPendingUndoActions(globalState, pending)
      }

      return {
        finalized: structuredClone(finalized),
        pending: structuredClone(pending),
      }
    })
  }

  /**
   * Clear state for tab (when tab is closed)
   */
  async clearTabState(tabId: number): Promise<void> {
    await tabContextCache.commitTabContextMutation(
      tabId,
      undefined,
      async () => {
        await chrome.storage.session.remove([
          `tab_${tabId}`,
          `seriesContextError_${tabId}`,
        ])
        return null
      }
    )
    logger.debug(`🗑️ Cleared state for tab ${tabId}`)
  }

  /**
   * Get default global state
   */
  private getDefaultGlobalState(): GlobalAppState {
    // Build directly from DEFAULT_SETTINGS; no async calls here
    return {
      downloadQueue: [],
      settings: { ...DEFAULT_SETTINGS },
      lastActivity: Date.now(),
    }
  }
}
