import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  buildStartDownloadTask,
  loadStartDownloadSettingsInputs,
} from "@/entrypoints/background/download-queue-enqueue"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import type { MangaPageState } from "@/src/types/tab-state"

const serviceMocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  getSiteOverrides: vi.fn(),
  getSiteSettings: vi.fn(),
}))

const settingsDependencies = {
  settingsRepository: { getSettings: serviceMocks.getSettings },
  siteOverridesService: { getAll: serviceMocks.getSiteOverrides },
  siteIntegrationSettingsService: {
    getForSite: serviceMocks.getSiteSettings,
  },
}

const context: MangaPageState = {
  sourceUrl: "https://mangadex.org/title/series-1",
  siteIntegrationId: "mangadex",
  mangaId: "series-1",
  seriesTitle: " Series Title ",
  chapters: [
    {
      id: "chapter-1",
      title: " Chapter 12 ",
      url: "https://mangadex.org/chapter/1",
      index: 1,
      chapterLabel: "Ch. 12.5",
      chapterNumber: 12.5,
      volumeLabel: "Vol. 02",
      volumeNumber: 2,
      language: "en",
      status: "queued",
      lastUpdated: 1,
    },
  ],
  volumes: [],
  metadata: {
    author: "Author Name",
    coverUrl: "https://example.com/cover.jpg",
    publisher: "Test Publisher",
    readingDirection: "rtl",
  },
  lastUpdated: 1,
}

describe("START_DOWNLOAD task inputs and builder", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    serviceMocks.getSettings.mockResolvedValue(DEFAULT_SETTINGS)
    serviceMocks.getSiteOverrides.mockResolvedValue({
      mangadex: { enabled: true },
    })
    serviceMocks.getSiteSettings.mockResolvedValue({ imageQuality: "data" })
  })

  it("loads the current settings and provider inputs once", async () => {
    await expect(
      loadStartDownloadSettingsInputs("mangadex", settingsDependencies)
    ).resolves.toEqual({
      settings: DEFAULT_SETTINGS,
      siteOverride: { enabled: true },
      siteSettings: { imageQuality: "data" },
      sitePolicyDefaults: {
        image: { concurrency: 2, delayMs: 500 },
        chapter: { concurrency: 1, delayMs: 500 },
      },
    })
    expect(serviceMocks.getSettings).toHaveBeenCalledTimes(1)
    expect(serviceMocks.getSiteOverrides).toHaveBeenCalledTimes(1)
    expect(serviceMocks.getSiteSettings).toHaveBeenCalledWith("mangadex")
  })

  it("builds a queued task synchronously from canonical context data", async () => {
    const settingsInputs = await loadStartDownloadSettingsInputs(
      "mangadex",
      settingsDependencies
    )

    const task = buildStartDownloadTask({
      context,
      selectedChapters: context.chapters,
      settingsInputs,
      taskId: "task-1",
      now: 100,
    })

    expect(task).toMatchObject({
      id: "task-1",
      siteIntegrationId: "mangadex",
      mangaId: "series-1",
      seriesTitle: "Series Title",
      seriesCoverUrl: "https://example.com/cover.jpg",
      status: "queued",
      created: 100,
      chapters: [
        {
          id: "chapter-1",
          title: "Chapter 12",
          url: "https://mangadex.org/chapter/1",
          chapterLabel: "Ch. 12.5",
          chapterNumber: 12.5,
          volumeLabel: "Vol. 02",
          volumeNumber: 2,
          language: "en",
          status: "queued",
          lastUpdated: 100,
          outputs: { requested: 0, committed: 0, failed: 0 },
        },
      ],
      settingsSnapshot: {
        archiveFormat: "cbz",
        siteIntegrationId: "mangadex",
        comicInfo: {
          author: "Author Name",
          coverUrl: "https://example.com/cover.jpg",
          publisher: "Test Publisher",
          readingDirection: "rtl",
        },
      },
    })
  })

  it("does not infer chapter or volume numbers when canonical data omits them", async () => {
    const settingsInputs = await loadStartDownloadSettingsInputs(
      "mangadex",
      settingsDependencies
    )
    const selectedChapter = {
      ...context.chapters[0],
      title: "Volume 01 Episode 07",
      chapterNumber: undefined,
      volumeNumber: undefined,
    }

    const task = buildStartDownloadTask({
      context: { ...context, chapters: [selectedChapter] },
      selectedChapters: [selectedChapter],
      settingsInputs,
      taskId: "task-2",
      now: 200,
    })

    expect(task.chapters[0]).toEqual(
      expect.objectContaining({
        title: "Volume 01 Episode 07",
        chapterNumber: undefined,
        volumeNumber: undefined,
      })
    )
  })
})
