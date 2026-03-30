import { describe, expect, it } from 'vitest';
import { mockLocalStorage, makeDownloadTask } from './centralized-state-test-setup';

export function registerCentralizedStateGlobalQueueCases(): void {
  describe('Global State Operations', () => {
    it('retrieves global state', async () => {
      const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');

      const stateManager = new CentralizedStateManager();
      await stateManager.initialize();

      const globalState = await stateManager.getGlobalState();
      expect(globalState).toBeDefined();
      expect(globalState.downloadQueue).toEqual([]);
      expect(globalState.settings).toBeDefined();
    });

    it('updates global state', async () => {
      const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');

      const stateManager = new CentralizedStateManager();
      await stateManager.initialize();

      await stateManager.updateGlobalState({
        downloadQueue: [
          makeDownloadTask({ id: 'task-1', mangaId: 'test' }),
        ],
      });

      const globalState = await stateManager.getGlobalState();
      expect(globalState.downloadQueue).toHaveLength(1);
      expect(globalState.downloadQueue[0].id).toBe('task-1');
      expect(mockLocalStorage.downloadQueue).toEqual(globalState.downloadQueue);
    });

    it('updates lastActivity timestamp on global state changes', async () => {
      const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');

      const stateManager = new CentralizedStateManager();
      await stateManager.initialize();

      const beforeUpdate = Date.now();
      await new Promise(resolve => setTimeout(resolve, 10));

      await stateManager.updateGlobalState({ downloadQueue: [] });

      const globalState = await stateManager.getGlobalState();
      expect(globalState.lastActivity).toBeGreaterThan(beforeUpdate);
    });
  });

  describe('Download Task Management', () => {
    it('adds download task to queue', async () => {
      const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');

      const stateManager = new CentralizedStateManager();
      await stateManager.initialize();

      const task = makeDownloadTask({
        id: 'task-1',
        mangaId: 'test-series',
        seriesTitle: 'Test Manga',
        status: 'queued' as const,
      });

      await stateManager.addDownloadTask(task);

      const globalState = await stateManager.getGlobalState();
      expect(globalState.downloadQueue).toHaveLength(1);
      expect(globalState.downloadQueue[0]).toEqual(task);
      expect(mockLocalStorage.downloadQueue).toEqual(globalState.downloadQueue);
    });

    it('updates download task status', async () => {
      const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');

      const stateManager = new CentralizedStateManager();
      await stateManager.initialize();

      await stateManager.addDownloadTask(makeDownloadTask({ id: 'task-1', mangaId: 'test' }));

      await stateManager.updateDownloadTask('task-1', {
        status: 'downloading',
      });

      const globalState = await stateManager.getGlobalState();
      expect(globalState.downloadQueue[0].status).toBe('downloading');
    });

    it('removes download task from queue', async () => {
      const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');

      const stateManager = new CentralizedStateManager();
      await stateManager.initialize();

      await stateManager.addDownloadTask(makeDownloadTask({ id: 'task-1', mangaId: 'test' }));

      await stateManager.removeDownloadTask('task-1');

      const globalState = await stateManager.getGlobalState();
      expect(globalState.downloadQueue).toHaveLength(0);
    });

    it('handles updating non-existent task gracefully', async () => {
      const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');

      const stateManager = new CentralizedStateManager();
      await stateManager.initialize();

      await expect(stateManager.updateDownloadTask('non-existent', { status: 'completed' }))
        .resolves.toBeUndefined();
    });

    it('preserves concurrent chapter status mutations without dropping earlier updates', async () => {
      const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');

      const stateManager = new CentralizedStateManager();
      await stateManager.initialize();

      await stateManager.addDownloadTask(makeDownloadTask({
        id: 'task-concurrent',
        mangaId: 'test',
        chapters: [
          { id: 'ch1', url: 'ch1', title: 'Chapter 1', index: 1, status: 'queued', lastUpdated: Date.now() },
          { id: 'ch2', url: 'ch2', title: 'Chapter 2', index: 2, status: 'queued', lastUpdated: Date.now() },
        ],
        status: 'downloading',
      }));

      await Promise.all([
        stateManager.updateDownloadTaskChapter('task-concurrent', 'ch1', 'completed'),
        stateManager.updateDownloadTaskChapter('task-concurrent', 'ch2', 'completed'),
      ]);

      const globalState = await stateManager.getGlobalState();
      const task = globalState.downloadQueue.find(t => t.id === 'task-concurrent');

      expect(task?.chapters.map(chapter => chapter.status)).toEqual(['completed', 'completed']);
    });
  });

  describe('downloadId constraints for task states', () => {
    it('lastSuccessfulDownloadId is only set on completed tasks', async () => {
      const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');

      const stateManager = new CentralizedStateManager();
      await stateManager.initialize();

      await stateManager.addDownloadTask(makeDownloadTask({
        id: 'completed-task',
        mangaId: 'test',
        status: 'completed',
        completed: Date.now(),
        lastSuccessfulDownloadId: 12345,
      }));

      const globalState = await stateManager.getGlobalState();
      const task = globalState.downloadQueue.find(t => t.id === 'completed-task');

      expect(task?.status).toBe('completed');
      expect(task?.lastSuccessfulDownloadId).toBe(12345);
    });

    it('queued/downloading tasks do not have lastSuccessfulDownloadId', async () => {
      const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');

      const stateManager = new CentralizedStateManager();
      await stateManager.initialize();

      await stateManager.addDownloadTask(makeDownloadTask({
        id: 'active-task',
        mangaId: 'test',
        status: 'downloading',
      }));

      const globalState = await stateManager.getGlobalState();
      const task = globalState.downloadQueue.find(t => t.id === 'active-task');

      expect(task?.lastSuccessfulDownloadId).toBeUndefined();
    });
  });

  describe('task audit trail storage', () => {
    it('stores chapter outcomes in task state', async () => {
      const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');

      const stateManager = new CentralizedStateManager();
      await stateManager.initialize();

      await stateManager.addDownloadTask(makeDownloadTask({
        id: 'audit-task',
        mangaId: 'test',
        chapters: [
          { id: 'ch1', url: 'ch1', title: 'Chapter 1', index: 1, status: 'completed', lastUpdated: Date.now() },
          { id: 'ch2', url: 'ch2', title: 'Chapter 2', index: 2, status: 'failed', lastUpdated: Date.now(), errorMessage: 'Network error' },
          { id: 'ch3', url: 'ch3', title: 'Chapter 3', index: 3, status: 'completed', lastUpdated: Date.now() },
        ],
        status: 'partial_success',
        completed: Date.now(),
      }));

      const globalState = await stateManager.getGlobalState();
      const task = globalState.downloadQueue.find(t => t.id === 'audit-task');

      expect(task?.chapters).toHaveLength(3);
      expect(task?.chapters[0].status).toBe('completed');
      expect(task?.chapters[1].status).toBe('failed');
      expect(task?.chapters[1].errorMessage).toBe('Network error');
    });
  });

  describe('multiple tasks for the same series', () => {
    it('allows multiple tasks for the same series', async () => {
      const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');

      const stateManager = new CentralizedStateManager();
      await stateManager.initialize();

      await stateManager.addDownloadTask(makeDownloadTask({
        id: 'task-1',
        mangaId: 'same-series',
        seriesTitle: 'Same Manga',
        chapters: [{ id: 'ch1', url: 'ch1', title: 'Chapter 1', index: 1, status: 'queued', lastUpdated: Date.now() }],
      }));

      await stateManager.addDownloadTask(makeDownloadTask({
        id: 'task-2',
        mangaId: 'same-series',
        seriesTitle: 'Same Manga',
        chapters: [{ id: 'ch2', url: 'ch2', title: 'Chapter 2', index: 2, status: 'queued', lastUpdated: Date.now() }],
      }));

      const globalState = await stateManager.getGlobalState();
      expect(globalState.downloadQueue).toHaveLength(2);

      const sameSeriesTasks = globalState.downloadQueue.filter(t => t.mangaId === 'same-series');
      expect(sameSeriesTasks).toHaveLength(2);
    });
  });
}
