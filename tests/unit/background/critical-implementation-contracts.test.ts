import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveDownloadPlan } from '@/entrypoints/background/queue-helpers'
import { createTaskSettingsSnapshot } from '@/src/runtime/settings-snapshot'
import { RuntimeMessageSchema } from '@/src/runtime/message-schemas'
import { DEFAULT_SETTINGS } from '@/src/storage/default-settings'
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

function makeSettings(defaultFormat: 'cbz' | 'zip' | 'none') {
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

describe('critical runtime contracts (behavior-based)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getAllSiteOverrides.mockResolvedValue({})
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

  it('accepts GET_SITE_INTEGRATION_ENABLEMENT runtime message payload shape', () => {
    const parsed = RuntimeMessageSchema.parse({
      type: 'GET_SITE_INTEGRATION_ENABLEMENT',
    })

    expect(parsed.type).toBe('GET_SITE_INTEGRATION_ENABLEMENT')
  })

  it('resolves download format as site override first, global default fallback', async () => {
    getAllSiteOverrides.mockResolvedValue({
      mangadex: {
        outputFormat: 'none',
      },
    })

    const plan = await resolveDownloadPlan(createTask())

    expect(plan.format).toBe('none')
    expect(plan.chapters[0]?.resolvedPath?.endsWith('.none')).toBe(false)
  })
})

