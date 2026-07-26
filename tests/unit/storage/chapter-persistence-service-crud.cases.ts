import { describe, expect, it } from "vitest"
import {
  chapterPersistenceService,
  mockStorageData,
} from "./chapter-persistence-service-test-setup"
import type { DownloadedChapterRecord } from "./chapter-persistence-service-test-setup"

export function registerChapterPersistenceCrudCases(): void {
  describe("Download History CRUD", () => {
    it("drops persisted records that do not include provider identity", async () => {
      mockStorageData.downloadedChapters = [
        {
          siteIntegrationId: "mangadex",
          chapterId: "current-mangadex",
          url: "https://mangadex.org/chapter/current-mangadex",
          title: "Current MangaDex chapter",
          seriesId: "series-1",
          seriesTitle: "Series",
          downloadedAt: 1,
          format: "cbz",
        },
        {
          chapterId: "missing-provider",
          url: "https://mangadex.org/chapter/missing-provider",
          title: "Missing provider",
          seriesId: "series-1",
          seriesTitle: "Series",
          downloadedAt: 2,
          format: "cbz",
        },
      ]

      expect(await chapterPersistenceService.getDownloadedChapters()).toEqual([
        expect.objectContaining({
          siteIntegrationId: "mangadex",
          chapterId: "current-mangadex",
        }),
      ])
    })

    it("serializes concurrent chapter writes without losing either record", async () => {
      const first = {
        siteIntegrationId: "mangadex",
        chapterId: "concurrent-1",
        url: "https://example.com/1",
        title: "Chapter 1",
        seriesId: "series-1",
        seriesTitle: "Series",
        downloadedAt: 1,
        format: "cbz" as const,
      }
      const second = {
        ...first,
        siteIntegrationId: "mangadex",
        chapterId: "concurrent-2",
        url: "https://example.com/2",
        title: "Chapter 2",
        downloadedAt: 2,
      }

      await Promise.all([
        chapterPersistenceService.markChapterAsDownloaded(first),
        chapterPersistenceService.markChapterAsDownloaded(second),
      ])

      const stored = await chapterPersistenceService.getDownloadedChapters()
      expect(
        stored.map((chapter: DownloadedChapterRecord) => chapter.chapterId)
      ).toEqual(["concurrent-1", "concurrent-2"])
    })

    it("should mark a chapter as downloaded", async () => {
      const record: DownloadedChapterRecord = {
        siteIntegrationId: "mangadex",
        chapterId: "ch1",
        url: "https://example.com/ch1",
        title: "Chapter 1",
        seriesId: "series-1",
        seriesTitle: "Test Manga",
        chapterNumber: 1,
        downloadedAt: Date.now(),
        format: "cbz",
      }

      await chapterPersistenceService.markChapterAsDownloaded(record)

      const downloaded = await chapterPersistenceService.getDownloadedChapters()
      expect(downloaded).toHaveLength(1)
      expect(downloaded[0]).toMatchObject(record)
    })

    it("should check if chapter is downloaded", async () => {
      const record: DownloadedChapterRecord = {
        siteIntegrationId: "mangadex",
        chapterId: "ch1",
        url: "https://example.com/ch1",
        title: "Chapter 1",
        seriesId: "series-1",
        seriesTitle: "Test Manga",
        downloadedAt: Date.now(),
        format: "cbz",
      }

      await chapterPersistenceService.markChapterAsDownloaded(record)

      const isDownloaded = await chapterPersistenceService.isChapterDownloaded(
        "mangadex",
        "series-1",
        "ch1"
      )
      expect(isDownloaded).toBe(true)

      const notDownloaded = await chapterPersistenceService.isChapterDownloaded(
        "mangadex",
        "series-1",
        "ch999"
      )
      expect(notDownloaded).toBe(false)
    })

    it("should get all downloaded chapters", async () => {
      const records: DownloadedChapterRecord[] = [
        {
          siteIntegrationId: "mangadex",
          chapterId: "ch1",
          url: "https://example.com/ch1",
          title: "Chapter 1",
          seriesId: "series-1",
          seriesTitle: "Test Manga",
          downloadedAt: Date.now(),
          format: "cbz",
        },
        {
          siteIntegrationId: "mangadex",
          chapterId: "ch2",
          url: "https://example.com/ch2",
          title: "Chapter 2",
          seriesId: "series-1",
          seriesTitle: "Test Manga",
          downloadedAt: Date.now(),
          format: "cbz",
        },
      ]

      for (const record of records) {
        await chapterPersistenceService.markChapterAsDownloaded(record)
      }

      const downloaded = await chapterPersistenceService.getDownloadedChapters()
      expect(downloaded).toHaveLength(2)
    })

    it("should remove a downloaded chapter", async () => {
      const record: DownloadedChapterRecord = {
        siteIntegrationId: "mangadex",
        chapterId: "ch1",
        url: "https://example.com/ch1",
        title: "Chapter 1",
        seriesId: "series-1",
        seriesTitle: "Test Manga",
        downloadedAt: Date.now(),
        format: "cbz",
      }

      await chapterPersistenceService.markChapterAsDownloaded(record)
      await chapterPersistenceService.removeDownloadedChapter(
        "mangadex",
        "series-1",
        "ch1"
      )

      const downloaded = await chapterPersistenceService.getDownloadedChapters()
      expect(downloaded).toHaveLength(0)
      expect(
        mockStorageData.downloadHistoryClearCutoffs.byChapter[
          "mangadex\u0000series-1\u0000ch1"
        ]
      ).toEqual(expect.any(Number))
    })

    it("should replace existing record when re-downloading chapter", async () => {
      const record1: DownloadedChapterRecord = {
        siteIntegrationId: "mangadex",
        chapterId: "ch1",
        url: "https://example.com/ch1",
        title: "Chapter 1",
        seriesId: "series-1",
        seriesTitle: "Test Manga",
        downloadedAt: 1000,
        format: "zip",
      }

      const record2: DownloadedChapterRecord = {
        siteIntegrationId: "mangadex",
        chapterId: "ch1",
        url: "https://example.com/ch1",
        title: "Chapter 1",
        seriesId: "series-1",
        seriesTitle: "Test Manga",
        downloadedAt: 2000,
        format: "cbz",
      }

      await chapterPersistenceService.markChapterAsDownloaded(record1)
      await chapterPersistenceService.markChapterAsDownloaded(record2)

      const downloaded = await chapterPersistenceService.getDownloadedChapters()
      expect(downloaded).toHaveLength(1)
      expect(downloaded[0].downloadedAt).toBe(2000)
      expect(downloaded[0].format).toBe("cbz")
    })

    it("keeps the same chapter identifier downloaded in different series", async () => {
      const first: DownloadedChapterRecord = {
        siteIntegrationId: "mangadex",
        chapterId: "shared-chapter",
        url: "https://example.com/series-1/shared",
        title: "Shared Chapter",
        seriesId: "series-1",
        seriesTitle: "Series 1",
        downloadedAt: 1000,
        format: "cbz",
      }
      const second: DownloadedChapterRecord = {
        ...first,
        url: "https://example.com/series-2/shared",
        seriesId: "series-2",
        seriesTitle: "Series 2",
        downloadedAt: 2000,
      }

      await chapterPersistenceService.markChapterAsDownloaded(first)
      await chapterPersistenceService.markChapterAsDownloaded(second)

      const downloaded = await chapterPersistenceService.getDownloadedChapters()
      expect(downloaded).toHaveLength(2)
      expect(
        downloaded.map((record: DownloadedChapterRecord) => record.seriesId)
      ).toEqual(["series-1", "series-2"])
    })

    it("keeps identical series and chapter identifiers from different integrations", async () => {
      const pixivRecord: DownloadedChapterRecord = {
        siteIntegrationId: "pixiv-comic",
        chapterId: "93",
        url: "https://comic.pixiv.net/works/3/episodes/93",
        title: "Episode 93",
        seriesId: "3",
        seriesTitle: "Pixiv Series",
        downloadedAt: 1000,
        format: "cbz",
      }
      const comicNettaiRecord: DownloadedChapterRecord = {
        ...pixivRecord,
        siteIntegrationId: "comicnettai",
        url: "https://comic.nettai.net/book/3/content/93",
        title: "Content 93",
        seriesTitle: "Comic Nettai Series",
        downloadedAt: 2000,
      }

      await chapterPersistenceService.markChapterAsDownloaded(pixivRecord)
      await chapterPersistenceService.markChapterAsDownloaded(comicNettaiRecord)

      const downloaded = await chapterPersistenceService.getDownloadedChapters()
      expect(downloaded).toHaveLength(2)
      expect(
        downloaded.map(
          (record: DownloadedChapterRecord) => record.siteIntegrationId
        )
      ).toEqual(["pixiv-comic", "comicnettai"])
      expect(
        (await chapterPersistenceService.getAllSeriesHistory()).map(
          (history: { siteIntegrationId: string }) => history.siteIntegrationId
        )
      ).toEqual(["pixiv-comic", "comicnettai"])

      await chapterPersistenceService.removeDownloadedChapter(
        "pixiv-comic",
        "3",
        "93"
      )
      expect(await chapterPersistenceService.getDownloadedChapters()).toEqual([
        comicNettaiRecord,
      ])
    })
  })

  describe("Series-Specific Operations", () => {
    it("should get downloaded chapters for a specific series", async () => {
      const records: DownloadedChapterRecord[] = [
        {
          siteIntegrationId: "mangadex",
          chapterId: "series1-ch1",
          url: "https://example.com/series1/ch1",
          title: "Chapter 1",
          seriesId: "series-1",
          seriesTitle: "Manga A",
          downloadedAt: Date.now(),
          format: "cbz",
        },
        {
          siteIntegrationId: "mangadex",
          chapterId: "series2-ch1",
          url: "https://example.com/series2/ch1",
          title: "Chapter 1",
          seriesId: "series-2",
          seriesTitle: "Manga B",
          downloadedAt: Date.now(),
          format: "cbz",
        },
        {
          siteIntegrationId: "mangadex",
          chapterId: "series1-ch2",
          url: "https://example.com/series1/ch2",
          title: "Chapter 2",
          seriesId: "series-1",
          seriesTitle: "Manga A",
          downloadedAt: Date.now(),
          format: "cbz",
        },
      ]

      for (const record of records) {
        await chapterPersistenceService.markChapterAsDownloaded(record)
      }

      const series1Chapters =
        await chapterPersistenceService.getDownloadedChaptersForSeries(
          "mangadex",
          "series-1"
        )
      expect(series1Chapters).toHaveLength(2)
      expect(
        series1Chapters.every(
          (ch: DownloadedChapterRecord) => ch.seriesId === "series-1"
        )
      ).toBe(true)
    })

    it("should get series history", async () => {
      const record: DownloadedChapterRecord = {
        siteIntegrationId: "mangadex",
        chapterId: "ch1",
        url: "https://example.com/ch1",
        title: "Chapter 1",
        seriesId: "series-1",
        seriesTitle: "Test Manga",
        chapterNumber: 1,
        downloadedAt: Date.now(),
        format: "cbz",
      }

      await chapterPersistenceService.markChapterAsDownloaded(record)

      const history = await chapterPersistenceService.getSeriesHistory(
        "mangadex",
        "series-1"
      )
      expect(history).not.toBeNull()
      expect(history?.seriesId).toBe("series-1")
      expect(history?.downloadedChapters).toHaveLength(1)
    })

    it("should return null for non-existent series history", async () => {
      const history = await chapterPersistenceService.getSeriesHistory(
        "mangadex",
        "non-existent"
      )
      expect(history).toBeNull()
    })

    it("should update series history on new download", async () => {
      const record1: DownloadedChapterRecord = {
        siteIntegrationId: "mangadex",
        chapterId: "ch1",
        url: "https://example.com/ch1",
        title: "Chapter 1",
        seriesId: "series-1",
        seriesTitle: "Test Manga",
        chapterNumber: 1,
        downloadedAt: 1000,
        format: "cbz",
      }

      const record2: DownloadedChapterRecord = {
        siteIntegrationId: "mangadex",
        chapterId: "ch2",
        url: "https://example.com/ch2",
        title: "Chapter 2",
        seriesId: "series-1",
        seriesTitle: "Test Manga",
        chapterNumber: 2,
        downloadedAt: 2000,
        format: "cbz",
      }

      await chapterPersistenceService.markChapterAsDownloaded(record1)
      await chapterPersistenceService.markChapterAsDownloaded(record2)

      const history = await chapterPersistenceService.getSeriesHistory(
        "mangadex",
        "series-1"
      )
      expect(history?.downloadedChapters).toHaveLength(2)
      expect(history?.lastUpdated).toBe(2000)
    })

    it("should sort chapters by title in series history", async () => {
      const records: DownloadedChapterRecord[] = [
        {
          siteIntegrationId: "mangadex",
          chapterId: "ch10",
          url: "https://example.com/ch10",
          title: "Chapter 10",
          seriesId: "series-1",
          seriesTitle: "Test Manga",
          chapterNumber: 10,
          downloadedAt: Date.now(),
          format: "cbz",
        },
        {
          siteIntegrationId: "mangadex",
          chapterId: "ch2",
          url: "https://example.com/ch2",
          title: "Chapter 2",
          seriesId: "series-1",
          seriesTitle: "Test Manga",
          chapterNumber: 2,
          downloadedAt: Date.now(),
          format: "cbz",
        },
        {
          siteIntegrationId: "mangadex",
          chapterId: "ch1",
          url: "https://example.com/ch1",
          title: "Chapter 1",
          seriesId: "series-1",
          seriesTitle: "Test Manga",
          chapterNumber: 1,
          downloadedAt: Date.now(),
          format: "cbz",
        },
      ]

      for (const record of records) {
        await chapterPersistenceService.markChapterAsDownloaded(record)
      }

      const history = await chapterPersistenceService.getSeriesHistory(
        "mangadex",
        "series-1"
      )
      expect(history?.downloadedChapters[0].title).toBe("Chapter 1")
      expect(history?.downloadedChapters[1].title).toBe("Chapter 2")
      expect(history?.downloadedChapters[2].title).toBe("Chapter 10")
    })
  })
}
