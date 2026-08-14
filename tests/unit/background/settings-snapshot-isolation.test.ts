import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  buildStartDownloadTask,
  loadStartDownloadSettingsInputs,
} from "@/entrypoints/background/download-queue-enqueue"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import type { ExtensionSettings } from "@/src/domain/settings/types"
import type { QueueRepository } from "@/src/storage/queue-repository"
import type { MangaPageState } from "@/src/types/tab-state"

const settingsMocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
}))

vi.mock("@/src/runtime/logger", () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}))

const settingsDependencies = {
  settingsRepository: { getSettings: settingsMocks.getSettings },
  siteOverridesService: { getAll: vi.fn(async () => ({})) },
  siteIntegrationSettingsService: {
    getForSite: vi.fn(async () => ({})),
  },
}

type ExtensionSettingsOverrides = Partial<
  Omit<ExtensionSettings, "downloads" | "globalPolicy">
> & {
  downloads?: Partial<ExtensionSettings["downloads"]>
  globalPolicy?: {
    image?: Partial<ExtensionSettings["globalPolicy"]["image"]>
    chapter?: Partial<ExtensionSettings["globalPolicy"]["chapter"]>
  }
}

function makeSettings(
  overrides: ExtensionSettingsOverrides = {}
): ExtensionSettings {
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

function createQueueRepository(
  settingsRef: { current: ExtensionSettings },
  enqueueDownloadTask = vi.fn(async (task: unknown) => ({
    outcome: "applied",
    task,
  }))
): QueueRepository {
  settingsMocks.getSettings.mockImplementation(async () => settingsRef.current)
  return {
    enqueueDownloadTask,
  } as unknown as QueueRepository
}

const START_CONTEXT: MangaPageState = {
  sourceUrl: "https://mangadex.org/title/mangadex-series-1",
  siteIntegrationId: "mangadex",
  mangaId: "mangadex:series-1",
  seriesTitle: "Hunter x Hunter",
  chapters: [
    {
      id: "chapter-1",
      title: "Chapter 1",
      url: "https://mangadex.org/chapter/1",
      index: 1,
      chapterLabel: "1",
      volumeLabel: "Vol. 1",
      language: "en",
      status: "queued" as const,
      lastUpdated: 1,
    },
  ],
  volumes: [],
  lastUpdated: 1,
}

async function buildAndEnqueue(
  queueRepository: QueueRepository,
  context: MangaPageState,
  taskSequence: number
) {
  const settingsInputs = await loadStartDownloadSettingsInputs(
    context.siteIntegrationId,
    settingsDependencies
  )
  const task = buildStartDownloadTask({
    context,
    selectedChapters: context.chapters,
    settingsInputs,
    taskId: `task-${taskSequence}`,
    now: taskSequence,
  })
  return await queueRepository.enqueueDownloadTask(task)
}

describe("settings snapshot isolation (behavior-based)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    settingsMocks.getSettings.mockReset()
  })

  it("captures enqueue-time task settings snapshot for created task", async () => {
    const settingsRef = {
      current: makeSettings({
        downloads: {
          defaultFormat: "none",
          destination: "file-system-access",
          conflictPolicy: "overwrite",
          pathTemplate: "Library/<SERIES_TITLE>",
          fileNameTemplate: "<CHAPTER_NUMBER>-<CHAPTER_TITLE>",
        },
        globalPolicy: {
          image: { concurrency: 4, delayMs: 150 },
          chapter: { concurrency: 1, delayMs: 750 },
        },
      }),
    }
    const enqueueDownloadTask = vi.fn(async (task: unknown) => ({
      outcome: "applied",
      task,
    }))
    const queueRepository = createQueueRepository(
      settingsRef,
      enqueueDownloadTask
    )

    const result = await buildAndEnqueue(queueRepository, START_CONTEXT, 42)

    expect(result.outcome).toBe("applied")
    expect(enqueueDownloadTask).toHaveBeenCalledTimes(1)
    const addCalls = (
      enqueueDownloadTask as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls
    const createdTaskRaw = addCalls[0]?.[0]
    expect(createdTaskRaw).toBeDefined()

    const createdTask = createdTaskRaw as {
      settingsSnapshot: {
        archiveFormat: string
        destination: string
        conflictPolicy: string
        pathTemplate: string
        fileNameTemplate: string
        rateLimitSettings: {
          image: { concurrency: number; delayMs: number }
          chapter: { concurrency: number; delayMs: number }
        }
      }
    }

    expect(createdTask.settingsSnapshot.archiveFormat).toBe("none")
    expect(createdTask.settingsSnapshot.destination).toBe("file-system-access")
    expect(createdTask.settingsSnapshot.conflictPolicy).toBe("overwrite")
    expect(createdTask.settingsSnapshot.pathTemplate).toBe(
      "Library/<SERIES_TITLE>"
    )
    expect(createdTask.settingsSnapshot.fileNameTemplate).toBe(
      "<CHAPTER_NUMBER>-<CHAPTER_TITLE>"
    )
    expect(createdTask.settingsSnapshot.rateLimitSettings.image).toEqual({
      concurrency: 2,
      delayMs: 500,
    })
    expect(createdTask.settingsSnapshot.rateLimitSettings.chapter).toEqual({
      concurrency: 1,
      delayMs: 500,
    })
  })

  it("keeps first task snapshot isolated from later settings mutation while new task uses updated values", async () => {
    const settingsRef = {
      current: makeSettings({
        downloads: {
          defaultFormat: "cbz",
          destination: "downloads-api",
          conflictPolicy: "uniquify",
        },
        globalPolicy: {
          image: { concurrency: 4, delayMs: 100 },
          chapter: { concurrency: 1, delayMs: 500 },
        },
      }),
    }
    const enqueueDownloadTask = vi.fn(async (task: unknown) => ({
      outcome: "applied",
      task,
    }))
    const queueRepository = createQueueRepository(
      settingsRef,
      enqueueDownloadTask
    )

    await buildAndEnqueue(queueRepository, START_CONTEXT, 1)

    settingsRef.current.downloads.defaultFormat = "zip"
    settingsRef.current.downloads.destination = "file-system-access"
    settingsRef.current.downloads.conflictPolicy = "overwrite"
    settingsRef.current.globalPolicy.image.concurrency = 9
    settingsRef.current.globalPolicy.chapter.delayMs = 250

    await buildAndEnqueue(queueRepository, START_CONTEXT, 2)
    expect(enqueueDownloadTask).toHaveBeenCalledTimes(2)

    const addCalls = (
      enqueueDownloadTask as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls
    const firstTaskRaw = addCalls[0]?.[0]
    const secondTaskRaw = addCalls[1]?.[0]
    expect(firstTaskRaw).toBeDefined()
    expect(secondTaskRaw).toBeDefined()

    const firstTaskSnapshot = (
      firstTaskRaw as {
        settingsSnapshot: {
          archiveFormat: string
          destination: string
          conflictPolicy: string
          rateLimitSettings: {
            image: { concurrency: number; delayMs: number }
            chapter: { concurrency: number; delayMs: number }
          }
        }
      }
    ).settingsSnapshot

    const secondTaskSnapshot = (
      secondTaskRaw as {
        settingsSnapshot: {
          archiveFormat: string
          destination: string
          conflictPolicy: string
          rateLimitSettings: {
            image: { concurrency: number; delayMs: number }
            chapter: { concurrency: number; delayMs: number }
          }
        }
      }
    ).settingsSnapshot

    expect(firstTaskSnapshot.archiveFormat).toBe("cbz")
    expect(firstTaskSnapshot.destination).toBe("downloads-api")
    expect(firstTaskSnapshot.conflictPolicy).toBe("uniquify")
    expect(firstTaskSnapshot.rateLimitSettings.image).toEqual({
      concurrency: 2,
      delayMs: 500,
    })
    expect(firstTaskSnapshot.rateLimitSettings.chapter).toEqual({
      concurrency: 1,
      delayMs: 500,
    })

    expect(secondTaskSnapshot.archiveFormat).toBe("zip")
    expect(secondTaskSnapshot.destination).toBe("file-system-access")
    expect(secondTaskSnapshot.conflictPolicy).toBe("overwrite")
    expect(secondTaskSnapshot.rateLimitSettings.image).toEqual({
      concurrency: 2,
      delayMs: 500,
    })
    expect(secondTaskSnapshot.rateLimitSettings.chapter).toEqual({
      concurrency: 1,
      delayMs: 500,
    })
  })

  it("uses registered site policy defaults when enqueueing a task", async () => {
    const settingsRef = {
      current: makeSettings({
        globalPolicy: {
          image: { concurrency: 2, delayMs: 100 },
          chapter: { concurrency: 1, delayMs: 200 },
        },
      }),
    }
    const enqueueDownloadTask = vi.fn(async (task: unknown) => ({
      outcome: "applied",
      task,
    }))
    const queueRepository = createQueueRepository(
      settingsRef,
      enqueueDownloadTask
    )

    const result = await buildAndEnqueue(
      queueRepository,
      {
        ...START_CONTEXT,
        siteIntegrationId: "mangadex",
      },
      42
    )

    expect(result.outcome).toBe("applied")
    const addCalls = (
      enqueueDownloadTask as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls
    const createdTaskRaw = addCalls[0]?.[0]
    expect(createdTaskRaw).toBeDefined()

    const snapshot = (
      createdTaskRaw as {
        settingsSnapshot: {
          rateLimitSettings: {
            image: { concurrency: number; delayMs: number }
            chapter: { concurrency: number; delayMs: number }
          }
        }
      }
    ).settingsSnapshot

    expect(snapshot.rateLimitSettings.image).toEqual({
      concurrency: 2,
      delayMs: 500,
    })
    expect(snapshot.rateLimitSettings.chapter).toEqual({
      concurrency: 1,
      delayMs: 500,
    })
  })

  it("createTaskSettingsSnapshot returns policy objects independent from subsequent source mutations", () => {
    const settings = makeSettings({
      globalPolicy: {
        image: { concurrency: 4, delayMs: 100 },
        chapter: { concurrency: 1, delayMs: 500 },
      },
    })

    const snapshot = createTaskSettingsSnapshot(settings, "mangadex")

    settings.globalPolicy.image.concurrency = 99
    settings.globalPolicy.chapter.delayMs = 999

    expect(snapshot.rateLimitSettings.image).toEqual({
      concurrency: 4,
      delayMs: 100,
    })
    expect(snapshot.rateLimitSettings.chapter).toEqual({
      concurrency: 1,
      delayMs: 500,
    })
  })

  it("freezes chapter concurrency at one while applying configured chapter delay", () => {
    const settings = makeSettings({
      globalPolicy: {
        image: { concurrency: 4, delayMs: 100 },
        chapter: { concurrency: 1, delayMs: 500 },
      },
    })

    const snapshot = createTaskSettingsSnapshot(settings, "mangadex", {
      siteOverride: {
        chapterPolicy: { concurrency: 9, delayMs: 1250 } as unknown as {
          delayMs: number
        },
      },
    })

    expect(snapshot.rateLimitSettings.chapter).toEqual({
      concurrency: 1,
      delayMs: 1250,
    })
  })

  it("applies site policy defaults between global settings and explicit site overrides", () => {
    const settings = makeSettings({
      globalPolicy: {
        image: { concurrency: 2, delayMs: 100 },
        chapter: { concurrency: 1, delayMs: 200 },
      },
    })

    const snapshot = createTaskSettingsSnapshot(settings, "custom-site", {
      sitePolicyDefaults: {
        image: { concurrency: 6, delayMs: 700 },
        chapter: { concurrency: 4, delayMs: 800 },
      },
      siteOverride: {
        imagePolicy: { delayMs: 900 },
        chapterPolicy: { delayMs: 1000 },
      },
    })

    expect(snapshot.rateLimitSettings.image).toEqual({
      concurrency: 6,
      delayMs: 900,
    })
    expect(snapshot.rateLimitSettings.chapter).toEqual({
      concurrency: 1,
      delayMs: 1000,
    })
  })

  it("rejects an invalid current settings document", () => {
    const settings = makeSettings({
      globalPolicy: {
        image: { concurrency: -4, delayMs: -50 },
        chapter: { concurrency: 9, delayMs: -75 },
      },
      globalRetries: { image: 99, chapter: -2 },
    })

    expect(() => createTaskSettingsSnapshot(settings, "custom-site")).toThrow(
      "Stored settings document is invalid"
    )
  })
})
