import { describe, expect, it, vi } from "vitest"
import { HistoryRepository } from "@/src/storage/history-repository"

describe("chapter history storage statistics", () => {
  it("reports empty bounds and then reflects committed chapters from multiple series", async () => {
    const storage: Record<string, unknown> = {}
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn(async () => structuredClone(storage)),
          set: vi.fn(async (values) => {
            Object.assign(storage, structuredClone(values))
          }),
        },
      },
    })
    const repository = new HistoryRepository()
    await expect(repository.getStorageStats()).resolves.toEqual({
      totalChapters: 0,
      totalSeries: 0,
      oldestDownload: null,
      newestDownload: null,
    })
    for (const [chapterId, seriesId, downloadedAt] of [
      ["1", "a", 200],
      ["2", "a", 100],
      ["1", "b", 300],
    ] as const) {
      await repository.markChapterAsDownloaded({
        siteIntegrationId: "mangadex",
        seriesId,
        chapterId,
        downloadedAt,
        url: `https://mangadex.org/chapter/${chapterId}`,
        title: chapterId,
        seriesTitle: seriesId,
        fileSize: 0,
        format: "zip",
      })
    }
    await expect(repository.getStorageStats()).resolves.toEqual({
      totalChapters: 3,
      totalSeries: 2,
      oldestDownload: 100,
      newestDownload: 300,
    })
  })
})
