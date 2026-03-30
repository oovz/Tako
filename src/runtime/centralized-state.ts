/**
 * Centralized State Management for Chrome Extension
 * 
 * This module implements the single source of truth pattern using chrome.storage.session.
 * The Service Worker is the ONLY component authorized to modify state.
 * All UIs listen to storage changes and render accordingly.
 */

import logger from '@/src/runtime/logger';
import { DEFAULT_SETTINGS } from '@/src/storage/default-settings';
import { initializeChapterStates } from './state-helpers';
import { LOCAL_STORAGE_KEYS, SESSION_STORAGE_KEYS } from '@/src/runtime/storage-keys';
import { projectToQueueView, updateActionBadge } from '@/entrypoints/background/projection';
import type { StorageValue } from '@/src/shared/type-guards';
import { normalizePersistedDownloadTask } from './persisted-download-task';
import { isGlobalAppState, isMangaPageState, resolveVolumeStates } from './state-shapes';
import type { ChapterStatus } from '@/src/types/chapter';
import type { DownloadTaskState, GlobalAppState } from '@/src/types/queue-state';
import type { ChapterState, MangaPageState } from '@/src/types/tab-state';

// Re-export helpers for convenience
export { sendStateAction, cancelDownloadTask } from './state-actions';
export { toQueueTaskSummary } from './queue-task-summary';

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
  private initialized = false;
  private locks = new Map<string, Promise<void>>();

  private async syncQueueProjection(downloadQueue: DownloadTaskState[]): Promise<void> {
    try {
      const projection = projectToQueueView(downloadQueue);
      await chrome.storage.session.set({ [SESSION_STORAGE_KEYS.queueView]: projection.queueView });
      await updateActionBadge(projection.nonTerminalCount);
    } catch (error) {
      logger.debug('Failed to sync queue projection (non-fatal):', error);
    }
  }

  private async syncActiveTabContext(tabId: number, context: MangaPageState | null): Promise<void> {
    try {
      const tabsQuery = chrome.tabs?.query;
      if (typeof tabsQuery !== 'function') {
        return;
      }

      const [activeTab] = await tabsQuery({ active: true, currentWindow: true });
      if (activeTab?.id !== tabId) {
        return;
      }

      await chrome.storage.session.set({ [SESSION_STORAGE_KEYS.activeTabContext]: context });
    } catch (error) {
      logger.debug('Failed to sync active tab context (non-fatal):', error);
    }
  }

  constructor() {
    if (typeof chrome === 'undefined' || typeof chrome.storage === 'undefined') {
      throw new Error('StateManager can only be used in Service Worker context');
    }
  }

  /**
   * Acquire a lock for a given key
   * @internal Race condition protection for critical operations
   */
  private async acquireLock(lockKey: string, timeoutMs: number = 5000): Promise<() => void> {
    const previousLock = this.locks.get(lockKey);

    let releaseLock!: () => void;
    const lockPromise = new Promise<void>(resolve => {
      releaseLock = resolve;
    });

    const lockChain = (previousLock ?? Promise.resolve()).then(() => lockPromise);
    this.locks.set(lockKey, lockChain);

    if (previousLock) {
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

      try {
        await Promise.race([
          previousLock,
          new Promise<never>((_, reject) => {
            timeoutHandle = setTimeout(() => {
              reject(new Error(`Lock timeout: ${lockKey}`));
            }, timeoutMs);
          }),
        ]);
      } catch (error) {
        if (timeoutHandle !== undefined) {
          clearTimeout(timeoutHandle);
        }

        if (this.locks.get(lockKey) === lockChain) {
          this.locks.delete(lockKey);
        }

        releaseLock();
        throw error;
      }

      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
    }

    // Return release function
    return () => {
      if (this.locks.get(lockKey) === lockChain) {
        this.locks.delete(lockKey);
      }
      releaseLock();
    };
  }

  /**
   * Initialize state manager
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      await chrome.storage.session.setAccessLevel({
        accessLevel: 'TRUSTED_CONTEXTS'
      });

      // Initialize global state if not exists
      const globalState = await chrome.storage.session.get(SESSION_STORAGE_KEYS.globalState) as Record<string, StorageValue>;
      const existingGlobal = globalState[SESSION_STORAGE_KEYS.globalState];
      if (!isGlobalAppState(existingGlobal)) {
        await this.initializeGlobalState();
      }

      this.initialized = true;
      logger.info('✅ CentralizedStateManager initialized');
    } catch (error) {
      logger.error('❌ StateManager initialization failed:', error);
      throw error;
    }
  }

  /**
   * Initialize global application state
   */
  private async initializeGlobalState(): Promise<void> {
    const persistedQueueResult = await chrome.storage.local.get(LOCAL_STORAGE_KEYS.downloadQueue) as Record<string, StorageValue>;
    const persistedQueue = persistedQueueResult[LOCAL_STORAGE_KEYS.downloadQueue];
    const initialQueue = Array.isArray(persistedQueue)
      ? persistedQueue.map(normalizePersistedDownloadTask).filter((task): task is DownloadTaskState => task !== null)
      : [];
    // Initialize with full default ExtensionSettings; background will sync persisted settings shortly
    const initialState: GlobalAppState = {
      downloadQueue: initialQueue,
      settings: { ...DEFAULT_SETTINGS },
      lastActivity: Date.now()
    };

    await Promise.all([
      chrome.storage.session.set({ [SESSION_STORAGE_KEYS.globalState]: initialState }),
      chrome.storage.local.set({ [LOCAL_STORAGE_KEYS.downloadQueue]: initialQueue }),
    ]);
    await this.syncQueueProjection(initialState.downloadQueue);
    logger.info('🌍 Global state initialized');
  }

  /**
   * Get state for specific tab
   */
  async getTabState(tabId: number): Promise<MangaPageState | null> {
    const result = await chrome.storage.session.get(`tab_${tabId}`) as Record<string, StorageValue>;
    const maybeState = result[`tab_${tabId}`];
    return isMangaPageState(maybeState) ? maybeState : null;
  }

  /**
   * Update state for specific tab
   */
  async updateTabState(tabId: number, state: Partial<MangaPageState>): Promise<void> {
    const existing = await this.getTabState(tabId);
    // Allow partial updates even if no existing state
    const base: Partial<MangaPageState> = existing ?? {};
    const updatedState: MangaPageState = {
      ...(base as MangaPageState),
      ...(state as MangaPageState),
      volumes: Array.isArray(state.volumes)
        ? state.volumes
        : Array.isArray(base.volumes)
          ? base.volumes
          : [],
      lastUpdated: Date.now()
    };

    await chrome.storage.session.set({ [`tab_${tabId}`]: updatedState });
    await this.syncActiveTabContext(tabId, updatedState);
    logger.info(`📊 Tab ${tabId} state updated`);
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
    chapters: Omit<ChapterState, 'status' | 'lastUpdated'>[],
    metadata?: MangaPageState['metadata'],
    volumes?: MangaPageState['volumes'],
  ): Promise<void> {
    const lockKey = `tab_${tabId}_init`;
    const releaseLock = await this.acquireLock(lockKey);

    try {
      // Check if state already exists for this tab (inside lock to prevent race)
      const existingState = await this.getTabState(tabId);

      if (existingState && existingState.siteIntegrationId === siteId && existingState.mangaId === seriesId) {
        // State exists for same manga - preserve runtime chapter status while updating chapter list
        logger.info(`🔄 Updating existing state for tab ${tabId}: ${seriesTitle}`);

        // Preserve runtime chapter state strictly by canonical chapter ID.
        const existingChapterStates = new Map<string, ChapterState>();
        existingState.chapters.forEach(chapter => {
          existingChapterStates.set(chapter.id, chapter);
        });

        // Update state with new chapter list while preserving runtime chapter state
        const updatedState: MangaPageState = {
          ...existingState,
          seriesTitle, // Update title in case it changed
          chapters: chapters.map(chapter => {
            const existingChapter = existingChapterStates.get(chapter.id);
            return {
              ...chapter,
              // Preserve status and other runtime state if chapter exists, otherwise default to queued
              status: existingChapter?.status ?? 'queued',
              errorMessage: existingChapter?.errorMessage,
              totalImages: existingChapter?.totalImages,
              imagesFailed: existingChapter?.imagesFailed,
              lastUpdated: existingChapter?.lastUpdated || Date.now()
            };
          }),
          volumes: resolveVolumeStates(chapters, volumes),
          metadata: metadata ?? existingState.metadata,
          lastUpdated: Date.now()
        };

        await chrome.storage.session.set({ [`tab_${tabId}`]: updatedState });
        await this.syncActiveTabContext(tabId, updatedState);
        logger.info(`✅ Updated ${updatedState.chapters.length} chapters for tab ${tabId}`);
      } else {
        // No existing state or different manga - create fresh state
        logger.info(`🆕 Creating fresh state for tab ${tabId}: ${seriesTitle}`);

        const initialState: MangaPageState = {
          siteIntegrationId: siteId,
          mangaId: seriesId,
          seriesTitle,
          chapters: initializeChapterStates(chapters),
          volumes: resolveVolumeStates(chapters, volumes),
          metadata,
          lastUpdated: Date.now()
        };

        await chrome.storage.session.set({ [`tab_${tabId}`]: initialState });
        await this.syncActiveTabContext(tabId, initialState);
        logger.info(`🆕 Initialized fresh state for tab ${tabId}: ${seriesTitle}`);
      }
    } finally {
      releaseLock();
    }
  }

  /**
   * Find chapter index by canonical chapter ID.
   *
   * Chapter URLs remain useful for navigation and integration-specific fetches,
   * but state mutation paths must always resolve chapters by their stable ID.
   *
   * @param chapters - Array of chapters to search
   * @param chapterId - Chapter ID to match
   * @returns Index of matching chapter, or -1 if not found
   */
  private findChapterIndex<T extends { id: string }>(chapters: T[], chapterId: string): number {
    return chapters.findIndex(ch => ch.id === chapterId);
  }

  /**
   * Update chapter state
   */
  async updateChapterState(
    tabId: number,
    chapterId: string,
    newStatus: ChapterState['status'],
    updates: Partial<ChapterState> = {}
  ): Promise<void> {
    const tabState = await this.getTabState(tabId);
    if (!tabState) {
      logger.warn(`⚠️ No state found for tab ${tabId}`);
      return;
    }

    const chapterIndex = this.findChapterIndex(tabState.chapters, chapterId);
    if (chapterIndex === -1) {
      logger.warn(`⚠️ Chapter not found: ${chapterId}`);
      return;
    }

    const prev = tabState.chapters[chapterIndex];
    // Prevent downgrading completed unless explicitly requested
    const nextStatus: ChapterState['status'] = (prev.status === 'completed' && newStatus !== 'completed') ? 'completed' : newStatus;
    tabState.chapters[chapterIndex] = {
      ...prev,
      ...updates,
      status: nextStatus,
      lastUpdated: Date.now()
    };

    tabState.lastUpdated = Date.now();
    await chrome.storage.session.set({ [`tab_${tabId}`]: tabState });
    await this.syncActiveTabContext(tabId, tabState);
    logger.debug(`📖 Chapter state updated: ${chapterId} → ${newStatus}`);
  }

  /**
   * Get global application state
   */
  async getGlobalState(): Promise<GlobalAppState> {
    const result = await chrome.storage.session.get(SESSION_STORAGE_KEYS.globalState) as Record<string, StorageValue>;
    const maybeState = result[SESSION_STORAGE_KEYS.globalState];
    return isGlobalAppState(maybeState) ? maybeState : this.getDefaultGlobalState();
  }

  private async withGlobalStateLock<T>(operation: () => Promise<T>): Promise<T> {
    const releaseLock = await this.acquireLock('global_state_mutation', 10000);
    try {
      return await operation();
    } finally {
      releaseLock();
    }
  }

  private async writeGlobalState(state: GlobalAppState): Promise<void> {
    state.lastActivity = Date.now();
    await Promise.all([
      chrome.storage.session.set({ [SESSION_STORAGE_KEYS.globalState]: state }),
      chrome.storage.local.set({ [LOCAL_STORAGE_KEYS.downloadQueue]: state.downloadQueue }),
    ]);
    await this.syncQueueProjection(state.downloadQueue);
    logger.debug('🌍 Global state updated');
  }

  /**
   * Update global state
   */
  async updateGlobalState(updates: Partial<GlobalAppState>): Promise<void> {
    await this.withGlobalStateLock(async () => {
      const existing = await this.getGlobalState();
      const updatedState: GlobalAppState = {
        ...existing,
        ...updates,
      };

      await this.writeGlobalState(updatedState);
    });
  }

  /**
   * Add download task to queue
   */
  async addDownloadTask(task: DownloadTaskState): Promise<void> {
    await this.withGlobalStateLock(async () => {
      const globalState = await this.getGlobalState();
      globalState.downloadQueue.push(task);
      await this.writeGlobalState(globalState);
    });
    logger.debug(`📥 Added download task: ${task.seriesTitle}`);
  }

  /**
   * Update download task status
   */
  async updateDownloadTask(taskId: string, updates: Partial<DownloadTaskState>): Promise<void> {
    let foundTask = false;
    await this.withGlobalStateLock(async () => {
      const globalState = await this.getGlobalState();
      const taskIndex = globalState.downloadQueue.findIndex(task => task.id === taskId);

      if (taskIndex === -1) {
        return;
      }

      foundTask = true;
      globalState.downloadQueue[taskIndex] = {
        ...globalState.downloadQueue[taskIndex],
        ...updates
      };

      await this.writeGlobalState(globalState);
    });

    if (!foundTask) {
      logger.warn(`⚠️ Download task not found: ${taskId}`);
      return;
    }

    logger.debug(`📋 Download task updated: ${taskId}`);
  }

  /**
   * Update a specific chapter's status within a download task
   * This ensures the UI can track real-time progress during downloads
   */
  async updateDownloadTaskChapter(
    taskId: string,
    chapterId: string,
    status: ChapterStatus,
    updates?: { errorMessage?: string; totalImages?: number; imagesFailed?: number }
  ): Promise<void> {
    let foundTask = false;
    let foundChapter = false;

    await this.withGlobalStateLock(async () => {
      const globalState = await this.getGlobalState();
      const taskIndex = globalState.downloadQueue.findIndex(task => task.id === taskId);

      if (taskIndex === -1) {
        return;
      }

      foundTask = true;
      const task = globalState.downloadQueue[taskIndex];
      const chapterIndex = this.findChapterIndex(task.chapters, chapterId);

      if (chapterIndex === -1) {
        return;
      }

      foundChapter = true;
      task.chapters[chapterIndex] = {
        ...task.chapters[chapterIndex],
        status,
        errorMessage: updates?.errorMessage,
        totalImages: updates?.totalImages ?? task.chapters[chapterIndex].totalImages,
        imagesFailed: updates?.imagesFailed ?? task.chapters[chapterIndex].imagesFailed,
        lastUpdated: Date.now()
      };

      await this.writeGlobalState(globalState);
    });

    if (!foundTask) {
      logger.warn(`⚠️ Download task not found for chapter update: ${taskId}`);
      return;
    }

    if (!foundChapter) {
      logger.warn(`⚠️ Chapter not found in task: ${chapterId}`);
      return;
    }
  }

  /**
   * Remove download task from queue
   */
  async removeDownloadTask(taskId: string): Promise<void> {
    await this.withGlobalStateLock(async () => {
      const globalState = await this.getGlobalState();
      globalState.downloadQueue = globalState.downloadQueue.filter(task => task.id !== taskId);
      await this.writeGlobalState(globalState);
    });
    logger.debug(`🗑️ Removed download task: ${taskId}`);
  }

  /**
   * Clear state for tab (when tab is closed)
   */
  async clearTabState(tabId: number): Promise<void> {
    await chrome.storage.session.remove(`tab_${tabId}`);
    await this.syncActiveTabContext(tabId, null);
    logger.debug(`🗑️ Cleared state for tab ${tabId}`);
  }

  /**
   * Get default global state
   */
  private getDefaultGlobalState(): GlobalAppState {
    // Build directly from DEFAULT_SETTINGS; no async calls here
    return {
      downloadQueue: [],
      settings: { ...DEFAULT_SETTINGS },
      lastActivity: Date.now()
    };
  }
 }

