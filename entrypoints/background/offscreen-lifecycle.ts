/**
 * Background-side offscreen lifecycle helpers.
 *
 * Responsible for creating, querying, and tearing down the single MV3
 * offscreen document used by the archive pipeline.
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

export async function getOffscreenContexts(): Promise<unknown[]> {
  try {
    const offscreenUrl = chrome.runtime.getURL('offscreen.html');
    const runtimeWithGetContexts = chrome.runtime as unknown as { getContexts?: RuntimeGetContexts };

    if (typeof runtimeWithGetContexts.getContexts !== 'function') {
      return [];
    }

    return runtimeWithGetContexts.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [offscreenUrl],
    });
  } catch (error) {
    logger.debug('Failed to query offscreen contexts (non-fatal):', error);
    return [];
  }
}

async function hasOffscreenDocument(): Promise<boolean> {
  const contexts = await getOffscreenContexts();
  return contexts.length > 0;
}

async function readLastOffscreenActivity(): Promise<number> {
  const session = await chrome.storage.session.get(SESSION_STORAGE_KEYS.lastOffscreenActivity) as Record<string, unknown>;
  return typeof session[SESSION_STORAGE_KEYS.lastOffscreenActivity] === 'number'
    ? session[SESSION_STORAGE_KEYS.lastOffscreenActivity] as number
    : 0;
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

  const lastActivity = await readLastOffscreenActivity();
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

    const successfulChapters = activeTask.chapters.filter(
      (chapter) => chapter.status === 'completed' || chapter.status === 'partial_success',
    ).length;
    await stateManager.updateDownloadTask(activeTask.id, {
      status: successfulChapters > 0 ? 'partial_success' : 'failed',
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
 * Ensure the offscreen document exists before work is dispatched.
 */
export async function ensureOffscreenDocumentReady(): Promise<void> {
  if (await hasOffscreenDocument()) {
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
 * Query whether the offscreen document is ready and how much work it is doing.
 */
export async function queryOffscreenStatus(): Promise<{ ready: boolean; activeJobCount: number } | null> {
  try {
    if (!(await hasOffscreenDocument())) {
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
 * Close the offscreen document when it is idle and no native downloads remain.
 */
export async function scheduleOffscreenCloseIfIdle(
  pendingDownloadsStore: PendingDownloadsStore,
): Promise<void> {
  try {
    const status = await queryOffscreenStatus();
    if (!status || !status.ready) {
      return; // Not ready or not responding
    }

    if (status.activeJobCount === 0 && pendingDownloadsStore.snapshot().size === 0) {
      await closeOffscreenDocumentSafe();
      logger.info('Offscreen document closed due to inactivity');
    }
  } catch (error) {
    logger.error('Error scheduling offscreen close:', error);
  }
}

