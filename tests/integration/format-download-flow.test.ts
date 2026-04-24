import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveDownloadPlan } from '@/entrypoints/background/queue-helpers';
import { createTaskSettingsSnapshot } from '@/entrypoints/background/settings-snapshot';
import { DEFAULT_SETTINGS } from '@/src/storage/default-settings';
import type { ExtensionSettings } from '@/src/storage/settings-types';
import type { DownloadTaskState } from '@/src/types/queue-state';

const getAllSiteOverrides = vi.fn(async () => ({}));

vi.mock('@/src/storage/site-overrides-service', () => ({
  siteOverridesService: {
    getAll: () => getAllSiteOverrides(),
  },
}));

vi.mock('@/src/runtime/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

function makeSettings(defaultFormat: 'cbz' | 'zip' | 'none'): ExtensionSettings {
  return {
    ...DEFAULT_SETTINGS,
    downloads: {
      ...DEFAULT_SETTINGS.downloads,
      defaultFormat,
      pathTemplate: 'Library/<SERIES_TITLE>',
      fileNameTemplate: '<CHAPTER_TITLE>',
    },
  };
}

function createTask(snapshotSettings: ExtensionSettings = makeSettings('zip')): DownloadTaskState {
  const now = Date.now();
  return {
    id: 'task-1',
    siteIntegrationId: 'mangadex',
    mangaId: 'mangadex:series-1',
    seriesTitle: 'Hunter x Hunter',
    chapters: [
      {
        id: 'ch-1',
        url: 'https://mangadex.org/chapter/ch-1',
        title: 'Chapter 1',
        index: 1,
        chapterNumber: 1,
        volumeNumber: 1,
        status: 'queued',
        lastUpdated: now,
      },
    ],
    status: 'queued',
    created: now,
    settingsSnapshot: createTaskSettingsSnapshot(snapshotSettings, 'mangadex'),
  };
}

describe('format resolution integration (resolveDownloadPlan)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAllSiteOverrides.mockResolvedValue({});
  });

  it('uses global default format when no site override exists', async () => {
    const plan = await resolveDownloadPlan(createTask());

    expect(plan.format).toBe('zip');
    expect(plan.chapters[0]?.resolvedPath).toContain('.zip');
  });

  it('uses the frozen task snapshot format instead of live site overrides', async () => {
    getAllSiteOverrides.mockResolvedValue({
      mangadex: {
        outputFormat: 'none',
      },
    });

    const plan = await resolveDownloadPlan(createTask(makeSettings('none')));

    expect(plan.format).toBe('none');
    expect(plan.chapters[0]?.resolvedPath?.endsWith('.none')).toBe(false);
  });

  it('resolves from the frozen task settings without consulting tab-scoped format state', async () => {
    const plan = await resolveDownloadPlan(createTask(makeSettings('cbz')));

    expect(plan.format).toBe('cbz');
    expect(plan.chapters[0]?.resolvedPath).toContain('.cbz');
  });
});

