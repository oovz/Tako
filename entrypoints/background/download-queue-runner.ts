import logger from '@/src/runtime/logger';
import { CentralizedStateManager } from '@/src/runtime/centralized-state';
import type { OffscreenDownloadChapterMessage, OffscreenDownloadChapterResponse } from '@/src/types/offscreen-messages';
import { SESSION_STORAGE_KEYS } from '@/src/runtime/storage-keys';
import {
  resolveDownloadPlan,
  validateDownloadPathForTask,
} from './queue-helpers';
import {
  finalizeDownloadTaskAfterDispatch,
  notifyDownloadTaskCompletion,
  type ChapterDispatchOutcome,
} from './download-queue-finalization';
import { destinationService } from './destination';
import { getBackgroundSiteAdapterById } from '@/src/runtime/background-site-integration-initialization';
import { composeSeriesKey } from '@/src/runtime/queue-task-summary';
import type { ExtensionSettings } from '@/src/storage/settings-types';
import { recordOffscreenActivity } from './offscreen-lifecycle';

// Current queue scheduling is intentionally single-task and single-chapter dispatch.
// Re-enable chapter concurrency only after the scheduler, offscreen request
// handling, progress state, cancellation, and archive memory behavior are made
// reentrant.
const MAX_CONCURRENT_QUEUED_TASKS = 1;

async function clearActiveTaskProgress(): Promise<void> {
  await chrome.storage.session.set({ [SESSION_STORAGE_KEYS.activeTaskProgress]: null });
}

let queuedContinuationStateManager: CentralizedStateManager | null = null;
let queuedContinuationEnsureOffscreenReady: (() => Promise<void>) | null = null;
let queuedContinuationScheduled = false;

const queueContinuationPort = (() => {
  const channel = new MessageChannel();
  channel.port1.onmessage = () => {
    queuedContinuationScheduled = false;

    const stateManager = queuedContinuationStateManager;
    const ensureOffscreenReady = queuedContinuationEnsureOffscreenReady;
    queuedContinuationStateManager = null;
    queuedContinuationEnsureOffscreenReady = null;

    if (!stateManager || !ensureOffscreenReady) {
      return;
    }

    void processDownloadQueue(stateManager, ensureOffscreenReady).catch((error) => {
      logger.error('[Queue] Deferred continuation failed', error);
    });
  };

  return channel.port2;
})();

function scheduleQueueContinuation(
  stateManager: CentralizedStateManager,
  ensureOffscreenReady: () => Promise<void>,
): void {
  queuedContinuationStateManager = stateManager;
  queuedContinuationEnsureOffscreenReady = ensureOffscreenReady;

  if (queuedContinuationScheduled) {
    return;
  }

  queuedContinuationScheduled = true;
  queueContinuationPort.postMessage(undefined);
}

export async function startDownloadTask(
  stateManager: CentralizedStateManager,
  taskId: string,
  ensureOffscreenReady: () => Promise<void>,
): Promise<void> {
  try {
    logger.info('[Queue]', {
      event: 'STARTED',
      taskId,
    });

    const globalState = await stateManager.getGlobalState();
    const task = globalState.downloadQueue.find(t => t.id === taskId);

    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    await stateManager.updateDownloadTask(taskId, {
      status: 'downloading',
      started: Date.now(),
    });
    await recordOffscreenActivity();

    await ensureOffscreenReady();

    const destination = await destinationService.getEffectiveDestination();
    const effectiveSettings: ExtensionSettings = {
      ...globalState.settings,
      downloads: {
        ...globalState.settings.downloads,
        downloadMode: destination.kind === 'custom' ? 'custom' : 'browser',
        customDirectoryEnabled: destination.kind === 'custom',
        customDirectoryHandleId: destination.kind === 'custom' ? destination.handleId : null,
      },
    };

    validateDownloadPathForTask(taskId, {
      downloads: {
        pathTemplate: task.settingsSnapshot.pathTemplate,
      },
    });

    const saveMode: OffscreenDownloadChapterMessage['payload']['saveMode'] =
      effectiveSettings.downloads.downloadMode === 'custom' ? 'fsa' : 'downloads-api';
    const settingsSnapshot = task.settingsSnapshot;
    const chapterDelayMs = Math.max(0, settingsSnapshot.rateLimitSettings.chapter.delayMs);
    const totalChapters = task.chapters.length;
    const chapterOutcomesByIndex: Array<ChapterDispatchOutcome | undefined> = Array.from(
      { length: totalChapters },
      () => undefined,
    );
    let shouldStopDispatch = false;

    const dispatchChapter = async (chapterIndex: number): Promise<void> => {
      const fallbackTaskChapter = task.chapters[chapterIndex];
      try {
        const dispatchPlan = await resolveDownloadPlan(task);
        const chapter = dispatchPlan.chapters[chapterIndex];
        if (!chapter) {
          chapterOutcomesByIndex[chapterIndex] = {
            chapterId: fallbackTaskChapter?.id || `missing-chapter-${chapterIndex + 1}`,
            status: 'failed',
            errorMessage: 'Chapter missing from resolved dispatch plan',
          };
          return;
        }

        const latestTask = (await stateManager.getGlobalState()).downloadQueue.find((queuedTask) => queuedTask.id === taskId);
        if (!latestTask || latestTask.status !== 'downloading') {
          shouldStopDispatch = true;
          logger.info('[Queue]', {
            event: 'CHAPTER_DISPATCH_ABORTED',
            taskId,
            reason: 'TASK_NOT_DOWNLOADING',
          });
          return;
        }

        await stateManager.updateDownloadTaskChapter(taskId, chapter.id, 'downloading');
        await recordOffscreenActivity();

        const seriesKey = composeSeriesKey(dispatchPlan.book.siteId, dispatchPlan.book.seriesId);
        let integrationContext: Record<string, unknown> | undefined;
        try {
          const integration = await getBackgroundSiteAdapterById(dispatchPlan.book.siteId);
          const backgroundSiteAdapter = integration?.background;
          if (backgroundSiteAdapter?.prepareDispatchContext) {
            integrationContext = await backgroundSiteAdapter.prepareDispatchContext({
              taskId,
              seriesKey,
              chapter,
              settingsSnapshot,
            });
          }
        } catch (error) {
          logger.debug('[Queue]', {
            event: 'PREPARE_DISPATCH_CONTEXT_FAILED',
            taskId,
            chapterId: chapter.id,
            error,
          });
        }

        const response: OffscreenDownloadChapterResponse = await chrome.runtime.sendMessage({
          type: 'OFFSCREEN_DOWNLOAD_CHAPTER',
          payload: {
            taskId,
            seriesKey,
            book: {
              siteIntegrationId: dispatchPlan.book.siteId,
              seriesTitle: dispatchPlan.book.seriesTitle,
              coverUrl: latestTask.seriesCoverUrl ?? dispatchPlan.book.coverUrl,
              metadata: latestTask.settingsSnapshot.comicInfo,
            },
            chapter: {
              id: chapter.id,
              title: chapter.title,
              url: chapter.url,
              index: fallbackTaskChapter?.index ?? chapterIndex + 1,
              chapterLabel: chapter.chapterLabel,
              chapterNumber: chapter.chapterNumber,
              volumeId: chapter.volumeId,
              volumeNumber: chapter.volumeNumber,
              volumeLabel: chapter.volumeLabel,
              language:
                latestTask.chapters.find((taskChapter) => taskChapter.id === chapter.id)
                  ?.language ?? chapter.comicInfo?.LanguageISO,
              resolvedPath: chapter.resolvedPath || chapter.title,
            },
            settingsSnapshot,
            saveMode,
            integrationContext,
          },
        });

        const chapterStatus = response.success ? response.status : 'failed';
        const chapterErrorMessage = response.success
          ? response.errorMessage
          : response.error;
        const chapterErrorCategory = response.success ? response.errorCategory : undefined;
        const imagesFailed = response.success ? response.imagesFailed : undefined;

        const taskAfterDispatch = (await stateManager.getGlobalState()).downloadQueue.find((queuedTask) => queuedTask.id === taskId);
        if (!taskAfterDispatch || taskAfterDispatch.status !== 'downloading') {
          shouldStopDispatch = true;
          return;
        }

        chapterOutcomesByIndex[chapterIndex] = {
          chapterId: chapter.id,
          status: chapterStatus,
          errorMessage: chapterErrorMessage,
          errorCategory: chapterErrorCategory,
          imagesFailed,
        };

        await stateManager.updateDownloadTaskChapter(taskId, chapter.id, chapterStatus, {
          errorMessage: chapterErrorMessage,
          imagesFailed,
        });

        const completedOrPartialCount = chapterOutcomesByIndex.filter(
          (outcome): outcome is NonNullable<typeof outcome> =>
            !!outcome && (outcome.status === 'completed' || outcome.status === 'partial_success'),
        ).length;
        await stateManager.updateDownloadTask(taskId, {
          errorMessage: chapterStatus === 'failed' ? chapterErrorMessage : undefined,
          errorCategory: chapterStatus === 'failed' ? chapterErrorCategory : undefined,
        });

        logger.info('[Queue]', {
          event: 'CHAPTER_DISPATCHED',
          taskId,
          chapterId: chapter.id,
          chapterIndex: chapterIndex + 1,
          totalChapters,
          chapterStatus,
          successfulChapters: completedOrPartialCount,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        chapterOutcomesByIndex[chapterIndex] = {
          chapterId: fallbackTaskChapter?.id || `failed-chapter-${chapterIndex + 1}`,
          status: 'failed',
          errorMessage,
        };

        // Liveness recovery may have already marked the chapter/task terminal
        // with a more accurate "Download process unresponsive" error when the
        // offscreen was closed mid-flight. Don't overwrite that with the
        // sendMessage rejection error ("message channel closed"), which is a
        // downstream symptom of the offscreen being closed, not the root cause.
        const currentTask = (await stateManager.getGlobalState()).downloadQueue.find((t) => t.id === taskId);
        const currentChapter = currentTask?.chapters.find((c) => c.id === fallbackTaskChapter?.id);
        const chapterAlreadyTerminal = currentChapter &&
          (currentChapter.status === 'completed' || currentChapter.status === 'failed' || currentChapter.status === 'partial_success');
        const taskAlreadyTerminal = currentTask &&
          (currentTask.status === 'completed' || currentTask.status === 'failed' || currentTask.status === 'partial_success' || currentTask.status === 'canceled');

        if (fallbackTaskChapter?.id && !chapterAlreadyTerminal) {
          await stateManager.updateDownloadTaskChapter(taskId, fallbackTaskChapter.id, 'failed', {
            errorMessage,
          });
        }

        if (!taskAlreadyTerminal) {
          await stateManager.updateDownloadTask(taskId, {
            errorMessage,
          });
        }

        if (taskAlreadyTerminal) {
          shouldStopDispatch = true;
        }

        logger.error('[Queue]', {
          event: 'CHAPTER_DISPATCH_FAILED',
          taskId,
          chapterIndex: chapterIndex + 1,
          error,
        });
      }
    };

    // Deliberately await each chapter before starting the next one. Parallel
    // chapter dispatch is future scheduler work, not a dormant setting.
    for (let i = 0; i < totalChapters; i++) {
      if (shouldStopDispatch) {
        break;
      }

      await dispatchChapter(i);

      if (i < totalChapters - 1 && chapterDelayMs > 0) {
        // setTimeout is used here instead of chrome.alarms because alarms has a
        // 30s minimum interval, making it unusable for sub-30s inter-chapter
        // delays. If the service worker terminates during this delay, the
        // zombie-sweep + auto-resume path on next SW startup will recover the
        // queue (see background-startup.ts / initialize-from-storage.ts).
        await new Promise((resolve) => setTimeout(resolve, chapterDelayMs));
      }
    }

    if (shouldStopDispatch) {
      await clearActiveTaskProgress();
      scheduleQueueContinuation(stateManager, ensureOffscreenReady);
      return;
    }

    const latestTaskAfterDispatch = (await stateManager.getGlobalState()).downloadQueue.find((queuedTask) => queuedTask.id === taskId);
    if (!latestTaskAfterDispatch || latestTaskAfterDispatch.status !== 'downloading') {
      await clearActiveTaskProgress();
      scheduleQueueContinuation(stateManager, ensureOffscreenReady);
      return;
    }

    const {
      chapterOutcomes,
      completedCount,
      finalStatus,
    } = await finalizeDownloadTaskAfterDispatch({
      stateManager,
      taskId,
      task,
      chapterOutcomesByIndex,
      settingsSnapshot,
      defaultFormat: effectiveSettings.downloads.defaultFormat,
    });

    await clearActiveTaskProgress();

    await notifyDownloadTaskCompletion({
      stateManager,
      taskId,
      finalStatus,
      completedCount,
      totalChapters: chapterOutcomes.length,
    });

    scheduleQueueContinuation(stateManager, ensureOffscreenReady);

    logger.info('[Queue]', {
      event: 'OFFSCREEN_DISPATCHED',
      taskId,
      jobId: `dispatch_loop_${taskId}`,
      mode: effectiveSettings.downloads.downloadMode,
      chapters: task.chapters.length,
    });

  } catch (error) {
    logger.error('[Queue]', {
      event: 'FAILED',
      taskId,
      reason: 'INTERNAL_ERROR',
      error,
    });
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    await stateManager.updateDownloadTask(taskId, {
      status: 'failed',
      errorMessage,
      completed: Date.now(),
    });
    await clearActiveTaskProgress();
    scheduleQueueContinuation(stateManager, ensureOffscreenReady);
  }
}

export async function processDownloadQueue(
  stateManager: CentralizedStateManager,
  ensureOffscreenReady: () => Promise<void>,
): Promise<void> {
  try {
    const globalState = await stateManager.getGlobalState();
    const queuedTasks = globalState.downloadQueue.filter(task => task.status === 'queued');
    const activeTasks = globalState.downloadQueue.filter(task => task.status === 'downloading');
    const concurrentLimit = MAX_CONCURRENT_QUEUED_TASKS;
    const availableSlots = Math.max(0, concurrentLimit - activeTasks.length);

    if (queuedTasks.length === 0 || availableSlots === 0) {
      return;
    }

    logger.info('[Queue]', {
      event: 'PROCESSING',
      queued: queuedTasks.length,
      active: activeTasks.length,
      availableSlots,
    });

    let startedTasks = 0;
    for (const task of queuedTasks) {
      if (startedTasks >= availableSlots) {
        break;
      }

      const latestGlobalState = await stateManager.getGlobalState();
      const latestTask = latestGlobalState.downloadQueue.find(currentTask => currentTask.id === task.id);
      if (!latestTask || latestTask.status !== 'queued') {
        continue;
      }

      const latestActiveTasks = latestGlobalState.downloadQueue.filter(currentTask => currentTask.status === 'downloading');
      if (latestActiveTasks.length >= concurrentLimit) {
        break;
      }

      let startedTask = false;

      const currentTask = (await stateManager.getGlobalState()).downloadQueue.find(currentQueuedTask => currentQueuedTask.id === latestTask.id);
      if (currentTask && currentTask.status === 'queued') {
        await startDownloadTask(stateManager, latestTask.id, ensureOffscreenReady);
        startedTask = true;
      }

      if (startedTask) {
        startedTasks += 1;
      }
    }

  } catch (error) {
    logger.error('[Queue]', {
      event: 'FAILED',
      reason: 'INTERNAL_ERROR',
      error,
    });
  }
}
