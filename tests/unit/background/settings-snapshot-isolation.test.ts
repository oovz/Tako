import { beforeEach, describe, expect, it, vi } from 'vitest'

import { enqueueStartDownloadTask } from '@/entrypoints/background/download-queue'
import { createTaskSettingsSnapshot } from '@/entrypoints/background/settings-snapshot'
import { DEFAULT_SETTINGS } from '@/src/storage/default-settings'
import type { ExtensionSettings } from '@/src/storage/settings-types'
import type { CentralizedStateManager } from '@/src/runtime/centralized-state'

vi.mock('@/src/runtime/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}))

type ExtensionSettingsOverrides = Partial<Omit<ExtensionSettings, 'downloads' | 'globalPolicy'>> & {
  downloads?: Partial<ExtensionSettings['downloads']>
  globalPolicy?: {
    image?: Partial<ExtensionSettings['globalPolicy']['image']>
    chapter?: Partial<ExtensionSettings['globalPolicy']['chapter']>
  }
}

function makeSettings(overrides: ExtensionSettingsOverrides = {}): ExtensionSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...overrides,
    downloads: {
      ...DEFAULT_SETTINGS.downloads,
      ...(overrides.downloads ?? {}),
    },
    globalPolicy: {
      image: {
        ...DEFAULT_SETTINGS.globalPolicy.image,
        ...(overrides.globalPolicy?.image ?? {}),
      },
      chapter: {
        ...DEFAULT_SETTINGS.globalPolicy.chapter,
        ...(overrides.globalPolicy?.chapter ?? {}),
      },
    },
  }
}

function createStateManager(
  settingsRef: { current: ExtensionSettings },
  addDownloadTask = vi.fn(async (_task: unknown) => {}),
): CentralizedStateManager {
  return {
    getGlobalState: vi.fn(async () => ({
      downloadQueue: [],
      settings: settingsRef.current,
      lastActivity: Date.now(),
    })),
    addDownloadTask,
  } as unknown as CentralizedStateManager
}

const START_PAYLOAD = {
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
      volumeLabel: 'Vol. 1',
      language: 'en',
    },
  ],
}

describe('settings snapshot isolation (behavior-based)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('captures enqueue-time task settings snapshot for created task', async () => {
    const settingsRef = {
      current: makeSettings({
        downloads: {
          defaultFormat: 'none',
          overwriteExisting: true,
          pathTemplate: 'Library/<SERIES_TITLE>',
          fileNameTemplate: '<CHAPTER_NUMBER>-<CHAPTER_TITLE>',
        },
        globalPolicy: {
          image: { concurrency: 4, delayMs: 150 },
          chapter: { concurrency: 1, delayMs: 750 },
        },
      }),
    }
    const addDownloadTask = vi.fn(async (_task: unknown) => {})
    const stateManager = createStateManager(settingsRef, addDownloadTask)

    const result = await enqueueStartDownloadTask(stateManager, START_PAYLOAD, 42)

    expect(result.success).toBe(true)
    expect(addDownloadTask).toHaveBeenCalledTimes(1)
    const addCalls = (addDownloadTask as unknown as { mock: { calls: unknown[][] } }).mock.calls
    const createdTaskRaw = addCalls[0]?.[0]
    expect(createdTaskRaw).toBeDefined()

    const createdTask = createdTaskRaw as {
      settingsSnapshot: {
        archiveFormat: string
        overwriteExisting: boolean
        pathTemplate: string
        fileNameTemplate: string
        rateLimitSettings: {
          image: { concurrency: number; delayMs: number }
          chapter: { concurrency: number; delayMs: number }
        }
      }
    }

    expect(createdTask.settingsSnapshot.archiveFormat).toBe('none')
    expect(createdTask.settingsSnapshot.overwriteExisting).toBe(true)
    expect(createdTask.settingsSnapshot.pathTemplate).toBe('Library/<SERIES_TITLE>')
    expect(createdTask.settingsSnapshot.fileNameTemplate).toBe('<CHAPTER_NUMBER>-<CHAPTER_TITLE>')
    expect(createdTask.settingsSnapshot.rateLimitSettings.image).toEqual({ concurrency: 4, delayMs: 150 })
    expect(createdTask.settingsSnapshot.rateLimitSettings.chapter).toEqual({ concurrency: 1, delayMs: 750 })
  })

  it('keeps first task snapshot isolated from later settings mutation while new task uses updated values', async () => {
    const settingsRef = {
      current: makeSettings({
        downloads: {
          defaultFormat: 'cbz',
          overwriteExisting: false,
        },
        globalPolicy: {
          image: { concurrency: 4, delayMs: 100 },
          chapter: { concurrency: 1, delayMs: 500 },
        },
      }),
    }
    const addDownloadTask = vi.fn(async (_task: unknown) => {})
    const stateManager = createStateManager(settingsRef, addDownloadTask)

    await enqueueStartDownloadTask(stateManager, START_PAYLOAD, 1)

    settingsRef.current.downloads.defaultFormat = 'zip'
    settingsRef.current.downloads.overwriteExisting = true
    settingsRef.current.globalPolicy.image.concurrency = 9
    settingsRef.current.globalPolicy.chapter.delayMs = 250

    await enqueueStartDownloadTask(stateManager, START_PAYLOAD, 2)
    expect(addDownloadTask).toHaveBeenCalledTimes(2)

    const addCalls = (addDownloadTask as unknown as { mock: { calls: unknown[][] } }).mock.calls
    const firstTaskRaw = addCalls[0]?.[0]
    const secondTaskRaw = addCalls[1]?.[0]
    expect(firstTaskRaw).toBeDefined()
    expect(secondTaskRaw).toBeDefined()

    const firstTaskSnapshot = (firstTaskRaw as {
      settingsSnapshot: {
        archiveFormat: string
        overwriteExisting: boolean
        rateLimitSettings: {
          image: { concurrency: number; delayMs: number }
          chapter: { concurrency: number; delayMs: number }
        }
      }
    }).settingsSnapshot

    const secondTaskSnapshot = (secondTaskRaw as {
      settingsSnapshot: {
        archiveFormat: string
        overwriteExisting: boolean
        rateLimitSettings: {
          image: { concurrency: number; delayMs: number }
          chapter: { concurrency: number; delayMs: number }
        }
      }
    }).settingsSnapshot

    expect(firstTaskSnapshot.archiveFormat).toBe('cbz')
    expect(firstTaskSnapshot.overwriteExisting).toBe(false)
    expect(firstTaskSnapshot.rateLimitSettings.image).toEqual({ concurrency: 4, delayMs: 100 })
    expect(firstTaskSnapshot.rateLimitSettings.chapter).toEqual({ concurrency: 1, delayMs: 500 })

    expect(secondTaskSnapshot.archiveFormat).toBe('zip')
    expect(secondTaskSnapshot.overwriteExisting).toBe(true)
    expect(secondTaskSnapshot.rateLimitSettings.image).toEqual({ concurrency: 9, delayMs: 100 })
    expect(secondTaskSnapshot.rateLimitSettings.chapter).toEqual({ concurrency: 1, delayMs: 250 })
  })

  it('createTaskSettingsSnapshot returns policy objects independent from subsequent source mutations', () => {
    const settings = makeSettings({
      globalPolicy: {
        image: { concurrency: 4, delayMs: 100 },
        chapter: { concurrency: 1, delayMs: 500 },
      },
    })

    const snapshot = createTaskSettingsSnapshot(settings, 'mangadex')

    settings.globalPolicy.image.concurrency = 99
    settings.globalPolicy.chapter.delayMs = 999

    expect(snapshot.rateLimitSettings.image).toEqual({ concurrency: 4, delayMs: 100 })
    expect(snapshot.rateLimitSettings.chapter).toEqual({ concurrency: 1, delayMs: 500 })
  })
})

