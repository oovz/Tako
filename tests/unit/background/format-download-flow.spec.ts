import { captureRequestedOutputPath } from "@/src/runtime/task-output-path"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { resolveDownloadPlan } from "@/entrypoints/background/queue-helpers"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import type { ExtensionSettings } from "@/src/domain/settings/types"
import type { DownloadTaskState } from "@/src/domain/queue/state"

const getAllSiteOverrides = vi.fn(async () => ({}))

vi.mock("@/src/storage/site-overrides-service", () => ({
  siteOverridesService: {
    getAll: () => getAllSiteOverrides(),
  },
}))

vi.mock("@/src/runtime/logger", () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}))

function makeSettings(
  defaultFormat: "cbz" | "zip" | "none"
): ExtensionSettings {
  return {
    ...DEFAULT_SETTINGS,
    downloads: {
      ...DEFAULT_SETTINGS.downloads,
      defaultFormat,
      pathTemplate: "Library/<SERIES_TITLE>",
      fileNameTemplate: "<CHAPTER_TITLE>",
    },
  }
}

function createTask(
  snapshotSettings: ExtensionSettings = makeSettings("zip")
): DownloadTaskState {
  const now = Date.now()
  const task: DownloadTaskState = {
    id: "task-1",
    siteIntegrationId: "mangadex",
    mangaId: "mangadex:series-1",
    seriesTitle: "Hunter x Hunter",
    chapters: [
      {
        requestedPath: "Tako/Chapter.cbz",
        id: "ch-1",
        url: "https://mangadex.org/chapter/ch-1",
        title: "Chapter 1",
        index: 1,
        chapterNumber: 1,
        volumeNumber: 1,
        status: "queued",
        lastUpdated: now,
      },
    ],
    status: "queued",
    created: now,
    settingsSnapshot: createTaskSettingsSnapshot(snapshotSettings, "mangadex"),
  }
  task.chapters = task.chapters.map((chapter) => ({
    ...chapter,
    requestedPath: captureRequestedOutputPath(task, chapter),
  }))
  return task
}

describe("queued download format", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getAllSiteOverrides.mockResolvedValue({})
  })

  it.each([
    ["cbz", "Library/Hunter x Hunter/Chapter 1.cbz"],
    ["zip", "Library/Hunter x Hunter/Chapter 1.zip"],
    ["none", "Library/Hunter x Hunter/Chapter 1"],
  ] as const)(
    "preserves the queued %s format and path",
    async (format, path) => {
      getAllSiteOverrides.mockResolvedValue({
        mangadex: { outputFormat: format === "none" ? "cbz" : "none" },
      })

      const plan = await resolveDownloadPlan(createTask(makeSettings(format)))

      expect(plan.format).toBe(format)
      expect(plan.chapters[0]?.resolvedPath).toBe(path)
      expect(getAllSiteOverrides).not.toHaveBeenCalled()
    }
  )
})
