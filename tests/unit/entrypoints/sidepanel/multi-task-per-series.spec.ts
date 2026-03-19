import { beforeEach, describe, expect, it, vi } from 'vitest'

import { enqueueStartDownloadTask } from '@/entrypoints/background/download-queue'
import { createTaskSettingsSnapshot } from '@/entrypoints/background/settings-snapshot'
import type { CentralizedStateManager } from '@/src/runtime/centralized-state'
import type { DownloadTaskState, QueueTaskSummary } from '@/src/types/queue-state'
import { DEFAULT_SETTINGS } from '@/src/storage/default-settings'
import { getRetryAvailability } from '@/entrypoints/sidepanel/components/CommandCenterQueue'

vi.mock('@/src/runtime/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

function makeTask(id: string, status: DownloadTaskState['status'], created: number): DownloadTaskState {
  return {
    id,
    siteIntegrationId: 'mangadex',
    mangaId: 'manga-123',
    seriesTitle: 'Test Manga',
    chapters: [],
    status,
    created,
    settingsSnapshot: createTaskSettingsSnapshot(DEFAULT_SETTINGS, 'mangadex'),
  }
}

function createStateManager(overrides: {
  queue?: DownloadTaskState[]
  addDownloadTask?: ReturnType<typeof vi.fn>
} = {}): { stateManager: CentralizedStateManager; addDownloadTask: ReturnType<typeof vi.fn> } {
  const addDownloadTask = overrides.addDownloadTask ?? vi.fn(async (_task: unknown) => undefined)
  const queue = overrides.queue ?? []

  return {
    stateManager: {
      getGlobalState: vi.fn(async () => ({
        downloadQueue: queue,
        settings: {
          downloads: {
            defaultFormat: 'cbz',
            overwriteExisting: false,
            pathTemplate: '{seriesTitle}/{chapterTitle}',
            fileNameTemplate: '<CHAPTER_TITLE>',
            includeComicInfo: true,
            includeCoverImage: true,
          },
          globalPolicy: {
            image: { concurrency: 2, delayMs: 500 },
            chapter: { concurrency: 2, delayMs: 500 },
          },
          advanced: { logLevel: 'debug' },
        },
        lastActivity: Date.now(),
      })),
      addDownloadTask,
    } as unknown as CentralizedStateManager,
    addDownloadTask,
  }
}

function makeStartPayload(overrides: Partial<Parameters<typeof enqueueStartDownloadTask>[1]> = {}): Parameters<typeof enqueueStartDownloadTask>[1] {
  return {
    siteIntegrationId: 'mangadex',
    mangaId: 'manga-123',
    seriesTitle: 'Test Manga',
    chapters: [
      {
        id: 'https://example.com/ch-1',
        url: 'https://example.com/ch-1',
        title: 'Chapter 1',
        index: 1,
      },
    ],
    metadata: {
      author: 'Author Name',
    },
    ...overrides,
  }
}

function makeQueueTask(overrides: Partial<QueueTaskSummary>): QueueTaskSummary {
  return {
    id: 'task-1',
    seriesKey: 'mangadex#manga-123',
    seriesTitle: 'Series 1',
    siteIntegration: 'mangadex',
    status: 'partial_success',
    chapters: { total: 3, completed: 2, unsuccessful: 1 },
    timestamps: { created: Date.now(), completed: Date.now() },
    failureReason: undefined,
    failureCategory: undefined,
    isRetried: false,
    isRetryTask: false,
    lastSuccessfulDownloadId: undefined,
    ...overrides,
  }
}

describe('multi-task same-series runtime behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('allows adding a new task even when same series already has queued/downloading tasks', async () => {
    const queue = [
      makeTask('existing-queued', 'queued', Date.now() - 2000),
      makeTask('existing-downloading', 'downloading', Date.now() - 1000),
    ]
    const { stateManager, addDownloadTask } = createStateManager({ queue })

    const result = await enqueueStartDownloadTask(
      stateManager,
      makeStartPayload(),
      42,
    )

    expect(result.success).toBe(true)
    expect(typeof result.taskId).toBe('string')
    expect(result.taskId?.length ?? 0).toBeGreaterThan(0)
    expect(addDownloadTask).toHaveBeenCalledTimes(1)

    const createdTask = addDownloadTask.mock.calls[0]?.[0] as DownloadTaskState
    expect(createdTask.mangaId).toBe('manga-123')
    expect(createdTask.status).toBe('queued')
    expect(createdTask.chapters.map((chapter) => chapter.url)).toEqual(['https://example.com/ch-1'])
  })

  it('rejects enqueue payloads that are missing stable ids', async () => {
    const { stateManager, addDownloadTask } = createStateManager()

    const result = await enqueueStartDownloadTask(
      stateManager,
      makeStartPayload({
        chapters: [
          {
            id: '',
            url: 'https://example.com/ch-1',
            title: 'Chapter 1',
            index: 1,
          },
        ],
      }),
      42,
    )

    expect(result).toEqual({ success: false, reason: 'Invalid START_DOWNLOAD payload' })
    expect(addDownloadTask).not.toHaveBeenCalled()
  })

  it('keeps retry available for partial-success tasks even when same-series task exists', () => {
    const task = makeQueueTask({ status: 'partial_success', isRetried: false })

    const result = getRetryAvailability(task, true)

    expect(result).toEqual({ canRetryFailed: true, retryBlockedMessage: null })
  })

  it('still reports non-retryable when task has no failed chapters', () => {
    const task = makeQueueTask({ chapters: { total: 3, completed: 3, unsuccessful: 0 } })

    const result = getRetryAvailability(task, true)

    expect(result.canRetryFailed).toBe(false)
    expect(result.retryBlockedMessage).toBeNull()
  })
})

