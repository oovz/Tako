import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveDownloadPlan } from '@/entrypoints/background/queue-helpers'
import { createTaskSettingsSnapshot } from '@/entrypoints/background/settings-snapshot'
import { RuntimeMessageSchema } from '@/src/runtime/message-schemas'
import { DEFAULT_SETTINGS } from '@/src/storage/default-settings'
import type { ExtensionSettings } from '@/src/storage/settings-types'
import type { CentralizedStateManager } from '@/src/runtime/centralized-state'
import type { DownloadTaskState } from '@/src/types/queue-state'

const getAllSiteOverrides = vi.fn(async () => ({}))

vi.mock('@/src/storage/site-overrides-service', () => ({
  siteOverridesService: {
    getAll: () => getAllSiteOverrides(),
  },
}))

vi.mock('@/src/runtime/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}))

function makeSettings(defaultFormat: 'cbz' | 'zip' | 'none'): ExtensionSettings {
  return {
    ...DEFAULT_SETTINGS,
    downloads: {
      ...DEFAULT_SETTINGS.downloads,
      defaultFormat,
      pathTemplate: 'Library/<SERIES_TITLE>',
      fileNameTemplate: '<CHAPTER_TITLE>',
    },
  }
}

function createTask(): DownloadTaskState {
  const now = Date.now()
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
    settingsSnapshot: {
      ...createTaskSettingsSnapshot(makeSettings('cbz'), 'mangadex'),
      archiveFormat: 'none',
    },
  }
}

function createStateManager(settings: ExtensionSettings): CentralizedStateManager {
  return {
    getGlobalState: vi.fn(async () => ({
      downloadQueue: [],
      settings,
      lastActivity: Date.now(),
    })),
  } as unknown as CentralizedStateManager
}

describe('critical runtime contracts (behavior-based)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getAllSiteOverrides.mockResolvedValue({})
  })

  it('keeps expected default download settings contract', () => {
    expect(DEFAULT_SETTINGS.downloads.defaultFormat).toBe('cbz')
    expect(DEFAULT_SETTINGS.downloads.downloadMode).toBe('browser')
    expect(DEFAULT_SETTINGS.downloads.overwriteExisting).toBe(false)
  })

  it('accepts OFFSCREEN_DOWNLOAD_API_REQUEST runtime message payload shape', () => {
    const parsed = RuntimeMessageSchema.parse({
      type: 'OFFSCREEN_DOWNLOAD_API_REQUEST',
      payload: {
        taskId: 'task-1',
        chapterId: 'chapter-1',
        fileUrl: 'blob:test-file-url',
        filename: 'Series/Chapter 1.cbz',
      },
    })

    expect(parsed.type).toBe('OFFSCREEN_DOWNLOAD_API_REQUEST')
  })

  it('resolves download format as site override first, global default fallback', async () => {
    getAllSiteOverrides.mockResolvedValue({
      mangadex: {
        outputFormat: 'none',
      },
    })

    const stateManager = createStateManager(makeSettings('cbz'))
    const plan = await resolveDownloadPlan(stateManager, createTask())

    expect(plan.format).toBe('none')
    expect(plan.chapters[0]?.resolvedPath?.endsWith('.none')).toBe(false)
  })
})

