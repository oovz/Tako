import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  buildStartDownloadTask,
  loadStartDownloadSettingsInputs,
} from "@/entrypoints/background/download-queue-enqueue"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { LOCAL_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import { QueueRepository } from "@/src/storage/queue-repository"
import { QueueProjectionService } from "@/src/storage/queue-projection-service"
import type {
  DownloadTaskState,
  QueueTaskSummary,
} from "@/src/domain/queue/state"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import { getRetryAvailability } from "@/entrypoints/sidepanel/components/CommandCenterQueue"
import { SettingsRepository } from "@/src/storage/settings-repository"
import type { MangaPageState } from "@/src/types/tab-state"

vi.mock("@/src/runtime/logger", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

const settingsRepository = new SettingsRepository("warn")
const settingsDependencies = {
  settingsRepository,
  siteOverridesService: { getAll: vi.fn(async () => ({})) },
  siteIntegrationSettingsService: {
    getForSite: vi.fn(async () => ({})),
  },
}

function makeTask(
  id: string,
  status: DownloadTaskState["status"],
  created: number
): DownloadTaskState {
  return {
    id,
    siteIntegrationId: "mangadex",
    mangaId: "manga-123",
    seriesTitle: "Test Manga",
    chapters: [],
    status,
    created,
    settingsSnapshot: createTaskSettingsSnapshot(DEFAULT_SETTINGS, "mangadex"),
  }
}

function createQueueRepository(
  overrides: {
    queue?: DownloadTaskState[]
    enqueueDownloadTask?: ReturnType<typeof vi.fn>
  } = {}
): {
  queueRepository: QueueRepository
  enqueueDownloadTask: ReturnType<typeof vi.fn>
} {
  const queue = overrides.queue ?? []
  const local: Record<string, unknown> = {
    [LOCAL_STORAGE_KEYS.downloadQueue]: structuredClone(queue),
  }
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: vi.fn(async (keys: string[]) =>
          Object.fromEntries(keys.map((key) => [key, local[key]]))
        ),
        set: vi.fn(async (values: Record<string, unknown>) => {
          Object.assign(local, structuredClone(values))
        }),
        remove: vi.fn(async (key: string) => {
          delete local[key]
        }),
      },
      session: { set: vi.fn(async () => undefined) },
    },
    action: {
      setBadgeText: vi.fn(async () => undefined),
      setBadgeBackgroundColor: vi.fn(async () => undefined),
    },
  } as unknown as typeof chrome)
  const queueRepository = new QueueRepository(new QueueProjectionService())
  const enqueueDownloadTask =
    overrides.enqueueDownloadTask ??
    vi.spyOn(queueRepository, "enqueueDownloadTask")

  return {
    queueRepository,
    enqueueDownloadTask,
  }
}

function makeStartContext(
  overrides: Partial<MangaPageState> = {}
): MangaPageState {
  return {
    sourceUrl: "https://example.com/series/manga-123",
    siteIntegrationId: "mangadex",
    mangaId: "manga-123",
    seriesTitle: "Test Manga",
    chapters: [
      {
        id: "https://example.com/ch-1",
        url: "https://example.com/ch-1",
        title: "Chapter 1",
        index: 1,
        status: "queued",
        lastUpdated: 1,
      },
    ],
    volumes: [],
    metadata: {
      author: "Author Name",
    },
    lastUpdated: 1,
    ...overrides,
  }
}

function makeQueueTask(overrides: Partial<QueueTaskSummary>): QueueTaskSummary {
  return {
    id: "task-1",
    seriesKey: "mangadex#manga-123",
    seriesTitle: "Series 1",
    siteIntegration: "mangadex",
    status: "partial_success",
    chapters: { total: 3, completed: 2, unsuccessful: 1 },
    timestamps: { created: Date.now(), completed: Date.now() },
    failureCategory: undefined,
    isRetried: false,
    isRetryTask: false,
    lastSuccessfulDownloadId: undefined,
    ...overrides,
  }
}

describe("multi-task same-series runtime behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(settingsRepository, "getSettings").mockResolvedValue(
      DEFAULT_SETTINGS
    )
  })

  it("allows adding a new task even when same series already has queued/downloading tasks", async () => {
    const queue = [
      makeTask("existing-queued", "queued", Date.now() - 2000),
      makeTask("existing-downloading", "downloading", Date.now() - 1000),
    ]
    const { queueRepository, enqueueDownloadTask } = createQueueRepository({
      queue,
    })

    const context = makeStartContext()
    const settingsInputs = await loadStartDownloadSettingsInputs(
      "mangadex",
      settingsDependencies
    )
    const task = buildStartDownloadTask({
      context,
      selectedChapters: context.chapters,
      settingsInputs,
      taskId: "new-task",
      now: Date.now(),
    })
    const result = await queueRepository.enqueueDownloadTask(task)

    expect(result.outcome).toBe("applied")
    expect(enqueueDownloadTask).toHaveBeenCalledTimes(1)

    const createdTask = enqueueDownloadTask.mock
      .calls[0]?.[0] as DownloadTaskState
    expect(createdTask.mangaId).toBe("manga-123")
    expect(createdTask.status).toBe("queued")
    expect(createdTask.chapters.map((chapter) => chapter.url)).toEqual([
      "https://example.com/ch-1",
    ])
  })

  it("keeps retry available for partial-success tasks even when same-series task exists", () => {
    const task = makeQueueTask({ status: "partial_success", isRetried: false })

    const result = getRetryAvailability(task, true)

    expect(result).toEqual({ canRetryFailed: true, retryBlockedMessage: null })
  })

  it("still reports non-retryable when task has no failed chapters", () => {
    const task = makeQueueTask({
      chapters: { total: 3, completed: 3, unsuccessful: 0 },
    })

    const result = getRetryAvailability(task, true)

    expect(result.canRetryFailed).toBe(false)
    expect(result.retryBlockedMessage).toBeNull()
  })
})
