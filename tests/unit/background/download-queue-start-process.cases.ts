import { createTaskSettingsSnapshot } from '@/entrypoints/background/settings-snapshot';
import type { DownloadTaskState } from '@/src/types/queue-state';
import { describe, expect, it, vi } from 'vitest';
import {
  createChapter,
  makeTask,
  mockEnsureOffscreenReady,
  mockGlobalState,
  mockRuntimeSendMessage,
  mockStateManager,
  processDownloadQueue,
  startDownloadTask,
  testSettings,
} from './download-queue-test-setup';

export function registerDownloadQueueStartAndProcessCases(): void {
  describe('startDownloadTask', () => {
    it('should start a valid download task', async () => {
      const task = makeTask({ id: 'task-1' });

      mockGlobalState.downloadQueue = [task];

      await startDownloadTask(
        mockStateManager,
        'task-1',
        mockEnsureOffscreenReady,
      );

      expect(mockStateManager.updateDownloadTask).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({
          status: 'downloading',
          started: expect.any(Number),
        }),
      );
      expect(mockEnsureOffscreenReady).toHaveBeenCalled();
      expect(mockStateManager.updateDownloadTaskChapter).toHaveBeenCalled();
      expect(mockStateManager.updateChapterState).not.toHaveBeenCalled();
    });

    it('updates tab chapter state to failed when chapter dispatch fails', async () => {
      mockRuntimeSendMessage.mockResolvedValueOnce({ success: true, status: 'failed', errorMessage: 'Dispatch failed' });

      const task = makeTask({ id: 'task-failed-chapter' });

      mockGlobalState.downloadQueue = [task];

      await startDownloadTask(
        mockStateManager,
        'task-failed-chapter',
        mockEnsureOffscreenReady,
      );

      expect(mockStateManager.updateChapterState).not.toHaveBeenCalled();
    });

    it('should allow multiple tasks from same tab', async () => {
      const existingTask = makeTask({
        id: 'task-1',
        status: 'completed',
        created: Date.now() - 5000,
        completed: Date.now() - 1000,
      });

      const newTask = makeTask({
        id: 'task-2',
        chapters: [createChapter({ url: 'https://example.com/ch2', title: 'Chapter 2', chapterNumber: 2 })],
        created: Date.now(),
      });

      mockGlobalState.downloadQueue = [existingTask, newTask];

      await startDownloadTask(
        mockStateManager,
        'task-2',
        mockEnsureOffscreenReady,
      );

      expect(mockStateManager.updateDownloadTask).toHaveBeenCalledWith(
        'task-2',
        expect.objectContaining({
          status: 'downloading',
        }),
      );
      expect(mockEnsureOffscreenReady).toHaveBeenCalled();
      expect(mockStateManager.updateDownloadTaskChapter).toHaveBeenCalled();
    });

    it('should start queued task regardless of tab origin', async () => {
      const task = makeTask({ id: 'task-1' });

      mockGlobalState.downloadQueue = [task];

      await startDownloadTask(
        mockStateManager,
        'task-1',
        mockEnsureOffscreenReady,
      );

      expect(mockStateManager.updateDownloadTask).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({
          status: 'downloading',
        }),
      );

      expect(mockEnsureOffscreenReady).toHaveBeenCalled();
      expect(mockStateManager.updateDownloadTaskChapter).toHaveBeenCalled();
    });

    it('should handle task not found error', async () => {
      mockGlobalState.downloadQueue = [];

      await startDownloadTask(
        mockStateManager,
        'non-existent',
        mockEnsureOffscreenReady,
      );

      expect(mockEnsureOffscreenReady).not.toHaveBeenCalled();
      expect(mockRuntimeSendMessage).not.toHaveBeenCalled();
    });

    it('should handle path validation failure', async () => {
      const { validateDownloadPathForTask } = await import('@/entrypoints/background/queue-helpers');
      vi.mocked(validateDownloadPathForTask).mockImplementationOnce(() => {
        throw new Error('Invalid download path');
      });

      const task = makeTask({ id: 'task-1' });

      mockGlobalState.downloadQueue = [task];

      await startDownloadTask(
        mockStateManager,
        'task-1',
        mockEnsureOffscreenReady,
      );

      expect(mockStateManager.updateDownloadTask).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({
          status: 'failed',
          errorMessage: 'Invalid download path',
        }),
      );
    });

    it('should handle plan resolution failure', async () => {
      const { resolveDownloadPlan } = await import('@/entrypoints/background/queue-helpers');
      vi.mocked(resolveDownloadPlan).mockRejectedValueOnce(
        new Error('Chapter title missing'),
      );

      const task = makeTask({
        id: 'task-1',
        chapters: [createChapter({ url: 'https://example.com/ch1', title: '', chapterNumber: 1 })],
      });

      mockGlobalState.downloadQueue = [task];

      await startDownloadTask(
        mockStateManager,
        'task-1',
        mockEnsureOffscreenReady,
      );

      expect(mockStateManager.updateDownloadTask).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({
          errorMessage: 'Chapter title missing',
        }),
      );
      expect(mockStateManager.updateDownloadTask).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({
          status: 'failed',
        }),
      );
    });

    it('re-resolves chapter paths on each dispatch iteration', async () => {
      const { resolveDownloadPlan } = await import('@/entrypoints/background/queue-helpers');

      vi.mocked(resolveDownloadPlan)
        .mockResolvedValueOnce({
          format: 'cbz',
          overwriteExisting: false,
          book: {
            siteId: 'test-site',
            seriesId: 'series-1',
            seriesTitle: 'Test Manga',
            comicInfoBase: { Series: 'Test Manga' },
          },
          chapters: [
            {
              id: 'ch1',
              url: 'https://example.com/ch1',
              title: 'Chapter 1',
              chapterNumber: 1,
              resolvedPath: '2026-02-26/Chapter 1.cbz',
              comicInfo: { Series: 'Test Manga' },
            },
            {
              id: 'ch2',
              url: 'https://example.com/ch2',
              title: 'Chapter 2',
              chapterNumber: 2,
              resolvedPath: '2026-02-26/Chapter 2.cbz',
              comicInfo: { Series: 'Test Manga' },
            },
          ],
        })
        .mockResolvedValueOnce({
          format: 'cbz',
          overwriteExisting: false,
          book: {
            siteId: 'test-site',
            seriesId: 'series-1',
            seriesTitle: 'Test Manga',
            comicInfoBase: { Series: 'Test Manga' },
          },
          chapters: [
            {
              id: 'ch1',
              url: 'https://example.com/ch1',
              title: 'Chapter 1',
              chapterNumber: 1,
              resolvedPath: '2026-02-27/Chapter 1.cbz',
              comicInfo: { Series: 'Test Manga' },
            },
            {
              id: 'ch2',
              url: 'https://example.com/ch2',
              title: 'Chapter 2',
              chapterNumber: 2,
              resolvedPath: '2026-02-27/Chapter 2.cbz',
              comicInfo: { Series: 'Test Manga' },
            },
          ],
        });

      const task = makeTask({
        id: 'task-date-macros',
        chapters: [
          createChapter({ id: 'ch1', url: 'https://example.com/ch1', title: 'Chapter 1', chapterNumber: 1 }),
          createChapter({ id: 'ch2', url: 'https://example.com/ch2', title: 'Chapter 2', chapterNumber: 2 }),
        ],
        settingsSnapshot: {
          ...createTaskSettingsSnapshot(testSettings, 'test-site'),
          archiveFormat: 'cbz',
        },
      });

      mockGlobalState.downloadQueue = [task];

      await startDownloadTask(
        mockStateManager,
        'task-date-macros',
        mockEnsureOffscreenReady,
      );

      const chapterDispatchCalls = mockRuntimeSendMessage.mock.calls.filter(
        (call) => call?.[0]?.type === 'OFFSCREEN_DOWNLOAD_CHAPTER',
      );

      expect(chapterDispatchCalls).toHaveLength(2);
      expect(chapterDispatchCalls[0]?.[0]?.payload?.chapter?.resolvedPath).toBe('2026-02-26/Chapter 1.cbz');
      expect(chapterDispatchCalls[1]?.[0]?.payload?.chapter?.resolvedPath).toBe('2026-02-27/Chapter 2.cbz');
      expect(vi.mocked(resolveDownloadPlan)).toHaveBeenCalledTimes(2);
    });

    it('uses TaskChapter.index (series position) not dispatch loop index in OFFSCREEN_DOWNLOAD_CHAPTER', async () => {
      const { resolveDownloadPlan } = await import('@/entrypoints/background/queue-helpers');
      const mockPlan = {
        format: 'cbz' as const,
        overwriteExisting: false,
        book: {
          siteId: 'test-site',
          seriesId: 'series-1',
          seriesTitle: 'Test Manga',
          comicInfoBase: { Series: 'Test Manga' },
        },
        chapters: [
          { id: 'ch5', url: 'https://example.com/ch5', title: 'Chapter 5', chapterNumber: 5, resolvedPath: 'Chapter 5.cbz', comicInfo: { Series: 'Test Manga' } },
          { id: 'ch10', url: 'https://example.com/ch10', title: 'Chapter 10', chapterNumber: 10, resolvedPath: 'Chapter 10.cbz', comicInfo: { Series: 'Test Manga' } },
        ],
      };
      vi.mocked(resolveDownloadPlan)
        .mockResolvedValueOnce(mockPlan)
        .mockResolvedValueOnce(mockPlan);

      const task = makeTask({
        id: 'task-index-test',
        chapters: [
          createChapter({ id: 'ch5', url: 'https://example.com/ch5', title: 'Chapter 5', chapterNumber: 5, index: 5 }),
          createChapter({ id: 'ch10', url: 'https://example.com/ch10', title: 'Chapter 10', chapterNumber: 10, index: 10 }),
        ],
      });

      mockGlobalState.downloadQueue = [task];

      await startDownloadTask(mockStateManager, 'task-index-test', mockEnsureOffscreenReady);

      const chapterDispatchCalls = mockRuntimeSendMessage.mock.calls.filter(
        (call) => call?.[0]?.type === 'OFFSCREEN_DOWNLOAD_CHAPTER',
      );

      expect(chapterDispatchCalls).toHaveLength(2);
      expect(chapterDispatchCalls[0]?.[0]?.payload?.chapter?.index).toBe(5);
      expect(chapterDispatchCalls[1]?.[0]?.payload?.chapter?.index).toBe(10);
    });

    it('propagates chapter language to OFFSCREEN_DOWNLOAD_CHAPTER payload', async () => {
      const task = makeTask({
        id: 'task-language',
        chapters: [
          createChapter({
            id: 'ch1',
            url: 'https://example.com/ch1',
            title: 'Chapter 1',
            chapterNumber: 1,
            language: 'ja',
          }),
        ],
      });

      mockGlobalState.downloadQueue = [task];

      await startDownloadTask(
        mockStateManager,
        'task-language',
        mockEnsureOffscreenReady,
      );

      const chapterDispatchCalls = mockRuntimeSendMessage.mock.calls.filter(
        (call) => call?.[0]?.type === 'OFFSCREEN_DOWNLOAD_CHAPTER',
      );

      expect(chapterDispatchCalls).toHaveLength(1);
      expect(chapterDispatchCalls[0]?.[0]?.payload?.chapter?.language).toBe('ja');
      expect(chapterDispatchCalls[0]?.[0]?.payload?.seriesKey).toBe('test-site#series-1');
    });

    it('dispatches chapters sequentially according to frozen task settings', async () => {
      const dispatchOrder: string[] = [];
      let inFlightDispatches = 0;
      let maxInFlightDispatches = 0;

      const { resolveDownloadPlan } = await import('@/entrypoints/background/queue-helpers');
      vi.mocked(resolveDownloadPlan).mockResolvedValue({
        format: 'cbz',
        overwriteExisting: false,
        book: {
          siteId: 'test-site',
          seriesId: 'series-1',
          seriesTitle: 'Sequential Series',
          comicInfoBase: { Series: 'Sequential Series' },
        },
        chapters: [
          { id: 'ch1', url: 'https://example.com/ch1', title: 'Chapter 1', chapterNumber: 1, resolvedPath: 'Chapter 1.cbz', comicInfo: { Series: 'Sequential Series' } },
          { id: 'ch2', url: 'https://example.com/ch2', title: 'Chapter 2', chapterNumber: 2, resolvedPath: 'Chapter 2.cbz', comicInfo: { Series: 'Sequential Series' } },
          { id: 'ch3', url: 'https://example.com/ch3', title: 'Chapter 3', chapterNumber: 3, resolvedPath: 'Chapter 3.cbz', comicInfo: { Series: 'Sequential Series' } },
        ],
      });

      mockRuntimeSendMessage.mockImplementation(async (message: { type?: string; payload?: { chapter?: { id?: string } } }) => {
        if (message?.type !== 'OFFSCREEN_DOWNLOAD_CHAPTER') {
          return { success: true, status: 'completed' };
        }

        const chapterId = message.payload?.chapter?.id ?? 'unknown';
        dispatchOrder.push(`start:${chapterId}`);
        inFlightDispatches += 1;
        maxInFlightDispatches = Math.max(maxInFlightDispatches, inFlightDispatches);

        await new Promise((resolve) => setTimeout(resolve, 5));

        inFlightDispatches -= 1;
        dispatchOrder.push(`end:${chapterId}`);
        return { success: true, status: 'completed' };
      });

      const task = makeTask({
        id: 'task-sequential-dispatch',
        seriesTitle: 'Sequential Series',
        chapters: [
          createChapter({ id: 'ch1', url: 'https://example.com/ch1', title: 'Chapter 1', chapterNumber: 1 }),
          createChapter({ id: 'ch2', url: 'https://example.com/ch2', title: 'Chapter 2', chapterNumber: 2 }),
          createChapter({ id: 'ch3', url: 'https://example.com/ch3', title: 'Chapter 3', chapterNumber: 3 }),
        ],
        settingsSnapshot: {
          ...createTaskSettingsSnapshot(testSettings, 'test-site'),
          archiveFormat: 'cbz',
        },
      });

      mockGlobalState.downloadQueue = [task];

      await startDownloadTask(
        mockStateManager,
        'task-sequential-dispatch',
        mockEnsureOffscreenReady,
      );

      expect(maxInFlightDispatches).toBe(1);
      expect(dispatchOrder.filter((entry) => entry.startsWith('start:'))).toHaveLength(3);
      expect(dispatchOrder.filter((entry) => entry.startsWith('end:'))).toHaveLength(3);
    });
  });

  describe('processDownloadQueue', () => {
    it('should start at most one queued task when none are active', async () => {
      mockGlobalState.settings.downloads.maxConcurrentDownloads = 1;
      const tasks: DownloadTaskState[] = [
        makeTask({ id: 'task-1', mangaId: 'series-1', seriesTitle: 'Test Manga 1' }),
        makeTask({ id: 'task-2', mangaId: 'series-2', seriesTitle: 'Test Manga 2' }),
      ];

      mockGlobalState.downloadQueue = tasks;

      await processDownloadQueue(
        mockStateManager,
        mockEnsureOffscreenReady,
      );

      expect(mockStateManager.updateDownloadTask).toHaveBeenCalled();
      expect(mockStateManager.updateDownloadTask).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({ status: 'downloading' }),
      );
      expect(mockStateManager.updateDownloadTaskChapter).toHaveBeenCalled();
    });

    it('should not start new tasks when an active task exists', async () => {
      mockGlobalState.settings.downloads.maxConcurrentDownloads = 1;
      const tasks: DownloadTaskState[] = [
        makeTask({ id: 'task-1', mangaId: 'series-1', seriesTitle: 'Test Manga 1', status: 'downloading' }),
        makeTask({ id: 'task-3', mangaId: 'series-3', seriesTitle: 'Test Manga 3' }),
        makeTask({ id: 'task-4', mangaId: 'series-4', seriesTitle: 'Test Manga 4' }),
      ];

      mockGlobalState.downloadQueue = tasks;

      await processDownloadQueue(
        mockStateManager,
        mockEnsureOffscreenReady,
      );

      expect(mockStateManager.updateDownloadTask).not.toHaveBeenCalled();
      expect(mockRuntimeSendMessage).not.toHaveBeenCalled();
    });

    it('starts only one queued task even when stale maxConcurrentDownloads exceeds 1', async () => {
      mockGlobalState.settings.downloads.maxConcurrentDownloads = 2;

      const tasks: DownloadTaskState[] = [
        makeTask({ id: 'task-1', siteIntegrationId: 'test-site-a', mangaId: 'series-1', seriesTitle: 'Test Manga 1', created: Date.now() }),
        makeTask({ id: 'task-2', siteIntegrationId: 'test-site-b', mangaId: 'series-2', seriesTitle: 'Test Manga 2', chapters: [createChapter({ url: 'https://example.com/ch2', title: 'Chapter 2', chapterNumber: 2 })], created: Date.now() + 1 }),
        makeTask({ id: 'task-3', siteIntegrationId: 'test-site-c', mangaId: 'series-3', seriesTitle: 'Test Manga 3', chapters: [createChapter({ url: 'https://example.com/ch3', title: 'Chapter 3', chapterNumber: 3 })], created: Date.now() + 2 }),
      ];

      mockGlobalState.downloadQueue = tasks;

      const rateLimit = await import('@/src/runtime/rate-limit');
      vi.mocked(rateLimit.resolveEffectivePolicy).mockImplementation(async (integrationId: string) => ({
        concurrency: integrationId === 'test-site-a' || integrationId === 'test-site-b' || integrationId === 'test-site-c' ? 1 : 1,
        delayMs: 0,
      }));

      await processDownloadQueue(
        mockStateManager,
        mockEnsureOffscreenReady,
      );

      expect(mockStateManager.updateDownloadTask).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({ status: 'downloading' }),
      );
      expect(mockStateManager.updateDownloadTask).not.toHaveBeenCalledWith(
        'task-2',
        expect.objectContaining({ status: 'downloading' }),
      );
      expect(mockStateManager.updateDownloadTask).not.toHaveBeenCalledWith(
        'task-3',
        expect.objectContaining({ status: 'downloading' }),
      );
    });

    it('should skip processing when no queued tasks', async () => {
      mockGlobalState.downloadQueue = [
        makeTask({ id: 'task-1', status: 'completed', completed: Date.now() }),
      ];

      await processDownloadQueue(
        mockStateManager,
        mockEnsureOffscreenReady,
      );

      expect(mockStateManager.updateDownloadTask).not.toHaveBeenCalled();
      expect(mockRuntimeSendMessage).not.toHaveBeenCalled();
    });

    it('should start queued task even when site integration policy has delay', async () => {
      vi.useFakeTimers();
      const now = 1_000_000;
      vi.setSystemTime(now);

      const tasks: DownloadTaskState[] = [
        makeTask({
          id: 'task-rate-limited',
          seriesTitle: 'Rate Limited',
          chapters: [createChapter({ url: 'https://example.com/wait-1', title: 'Chapter 1', chapterNumber: 1 })],
          created: now - 1000,
        }),
      ];

      mockGlobalState.downloadQueue = tasks;

      const rateLimit = await import('@/src/runtime/rate-limit');
      const mockedResolvePolicy = vi.mocked(rateLimit.resolveEffectivePolicy);
      const mockedSchedule = vi.mocked(rateLimit.scheduleForIntegrationScope);

      mockedResolvePolicy.mockResolvedValueOnce({ concurrency: 1, delayMs: 5000 });

      await processDownloadQueue(
        mockStateManager,
        mockEnsureOffscreenReady,
      );

      expect(mockedResolvePolicy).toHaveBeenCalledWith('test-site', 'chapter');
      expect(mockedSchedule).toHaveBeenCalledWith('test-site', 'chapter', expect.any(Function));

      expect(mockStateManager.updateDownloadTask).toHaveBeenCalledWith(
        'task-rate-limited',
        expect.objectContaining({ status: 'downloading' }),
      );

      vi.useRealTimers();
    });
  });
}
