import { describe, expect, it } from "vitest"

import { resolveDownloadPlan } from "@/entrypoints/background/queue-helpers"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import type { DownloadTaskState } from "@/src/domain/queue/state"

function createTask(overrides?: Partial<DownloadTaskState>): DownloadTaskState {
  return {
    id: "task-1",
    siteIntegrationId: "mangadex",
    mangaId: "series-1",
    seriesTitle: "Queued Series",
    chapters: [
      {
        id: "chapter-1",
        url: "https://mangadex.org/chapter/chapter-1",
        title: "Chapter 1",
        index: 0,
        language: "en",
        chapterLabel: "1",
        chapterNumber: 1,
        status: "queued",
        lastUpdated: Date.now(),
      },
    ],
    status: "queued",
    created: Date.now(),
    settingsSnapshot: createTaskSettingsSnapshot(
      {
        ...DEFAULT_SETTINGS,
        downloads: {
          ...DEFAULT_SETTINGS.downloads,
          pathTemplate: "TMD/<SERIES_TITLE>",
          fileNameTemplate: "<CHAPTER_TITLE>",
        },
      },
      "mangadex",
      {
        comicInfo: {
          language: "ja",
        },
      }
    ),
    ...overrides,
  }
}

describe("resolveDownloadPlan", () => {
  it("preserves chapter-level language overrides in planned ComicInfo metadata", async () => {
    const plan = await resolveDownloadPlan(createTask())

    expect(plan.chapters).toHaveLength(1)
    expect(plan.chapters[0].language).toBe("en")
    expect(plan.chapters[0].comicInfo.LanguageISO).toBe("en")
  })

  it("fails explicitly when the frozen filename template is empty", () => {
    const task = createTask({
      settingsSnapshot: {
        ...createTask().settingsSnapshot,
        fileNameTemplate: "",
      },
    })

    expect(() => resolveDownloadPlan(task)).toThrow(
      "Filename template resolution failed: Filename template is empty"
    )
  })

  it("fails explicitly when the frozen filename template has an invalid macro", () => {
    const task = createTask({
      settingsSnapshot: {
        ...createTask().settingsSnapshot,
        fileNameTemplate: "<CHAPTER_INDEX>",
      },
    })

    expect(() => resolveDownloadPlan(task)).toThrow(
      "Filename template resolution failed: Unknown or unimplemented macros"
    )
  })
})
