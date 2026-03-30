import { describe, expect, it } from 'vitest';
import {
  completeDownloadTask,
  createChapter,
  failDownloadTask,
  makeTask,
  mockGlobalState,
  mockStateManager,
} from './download-queue-test-setup';

export function registerDownloadQueueFinalizationCases(): void {
  describe('completeDownloadTask', () => {
    it('should mark task and chapters as completed', async () => {
      const task = makeTask({
        id: 'task-1',
        chapters: [
          createChapter({ url: 'https://example.com/ch1', title: 'Chapter 1', chapterNumber: 1 }),
          createChapter({ url: 'https://example.com/ch2', title: 'Chapter 2', chapterNumber: 2 }),
        ],
        status: 'downloading',
      });

      mockGlobalState.downloadQueue = [task];

      await completeDownloadTask(mockStateManager, 'task-1');

      expect(mockStateManager.updateDownloadTask).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({
          status: 'completed',
          completed: expect.any(Number),
        }),
      );
      expect(mockStateManager.updateChapterState).not.toHaveBeenCalled();
    });

    it('should handle task not found gracefully', async () => {
      mockGlobalState.downloadQueue = [];

      await completeDownloadTask(mockStateManager, 'non-existent');

      expect(mockStateManager.updateDownloadTask).toHaveBeenCalledWith(
        'non-existent',
        expect.objectContaining({ status: 'completed' }),
      );
    });
  });

  describe('failDownloadTask', () => {
    it('should mark task and chapters as failed with error message', async () => {
      const task = makeTask({
        id: 'task-1',
        chapters: [
          createChapter({ url: 'https://example.com/ch1', title: 'Chapter 1', chapterNumber: 1 }),
          createChapter({ url: 'https://example.com/ch2', title: 'Chapter 2', chapterNumber: 2 }),
        ],
        status: 'downloading',
      });

      mockGlobalState.downloadQueue = [task];

      const errorMessage = 'Network connection lost';
      await failDownloadTask(mockStateManager, 'task-1', errorMessage);

      expect(mockStateManager.updateDownloadTask).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({
          status: 'failed',
          errorMessage,
          completed: expect.any(Number),
        }),
      );
      expect(mockStateManager.updateChapterState).not.toHaveBeenCalled();
    });

    it('should handle task not found gracefully', async () => {
      mockGlobalState.downloadQueue = [];

      await failDownloadTask(mockStateManager, 'non-existent', 'Some error');

      expect(mockStateManager.updateDownloadTask).toHaveBeenCalledWith(
        'non-existent',
        expect.objectContaining({ status: 'failed' }),
      );
    });
  });
}
