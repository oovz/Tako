import { beforeEach, describe, expect, it, vi } from "vitest"

import { HistoryDocumentError } from "@/src/domain/history/schema"
import type { DownloadedChapterRecord } from "@/src/domain/history/types"
import {
  HISTORY_STORAGE_KEYS,
  HistoryRepository,
} from "@/src/storage/history-repository"

const record: DownloadedChapterRecord = {
  siteIntegrationId: "mangadex",
  chapterId: "chapter-1",
  url: "https://example.test/chapter-1",
  title: "Chapter 1",
  seriesId: "series-1",
  seriesTitle: "Series",
  downloadedAt: 100,
  format: "cbz",
}

describe("HistoryRepository", () => {
  let historyRepository: HistoryRepository
  let storage: Record<string, unknown>
  let set: ReturnType<typeof vi.fn>

  beforeEach(() => {
    historyRepository = new HistoryRepository()
    storage = {}
    set = vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(storage, items)
    })
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn(async (keys: string[]) =>
            Object.fromEntries(
              keys
                .filter((key) => key in storage)
                .map((key) => [key, storage[key]])
            )
          ),
          set,
        },
      },
    })
    historyRepository.invalidateCache()
  })

  it("treats all three absent history keys as an empty aggregate", async () => {
    expect(await historyRepository.getAggregate()).toEqual({
      downloadedChapters: [],
      seriesDownloadHistory: {},
      clearCutoffs: { bySeries: {}, byChapter: {} },
    })
  })

  it("rejects partial history aggregates", async () => {
    storage.downloadedChapters = []
    await expect(historyRepository.getAggregate()).rejects.toBeInstanceOf(
      HistoryDocumentError
    )
  })

  it("rejects series history that diverges from downloaded chapters", async () => {
    storage.downloadedChapters = [record]
    storage.seriesDownloadHistory = {}
    storage.downloadHistoryClearCutoffs = { bySeries: {}, byChapter: {} }
    await expect(historyRepository.getAggregate()).rejects.toBeInstanceOf(
      HistoryDocumentError
    )
  })

  it("rejects a series entry whose chapter content differs", async () => {
    storage.downloadedChapters = [record]
    storage.seriesDownloadHistory = {
      "mangadex#series-1": {
        siteIntegrationId: "mangadex",
        seriesId: "series-1",
        seriesTitle: "Series",
        lastUpdated: 100,
        downloadedChapters: [{ ...record, title: "Changed" }],
      },
    }
    storage.downloadHistoryClearCutoffs = { bySeries: {}, byChapter: {} }
    await expect(historyRepository.getAggregate()).rejects.toBeInstanceOf(
      HistoryDocumentError
    )
  })

  it("persists all related history keys before updating its cache", async () => {
    await historyRepository.markChapterAsDownloaded(record)
    expect(set).toHaveBeenCalledTimes(1)
    expect(Object.keys(set.mock.calls[0]![0])).toEqual([
      "downloadedChapters",
      "seriesDownloadHistory",
      "downloadHistoryClearCutoffs",
    ])
    const loaded = await historyRepository.getDownloadedChapters()
    loaded[0]!.title = "mutated clone"
    expect((await historyRepository.getDownloadedChapters())[0]!.title).toBe(
      "Chapter 1"
    )
  })

  it("does not publish cache when the durable history write fails", async () => {
    set.mockRejectedValueOnce(new Error("history write failed"))
    await expect(
      historyRepository.markChapterAsDownloaded(record)
    ).rejects.toThrow("history write failed")
    expect(await historyRepository.getDownloadedChapters()).toEqual([])
  })

  it("serializes reads with mutations so a late read cannot republish stale state", async () => {
    let releaseRead!: () => void
    const get = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Record<string, unknown>>((resolve) => {
            releaseRead = () => resolve({})
          })
      )
      .mockImplementation(async (keys: string[]) =>
        Object.fromEntries(
          keys.filter((key) => key in storage).map((key) => [key, storage[key]])
        )
      )
    vi.stubGlobal("chrome", {
      storage: { local: { get, set } },
    })
    historyRepository.invalidateCache()

    const reading = historyRepository.getAggregate()
    const writing = historyRepository.markChapterAsDownloaded(record)
    await Promise.resolve()
    releaseRead()
    await reading
    await writing

    expect(await historyRepository.getDownloadedChapters()).toEqual([record])
  })

  it("does not republish an in-flight read after cache invalidation", async () => {
    await historyRepository.markChapterAsDownloaded(record)
    const staleStorage = structuredClone(storage)
    const secondRecord = {
      ...record,
      chapterId: "chapter-2",
      downloadedAt: 200,
    }
    await new HistoryRepository().markChapterAsDownloaded(secondRecord)

    let releaseRead!: () => void
    const get = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Record<string, unknown>>((resolve) => {
            releaseRead = () => resolve(staleStorage)
          })
      )
      .mockImplementation(async (keys: string[]) =>
        Object.fromEntries(
          keys.filter((key) => key in storage).map((key) => [key, storage[key]])
        )
      )
    vi.stubGlobal("chrome", {
      storage: { local: { get, set } },
    })
    historyRepository.invalidateCache()

    const reading = historyRepository.getAggregate()
    await vi.waitFor(() => expect(get).toHaveBeenCalledOnce())
    historyRepository.invalidateCache()
    releaseRead()

    await expect(reading).resolves.toEqual({
      downloadedChapters: [record, secondRecord],
      seriesDownloadHistory: expect.any(Object),
      clearCutoffs: { bySeries: {}, byChapter: {} },
    })
    expect(
      (await historyRepository.getDownloadedChapters()).map(
        (item) => item.chapterId
      )
    ).toEqual(["chapter-1", "chapter-2"])
  })

  it("authoritative history queries read committed storage before the change listener runs", async () => {
    await historyRepository.markChapterAsDownloaded(record)
    const secondRecord = {
      ...record,
      chapterId: "chapter-2",
      downloadedAt: 200,
    }
    await new HistoryRepository().markChapterAsDownloaded(secondRecord)

    const chapters = await historyRepository.getDownloadedChapters()

    expect(chapters.map((item) => item.chapterId)).toEqual([
      "chapter-1",
      "chapter-2",
    ])
    expect(storage[HISTORY_STORAGE_KEYS.downloadedChapters]).toEqual([
      record,
      secondRecord,
    ])
  })
})
