/**
 * Offscreen Lifecycle Manager - Background Service Worker Only
 * 
 * Handles offscreen document creation, lifecycle, and communication.
 * CRITICAL: This should ONLY be used in the Service Worker.
 */

import logger from '@/src/runtime/logger';
import { CentralizedStateManager } from '@/src/runtime/centralized-state';
import type {
  OffscreenStatusResponse,
  OffscreenStatusMessage,
} from '@/src/types/offscreen-messages';
import { SESSION_STORAGE_KEYS } from '@/src/runtime/storage-keys';
import { LIVENESS_TIMEOUT_MS } from '@/src/constants/timeouts';
import type { PendingDownloadsStore } from '@/entrypoints/background/pending-downloads';

// Global state for offscreen document creation
let creatingOffscreen: Promise<void> | null = null;
export const LIVENESS_ALARM_NAME = 'offscreen-liveness';

type RuntimeGetContexts = (params: { contextTypes: Array<'OFFSCREEN_DOCUMENT'>; documentUrls: string[] }) => Promise<unknown[]>;

async function getOffscreenContexts(): Promise<unknown[]> {
  const offscreenUrl = chrome.runtime.getURL('offscreen.html');
  const runtimeWithGetContexts = chrome.runtime as unknown as { getContexts?: RuntimeGetContexts };

  if (typeof runtimeWithGetContexts.getContexts !== 'function') {
    return [];
  }

  return runtimeWithGetContexts.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl],
  });
}

async function closeOffscreenDocumentSafe(): Promise<void> {
  try {
    await chrome.offscreen.closeDocument();
  } catch (error) {
    logger.debug('Offscreen close skipped (likely already closed):', error);
  }
}

export async function ensureLivenessAlarm(): Promise<void> {
  await chrome.alarms.create(LIVENESS_ALARM_NAME, { periodInMinutes: 0.5 });
}

export async function recordOffscreenActivity(): Promise<void> {
  await chrome.storage.session.set({ [SESSION_STORAGE_KEYS.lastOffscreenActivity]: Date.now() });
}

export async function closeOffscreenIfQueueIdle(pendingDownloadsStore: PendingDownloadsStore): Promise<void> {
  if (pendingDownloadsStore.snapshot().size > 0) {
    return;
  }

  await closeOffscreenDocumentSafe();
}

export async function closeOffscreenForCancellation(pendingDownloadsStore: PendingDownloadsStore): Promise<void> {
  pendingDownloadsStore.clear();
  await closeOffscreenDocumentSafe();
}

export async function recoverFromLivenessTimeout(
  stateManager: CentralizedStateManager,
  pendingDownloadsStore: PendingDownloadsStore,
  onRecover: () => Promise<void>,
): Promise<void> {
  const globalState = await stateManager.getGlobalState();
  const activeTasks = globalState.downloadQueue.filter((task) => task.status === 'downloading');
  if (activeTasks.length === 0) {
    return;
  }

  const session = await chrome.storage.session.get(SESSION_STORAGE_KEYS.lastOffscreenActivity) as Record<string, unknown>;
  const lastActivity = typeof session[SESSION_STORAGE_KEYS.lastOffscreenActivity] === 'number'
    ? session[SESSION_STORAGE_KEYS.lastOffscreenActivity] as number
    : 0;
  if (Date.now() - lastActivity <= LIVENESS_TIMEOUT_MS) {
    return;
  }

  const recoveredAt = Date.now();

  for (const activeTask of activeTasks) {
    logger.warn(`Liveness timeout for task ${activeTask.id}`);

    for (const chapter of activeTask.chapters) {
      if (chapter.status === 'downloading' || chapter.status === 'queued') {
        // Queue state is canonicalized on chapter.id before a task ever starts, so
        // liveness recovery can mark failures without any URL-based fallback logic.
        await stateManager.updateDownloadTaskChapter(activeTask.id, chapter.id, 'failed', {
          errorMessage: 'Download process unresponsive',
        });
      }
    }

    const completedChapters = activeTask.chapters.filter((chapter) => chapter.status === 'completed').length;
    await stateManager.updateDownloadTask(activeTask.id, {
      status: completedChapters > 0 ? 'partial_success' : 'failed',
      errorMessage: 'Download process unresponsive',
      completed: recoveredAt,
    });
  }

  await chrome.storage.session.set({
    [SESSION_STORAGE_KEYS.activeTaskProgress]: null,
  });

  pendingDownloadsStore.clear();
  await closeOffscreenDocumentSafe();
  await onRecover();
}

/**
 * Ensure offscreen document exists and is ready
 */
export async function ensureOffscreenDocumentReady(): Promise<void> {
  const contexts = await getOffscreenContexts();
  const exists = Array.isArray(contexts) && contexts.length > 0;

  if (exists) {
    logger.info('Offscreen document already present');
    return;
  }

  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: [
        chrome.offscreen.Reason.BLOBS,
        chrome.offscreen.Reason.WORKERS,
      ],
      justification: 'Create archives in a Web Worker (fflate) and handle Blob-based downloads; no DOM parsing',
    });
  }

  try {
    await creatingOffscreen;
    logger.info('Offscreen document created');
  } finally {
    creatingOffscreen = null;
  }
}

/**
 * Query offscreen document status
 */
export async function queryOffscreenStatus(): Promise<{ ready: boolean; activeJobCount: number } | null> {
  try {
    const contexts = await getOffscreenContexts();
    const exists = Array.isArray(contexts) && contexts.length > 0;

    if (!exists) {
      return null;
    }

    const response = await chrome.runtime.sendMessage<OffscreenStatusMessage>({ type: 'OFFSCREEN_STATUS' }) as OffscreenStatusResponse;

    if (response && response.success) {
      return {
        ready: response.isInitialized === true || response.ready === true,
        activeJobCount: typeof response.activeJobCount === 'number' ? response.activeJobCount : 0
      };
    }
    
    return null;
  } catch (error) {
    logger.error('Error querying offscreen status:', error);
    return null;
  }
}

/**
 * Schedule offscreen document closure if idle
 */
export async function scheduleOffscreenCloseIfIdle(
  stateManager: CentralizedStateManager,
  pendingDownloadsStore: PendingDownloadsStore,
): Promise<void> {
  try {
    const status = await queryOffscreenStatus();
    if (!status || !status.ready) {
      return; // Not ready or not responding
    }

    void stateManager;

    if (status.activeJobCount === 0 && pendingDownloadsStore.snapshot().size === 0) {
      await closeOffscreenDocumentSafe();
      logger.info('Offscreen document closed due to inactivity');
    }
  } catch (error) {
    logger.error('Error scheduling offscreen close:', error);
  }
}

