import type { DownloadTaskState } from '@/src/types/queue-state';
import { describe, expect, it, vi } from 'vitest';
import {
  createChapter,
  makeTask,
  mockEnsureOffscreenReady,
  mockGlobalState,
  mockRuntimeSendMessage,
  mockStateManager,
  moveTaskToTop,
  processDownloadQueue,
} from './download-queue-test-setup';

export function registerDownloadQueueBehaviorCases(): void {
  describe('unlimited queue behavior', () => {
    it('accepts unlimited tasks without capacity enforcement', async () => {
      mockGlobalState.settings.downloads.maxConcurrentDownloads = 1;
      const tasks: DownloadTaskState[] = Array.from({ length: 50 }, (_, i) => makeTask({
        id: `task-${i}`,
        mangaId: `series-${i}`,
        seriesTitle: `Test Manga ${i}`,
        chapters: [createChapter({ url: `https://example.com/ch${i}`, title: `Chapter ${i}`, chapterNumber: i })],
        status: 'queued' as const,
        created: Date.now() + i,
      }));

      mockGlobalState.downloadQueue = tasks;

      await processDownloadQueue(
        mockStateManager,
        mockEnsureOffscreenReady,
      );

      expect(mockStateManager.updateDownloadTask).toHaveBeenCalledWith(
        'task-0',
        expect.objectContaining({ status: 'downloading' }),
      );
    });

    it('does not block new tasks based on queue size', async () => {
      mockGlobalState.settings.downloads.maxConcurrentDownloads = 1;
      const tasks: DownloadTaskState[] = Array.from({ length: 100 }, (_, i) => makeTask({
        id: `task-${i}`,
        mangaId: `series-${i}`,
        seriesTitle: `Test Manga ${i}`,
        chapters: [createChapter({ url: `https://example.com/ch${i}`, title: `Chapter ${i}`, chapterNumber: i })],
        status: 'queued' as const,
        created: Date.now() + i,
      }));

      mockGlobalState.downloadQueue = tasks;

      await processDownloadQueue(
        mockStateManager,
        mockEnsureOffscreenReady,
      );

      expect(mockStateManager.updateDownloadTask).toHaveBeenCalledWith(
        'task-0',
        expect.objectContaining({ status: 'downloading' }),
      );

      const failedCalls = vi.mocked(mockStateManager.updateDownloadTask).mock.calls
        .filter(call => (call[1] as Partial<DownloadTaskState>).status === 'failed');
      expect(failedCalls).toHaveLength(0);
    });
  });

  describe('FIFO queue processing', () => {
    it('processes tasks in creation order (FIFO)', async () => {
      mockGlobalState.settings.downloads.maxConcurrentDownloads = 1;
      const now = Date.now();
      const tasks: DownloadTaskState[] = [
        makeTask({ id: 'task-old', mangaId: 'series-1', seriesTitle: 'Old Task', created: now - 10000 }),
        makeTask({ id: 'task-new', mangaId: 'series-2', seriesTitle: 'New Task', chapters: [createChapter({ url: 'https://example.com/ch2', title: 'Chapter 2', chapterNumber: 2 })], created: now }),
      ];

      mockGlobalState.downloadQueue = tasks;

      await processDownloadQueue(
        mockStateManager,
        mockEnsureOffscreenReady,
      );

      expect(mockStateManager.updateDownloadTask).toHaveBeenCalledWith(
        'task-old',
        expect.objectContaining({ status: 'downloading' }),
      );
      expect(mockStateManager.updateDownloadTask).not.toHaveBeenCalledWith(
        'task-new',
        expect.objectContaining({ status: 'downloading' }),
      );
    });

    it('maintains queue order when first task completes', async () => {
      mockGlobalState.settings.downloads.maxConcurrentDownloads = 1;
      const now = Date.now();
      const tasks: DownloadTaskState[] = [
        makeTask({ id: 'task-1', mangaId: 'series-1', seriesTitle: 'First Task', status: 'completed', created: now - 20000, completed: now - 1000 }),
        makeTask({ id: 'task-2', mangaId: 'series-2', seriesTitle: 'Second Task', chapters: [createChapter({ url: 'https://example.com/ch2', title: 'Chapter 2', chapterNumber: 2 })], created: now - 15000 }),
        makeTask({ id: 'task-3', mangaId: 'series-3', seriesTitle: 'Third Task', chapters: [createChapter({ url: 'https://example.com/ch3', title: 'Chapter 3', chapterNumber: 3 })], created: now - 10000 }),
      ];

      mockGlobalState.downloadQueue = tasks;

      await processDownloadQueue(
        mockStateManager,
        mockEnsureOffscreenReady,
      );

      expect(mockStateManager.updateDownloadTask).toHaveBeenCalledWith(
        'task-2',
        expect.objectContaining({ status: 'downloading' }),
      );
    });
  });

  describe('single active task behavior', () => {
    it('allows only one downloading task at a time globally', async () => {
      const tasks: DownloadTaskState[] = [
        makeTask({ id: 'active-task', mangaId: 'series-1', seriesTitle: 'Active Download', status: 'downloading', created: Date.now() - 5000 }),
        makeTask({ id: 'waiting-task', mangaId: 'series-2', seriesTitle: 'Waiting Download', chapters: [createChapter({ url: 'https://example.com/ch2', title: 'Chapter 2', chapterNumber: 2 })], created: Date.now() }),
      ];

      mockGlobalState.downloadQueue = tasks;

      await processDownloadQueue(
        mockStateManager,
        mockEnsureOffscreenReady,
      );

      expect(mockStateManager.updateDownloadTask).not.toHaveBeenCalled();
      expect(mockRuntimeSendMessage).not.toHaveBeenCalled();
    });

    it('starts next task after current task completes', async () => {
      const completedTask = makeTask({ id: 'completed-task', mangaId: 'series-1', seriesTitle: 'Completed Download', status: 'completed', created: Date.now() - 10000, completed: Date.now() - 1000 });

      const nextTask = makeTask({ id: 'next-task', mangaId: 'series-2', seriesTitle: 'Next Download', chapters: [createChapter({ url: 'https://example.com/ch2', title: 'Chapter 2', chapterNumber: 2 })], created: Date.now() - 5000 });

      mockGlobalState.downloadQueue = [completedTask, nextTask];

      await processDownloadQueue(
        mockStateManager,
        mockEnsureOffscreenReady,
      );

      expect(mockStateManager.updateDownloadTask).toHaveBeenCalledWith(
        'next-task',
        expect.objectContaining({ status: 'downloading' }),
      );
    });

    it('allows multiple tasks from same series in queue', async () => {
      const tasks: DownloadTaskState[] = [
        makeTask({ id: 'task-1', mangaId: 'same-series', seriesTitle: 'Same Manga Part 1', created: Date.now() - 5000 }),
        makeTask({ id: 'task-2', mangaId: 'same-series', seriesTitle: 'Same Manga Part 2', chapters: [createChapter({ url: 'https://example.com/ch2', title: 'Chapter 2', chapterNumber: 2 })], created: Date.now() }),
      ];

      mockGlobalState.downloadQueue = tasks;

      await processDownloadQueue(
        mockStateManager,
        mockEnsureOffscreenReady,
      );

      expect(mockStateManager.updateDownloadTask).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({ status: 'downloading' }),
      );
    });

    it('allows multiple queued tasks from same tab in queue', async () => {
      const tasks: DownloadTaskState[] = [
        makeTask({ id: 'task-1', mangaId: 'series-1', created: Date.now() - 5000 }),
        makeTask({ id: 'task-2', mangaId: 'series-1', created: Date.now() }),
        makeTask({ id: 'task-3', mangaId: 'series-1', chapters: [createChapter({ url: 'https://example.com/ch2', title: 'Chapter 2', chapterNumber: 2 })], created: Date.now() + 1000 }),
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
      expect(mockGlobalState.downloadQueue).toHaveLength(3);
    });
  });

  describe('moveTaskToTop', () => {
    it('moves a queued task to the front of the queued segment after all active tasks', async () => {
      mockGlobalState.downloadQueue = [
        makeTask({ id: 'active-1', mangaId: 'series-1', seriesTitle: 'Active 1', chapters: [createChapter({ url: 'https://example.com/a1', title: 'A1', chapterNumber: 1 })], status: 'downloading', created: 1 }),
        makeTask({ id: 'active-2', mangaId: 'series-2', seriesTitle: 'Active 2', chapters: [createChapter({ url: 'https://example.com/a2', title: 'A2', chapterNumber: 2 })], status: 'downloading', created: 2 }),
        makeTask({ id: 'queued-1', mangaId: 'series-3', seriesTitle: 'Queued 1', chapters: [createChapter({ url: 'https://example.com/q1', title: 'Q1', chapterNumber: 3 })], created: 3 }),
        makeTask({ id: 'queued-2', mangaId: 'series-4', seriesTitle: 'Queued 2', chapters: [createChapter({ url: 'https://example.com/q2', title: 'Q2', chapterNumber: 4 })], created: 4 }),
      ];

      const result = await moveTaskToTop(mockStateManager, 'queued-2');

      expect(result).toEqual({ success: true });
      expect(mockGlobalState.downloadQueue.map((task) => task.id)).toEqual([
        'active-1',
        'active-2',
        'queued-2',
        'queued-1',
      ]);
    });

    it('rejects moving non-queued tasks', async () => {
      mockGlobalState.downloadQueue = [
        makeTask({ id: 'active-1', mangaId: 'series-1', seriesTitle: 'Active 1', chapters: [createChapter({ url: 'https://example.com/a1', title: 'A1', chapterNumber: 1 })], status: 'downloading', created: 1 }),
      ];

      const result = await moveTaskToTop(mockStateManager, 'active-1');

      expect(result).toEqual({ success: false, reason: 'Only queued tasks can be moved to top' });
    });
  });

  describe('queue status vocabulary excludes waiting/cooldown', () => {
    it('does not use waiting/cooldown fields even when site integration policy has delay', async () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      const task = makeTask({ id: 'rate-limited-task', seriesTitle: 'Rate Limited', created: now - 1000 });

      mockGlobalState.downloadQueue = [task];

      const rateLimit = await import('@/src/runtime/rate-limit');
      vi.mocked(rateLimit.resolveEffectivePolicy).mockResolvedValueOnce({
        concurrency: 1,
        delayMs: 10000,
      });

      await processDownloadQueue(
        mockStateManager,
        mockEnsureOffscreenReady,
      );

      expect(mockStateManager.updateDownloadTask).toHaveBeenCalledWith(
        'rate-limited-task',
        expect.objectContaining({ status: 'downloading' }),
      );

      const calls = (mockStateManager.updateDownloadTask as unknown as { mock: { calls: unknown[][] } }).mock.calls;
      const hasWaitingUpdate = calls.some((c) => (c[1] as { status?: string } | undefined)?.status === 'waiting');
      const hasCooldownField = calls.some((c) => {
        const update = c[1] as Record<string, unknown> | undefined;
        return !!update && Object.prototype.hasOwnProperty.call(update, 'cooldownUntil');
      });
      expect(hasWaitingUpdate).toBe(false);
      expect(hasCooldownField).toBe(false);

      vi.useRealTimers();
    });

    it('processes queued tasks without requiring cooldown bookkeeping', async () => {
      const queuedTask = makeTask({ id: 'queued-task', seriesTitle: 'Queued Task', created: Date.now() - 10000 });

      mockGlobalState.downloadQueue = [queuedTask];

      await processDownloadQueue(
        mockStateManager,
        mockEnsureOffscreenReady,
      );

      expect(mockStateManager.updateDownloadTask).toHaveBeenCalledWith(
        'queued-task',
        expect.objectContaining({ status: 'downloading' }),
      );
    });
  });
}
