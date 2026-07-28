import { describe, expect, it, vi } from "vitest"

import {
  chapterPersistenceService,
  type DownloadedChapterRecord,
} from "@/src/storage/chapter-persistence-service"
import {
  mockStorageData,
  type LegacyDownloadedChapterRecord,
} from "./chapter-persistence-service-test-setup"

function legacyRecord(
  seriesId: string,
  url: string,
  chapterId = `chapter-${seriesId}`
): LegacyDownloadedChapterRecord {
  return {
    chapterId,
    url,
    title: `Chapter ${seriesId}`,
    seriesId,
    seriesTitle: `Series ${seriesId}`,
    downloadedAt: 100,
    format: "cbz",
  }
}

function legacyHistory(record: LegacyDownloadedChapterRecord) {
  return {
    seriesId: record.seriesId,
    seriesTitle: record.seriesTitle,
    lastUpdated: record.downloadedAt,
    downloadedChapters: [record],
  }
}

export function registerChapterPersistenceMigrationCases(): void {
  describe("released history migration", () => {
    it("migrates every v1.5.5 provider without changing record timestamps", async () => {
      const legacyRecords = [
        legacyRecord(
          "mangadex-series",
          "https://mangadex.org/chapter/mangadex-chapter"
        ),
        legacyRecord(
          "pixiv-series",
          "https://comic.pixiv.net/viewer/stories/123"
        ),
        legacyRecord("jump-series", "https://shonenjumpplus.com/episode/456"),
        legacyRecord(
          "manhuagui-series",
          "https://www.manhuagui.com/comic/123/456.html"
        ),
        legacyRecord(
          "nettai-series",
          "https://www.comicnettai.com/publus/viewer?cid=789"
        ),
      ]
      mockStorageData.downloadedChapters = legacyRecords
      mockStorageData.seriesDownloadHistory = Object.fromEntries(
        legacyRecords.map((record) => [record.seriesId, legacyHistory(record)])
      )

      await expect(
        chapterPersistenceService.migrateLegacyDownloadHistory()
      ).resolves.toBe(true)

      expect(
        mockStorageData.downloadedChapters.map(
          (record: DownloadedChapterRecord) => [
            record.siteIntegrationId,
            record.downloadedAt,
          ]
        )
      ).toEqual([
        ["mangadex", 100],
        ["pixiv-comic", 100],
        ["shonenjumpplus", 100],
        ["manhuagui", 100],
        ["comicnettai", 100],
      ])
      expect(Object.keys(mockStorageData.seriesDownloadHistory)).toEqual([
        "mangadex#mangadex-series",
        "pixiv-comic#pixiv-series",
        "shonenjumpplus#jump-series",
        "manhuagui#manhuagui-series",
        "comicnettai#nettai-series",
      ])
      expect(
        Object.values(mockStorageData.seriesDownloadHistory).map(
          (history: any) => history.downloadedChapters[0].siteIntegrationId
        )
      ).toEqual([
        "mangadex",
        "pixiv-comic",
        "shonenjumpplus",
        "manhuagui",
        "comicnettai",
      ])
    })

    it("splits a released series bucket when provider ids collided", async () => {
      const mangadex = legacyRecord(
        "shared-series",
        "https://mangadex.org/chapter/1",
        "mangadex-chapter"
      )
      const pixiv = legacyRecord(
        "shared-series",
        "https://comic.pixiv.net/viewer/stories/1",
        "pixiv-chapter"
      )
      mockStorageData.seriesDownloadHistory = {
        "shared-series": {
          seriesId: "shared-series",
          seriesTitle: "Shared Series",
          lastUpdated: 100,
          downloadedChapters: [mangadex, pixiv],
        },
      }

      await chapterPersistenceService.migrateLegacyDownloadHistory()

      expect(Object.keys(mockStorageData.seriesDownloadHistory)).toEqual([
        "mangadex#shared-series",
        "pixiv-comic#shared-series",
      ])
      expect(
        mockStorageData.seriesDownloadHistory["mangadex#shared-series"]
          .downloadedChapters
      ).toEqual([
        expect.objectContaining({
          siteIntegrationId: "mangadex",
          chapterId: "mangadex-chapter",
        }),
      ])
      expect(
        mockStorageData.seriesDownloadHistory["pixiv-comic#shared-series"]
          .downloadedChapters
      ).toEqual([
        expect.objectContaining({
          siteIntegrationId: "pixiv-comic",
          chapterId: "pixiv-chapter",
        }),
      ])
    })

    it("preserves unrecognized released records under a stable legacy identity", async () => {
      const unknownHost = legacyRecord(
        "unknown-host",
        "https://reader.example.net/chapter/1"
      )
      const malformedUrl = legacyRecord("malformed-url", "not a URL")
      mockStorageData.downloadedChapters = [unknownHost, malformedUrl]
      mockStorageData.seriesDownloadHistory = {
        "unknown-host": legacyHistory(unknownHost),
        "malformed-url": legacyHistory(malformedUrl),
      }

      await chapterPersistenceService.migrateLegacyDownloadHistory()

      expect(mockStorageData.downloadedChapters).toEqual([
        expect.objectContaining({
          siteIntegrationId: "legacy:reader.example.net",
          chapterId: "chapter-unknown-host",
        }),
        expect.objectContaining({
          siteIntegrationId: "legacy-unresolved",
          chapterId: "chapter-malformed-url",
        }),
      ])
      expect(Object.keys(mockStorageData.seriesDownloadHistory)).toEqual([
        "legacy:reader.example.net#unknown-host",
        "legacy-unresolved#malformed-url",
      ])
    })

    it("is idempotent for mixed history after the first migration", async () => {
      const legacy = legacyRecord(
        "legacy-series",
        "https://mangadex.org/chapter/1"
      )
      const current: DownloadedChapterRecord = {
        siteIntegrationId: "pixiv-comic",
        ...legacyRecord(
          "current-series",
          "https://comic.pixiv.net/viewer/stories/1"
        ),
      }
      mockStorageData.downloadedChapters = [current, legacy]
      mockStorageData.seriesDownloadHistory = {
        "legacy-series": legacyHistory(legacy),
        "pixiv-comic#current-series": {
          siteIntegrationId: "pixiv-comic",
          seriesId: current.seriesId,
          seriesTitle: current.seriesTitle,
          lastUpdated: current.downloadedAt,
          downloadedChapters: [current],
        },
      }

      await expect(
        chapterPersistenceService.migrateLegacyDownloadHistory()
      ).resolves.toBe(true)
      vi.mocked(chrome.storage.local.set).mockClear()

      await expect(
        chapterPersistenceService.migrateLegacyDownloadHistory()
      ).resolves.toBe(false)
      expect(chrome.storage.local.set).not.toHaveBeenCalled()
      expect(mockStorageData.downloadedChapters).toHaveLength(2)
    })

    it("keeps migrated released records when a later download writes history", async () => {
      const legacy = legacyRecord(
        "legacy-series",
        "https://reader.example.net/chapter/1"
      )
      mockStorageData.downloadedChapters = [legacy]
      mockStorageData.seriesDownloadHistory = {
        "legacy-series": legacyHistory(legacy),
      }

      await chapterPersistenceService.migrateLegacyDownloadHistory()
      await chapterPersistenceService.markChapterAsDownloaded({
        siteIntegrationId: "mangadex",
        chapterId: "new-chapter",
        url: "https://mangadex.org/chapter/new-chapter",
        title: "New Chapter",
        seriesId: "new-series",
        seriesTitle: "New Series",
        downloadedAt: 200,
        format: "cbz",
      })

      expect(mockStorageData.downloadedChapters).toEqual([
        expect.objectContaining({
          siteIntegrationId: "legacy:reader.example.net",
          chapterId: legacy.chapterId,
        }),
        expect.objectContaining({
          siteIntegrationId: "mangadex",
          chapterId: "new-chapter",
        }),
      ])
      expect(Object.keys(mockStorageData.seriesDownloadHistory)).toEqual([
        "legacy:reader.example.net#legacy-series",
        "mangadex#new-series",
      ])
    })

    it("fails before writing when a stored entry matches neither schema", async () => {
      mockStorageData.downloadedChapters = [
        legacyRecord("valid", "https://mangadex.org/chapter/1"),
        { chapterId: "missing-required-fields" },
      ]
      const original = structuredClone(mockStorageData.downloadedChapters)

      await expect(
        chapterPersistenceService.migrateLegacyDownloadHistory()
      ).rejects.toThrow("Invalid downloaded chapter history entry")

      expect(chrome.storage.local.set).not.toHaveBeenCalled()
      expect(mockStorageData.downloadedChapters).toEqual(original)
    })
  })
}
