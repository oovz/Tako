import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveDownloadPlan } from '@/entrypoints/background/queue-helpers'
import { createTaskSettingsSnapshot } from '@/entrypoints/background/settings-snapshot'
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

function createTask(overrides: Partial<DownloadTaskState> = {}): DownloadTaskState {
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
    settingsSnapshot: createTaskSettingsSnapshot(makeSettings('cbz'), 'mangadex'),
    ...overrides,
  }
}

function createStateManager(settings: ExtensionSettings): CentralizedStateManager {
  return {
    getTabState: vi.fn(async () => null),
    getGlobalState: vi.fn(async () => ({
      downloadQueue: [],
      settings,
      lastActivity: Date.now(),
    })),
  } as unknown as CentralizedStateManager
}

describe('format resolution hierarchy (behavior-based)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getAllSiteOverrides.mockResolvedValue({})
  })

  it('uses site override format over global default when override is valid', async () => {
    const stateManager = createStateManager(makeSettings('cbz'))
    const plan = await resolveDownloadPlan(stateManager, createTask({
      settingsSnapshot: {
        ...createTaskSettingsSnapshot(makeSettings('cbz'), 'mangadex'),
        archiveFormat: 'zip',
      },
    }))

    expect(plan.format).toBe('zip')
    expect(plan.chapters[0]?.resolvedPath).toContain('.zip')
  })

  it('falls back to cbz when the persisted snapshot format is invalid', async () => {
    const stateManager = createStateManager(makeSettings('cbz'))
    const plan = await resolveDownloadPlan(stateManager, createTask({
      settingsSnapshot: {
        ...createTaskSettingsSnapshot(makeSettings('cbz'), 'mangadex'),
        archiveFormat: 'rar' as unknown as DownloadTaskState['settingsSnapshot']['archiveFormat'],
      },
    }))

    expect(plan.format).toBe('cbz')
    expect(plan.chapters[0]?.resolvedPath).toContain('.cbz')
  })

  it('uses the frozen task snapshot without consulting tab-scoped format state', async () => {
    const stateManager = createStateManager(makeSettings('cbz'))
    const plan = await resolveDownloadPlan(stateManager, createTask())

    expect(plan.format).toBe('cbz')
    expect(plan.chapters[0]?.resolvedPath).toContain('.cbz')
    expect(stateManager.getTabState).not.toHaveBeenCalled()
  })

  it('produces folder-like path without archive extension for none format', async () => {
    const stateManager = createStateManager(makeSettings('zip'))
    const plan = await resolveDownloadPlan(stateManager, createTask({
      settingsSnapshot: {
        ...createTaskSettingsSnapshot(makeSettings('zip'), 'mangadex'),
        archiveFormat: 'none',
      },
    }))

    expect(plan.format).toBe('none')
    expect(plan.chapters[0]?.resolvedPath).toBe('Library/Hunter x Hunter/Chapter 1')
    expect(plan.chapters[0]?.resolvedPath?.endsWith('.none')).toBe(false)
  })
})

