import { describe, it, expect, vi } from 'vitest';

import { enqueueStartDownloadTask } from '@/entrypoints/background/download-queue';
import { DEFAULT_SETTINGS } from '@/src/storage/default-settings';
import type { ExtensionSettings } from '@/src/storage/settings-types';
import type { CentralizedStateManager } from '@/src/runtime/centralized-state';

function createStateManager(settings: ExtensionSettings, addDownloadTask = vi.fn(async () => {})): CentralizedStateManager {
  return {
    getGlobalState: vi.fn(async () => ({
      downloadQueue: [],
      settings,
      lastActivity: Date.now(),
    })),
    addDownloadTask,
  } as unknown as CentralizedStateManager;
}

describe('settings -> enqueue download integration', () => {
  it('captures settings snapshot from global settings for new task', async () => {
    const addDownloadTask = vi.fn(async () => {});
    const settings: ExtensionSettings = {
      ...DEFAULT_SETTINGS,
      downloads: {
        ...DEFAULT_SETTINGS.downloads,
        defaultFormat: 'none',
        overwriteExisting: true,
        pathTemplate: 'Library/<SERIES_TITLE>',
        fileNameTemplate: '<CHAPTER_NUMBER>-<CHAPTER_TITLE>',
      },
      globalPolicy: {
        image: { concurrency: 4, delayMs: 150 },
        chapter: { concurrency: 1, delayMs: 750 },
      },
    };

    const stateManager = createStateManager(settings, addDownloadTask);

    const result = await enqueueStartDownloadTask(
      stateManager,
      {
        siteIntegrationId: 'mangadex',
        mangaId: 'mangadex:series-1',
        seriesTitle: 'Hunter x Hunter',
        chapters: [
          {
            id: 'chapter-1',
            title: 'Chapter 1',
            url: 'https://mangadex.org/chapter/1',
            index: 1,
            chapterLabel: '1',
            chapterNumber: 1,
            volumeLabel: 'Vol. 1',
            volumeNumber: 1,
            language: 'en',
          },
        ],
      },
      42,
    );

    expect(result.success).toBe(true);
    expect(addDownloadTask).toHaveBeenCalledTimes(1);

    const calls = addDownloadTask.mock.calls as unknown[][];
    const firstCall = calls[0];
    expect(firstCall).toBeDefined();

    const createdTask = firstCall![0] as {
      settingsSnapshot: {
        archiveFormat: string;
        overwriteExisting: boolean;
        pathTemplate: string;
        fileNameTemplate: string;
        rateLimitSettings: {
          image: { concurrency: number; delayMs: number };
          chapter: { concurrency: number; delayMs: number };
        };
      };
      chapters: Array<{ chapterNumber?: number; volumeNumber?: number; language?: string; status: string }>;
    };

    expect(createdTask.settingsSnapshot.archiveFormat).toBe('none');
    expect(createdTask.settingsSnapshot.overwriteExisting).toBe(true);
    expect(createdTask.settingsSnapshot.pathTemplate).toBe('Library/<SERIES_TITLE>');
    expect(createdTask.settingsSnapshot.fileNameTemplate).toBe('<CHAPTER_NUMBER>-<CHAPTER_TITLE>');
    expect(createdTask.settingsSnapshot.rateLimitSettings.image).toEqual({ concurrency: 4, delayMs: 150 });
    expect(createdTask.settingsSnapshot.rateLimitSettings.chapter).toEqual({ concurrency: 1, delayMs: 750 });

    expect(createdTask.chapters[0]?.status).toBe('queued');
    expect(createdTask.chapters[0]?.chapterNumber).toBe(1);
    expect(createdTask.chapters[0]?.volumeNumber).toBe(1);
    expect(createdTask.chapters[0]?.language).toBe('en');
  });

  it('fails fast when no chapters are selected', async () => {
    const addDownloadTask = vi.fn(async () => {});
    const stateManager = createStateManager(DEFAULT_SETTINGS, addDownloadTask);

    const result = await enqueueStartDownloadTask(
      stateManager,
      {
        siteIntegrationId: 'mangadex',
        mangaId: 'mangadex:series-1',
        seriesTitle: 'Hunter x Hunter',
        chapters: [],
      },
      42,
    );

    expect(result.success).toBe(false);
    expect(result.reason).toContain('No chapters selected');
    expect(addDownloadTask).not.toHaveBeenCalled();
  });
});

