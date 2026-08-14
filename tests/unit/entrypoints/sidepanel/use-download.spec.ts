import { describe, expect, it } from "vitest"

import {
  buildStartDownloadMessage,
  resolveDownloadSeriesIdentity,
  resolveSelectedChapterStates,
} from "@/entrypoints/sidepanel/hooks/useDownload"
import type { ChapterState } from "@/src/types/tab-state"

function makeChapter(
  partial: Partial<ChapterState> & {
    url: string
    title: string
    index: number
    chapterLabel?: string
  }
): ChapterState {
  return {
    id: partial.id ?? partial.url,
    url: partial.url,
    title: partial.title,
    index: partial.index,
    status: partial.status ?? "queued",
    lastUpdated: partial.lastUpdated ?? Date.now(),
    chapterNumber: partial.chapterNumber,
    volumeLabel: partial.volumeLabel,
    volumeNumber: partial.volumeNumber,
    locked: partial.locked,
    errorMessage: partial.errorMessage,
    totalImages: partial.totalImages,
    imagesFailed: partial.imagesFailed,
    language: partial.language,
    chapterLabel: partial.chapterLabel,
  }
}

describe("resolveSelectedChapterStates", () => {
  const chapters: ChapterState[] = [
    makeChapter({ url: "u1", title: "One", index: 1 }),
    makeChapter({ url: "u2", title: "Two", index: 2 }),
    makeChapter({ url: "u3", title: "Three", index: 3 }),
  ]

  it("returns chapters matching the explicit side-panel selection urls", () => {
    const selected = resolveSelectedChapterStates(chapters, ["u1", "u3"])
    expect(selected.map((chapter) => chapter.url)).toEqual(["u1", "u3"])
  })

  it("returns an empty selection when no explicit side-panel urls are provided", () => {
    expect(resolveSelectedChapterStates(chapters, [])).toEqual([])
  })

  it("returns empty selection for empty chapter list", () => {
    expect(resolveSelectedChapterStates([], ["u1"])).toEqual([])
  })

  it("returns only chapters matching the explicit stable chapter ids when urls collide", () => {
    const duplicateUrl = "https://example.com/chapter/shared"
    const duplicateUrlChapters: ChapterState[] = [
      makeChapter({
        id: "chapter-a",
        url: duplicateUrl,
        title: "One",
        index: 1,
      }),
      makeChapter({
        id: "chapter-b",
        url: duplicateUrl,
        title: "Two",
        index: 2,
      }),
    ]

    expect(
      resolveSelectedChapterStates(duplicateUrlChapters, ["chapter-b"])
    ).toEqual([duplicateUrlChapters[1]])
  })
})

describe("resolveDownloadSeriesIdentity", () => {
  it("returns site and series ids from a MangaPageState context", () => {
    expect(
      resolveDownloadSeriesIdentity({
        sourceUrl: "https://mangadex.org/title/series-1",
        siteIntegrationId: "mangadex",
        mangaId: "series-1",
        seriesTitle: "Series 1",
        chapters: [],
        volumes: [],
        lastUpdated: 1,
      })
    ).toEqual({
      siteId: "mangadex",
      seriesId: "series-1",
    })
  })

  it("returns undefined identifiers when the active context is absent", () => {
    expect(resolveDownloadSeriesIdentity(undefined)).toEqual({
      siteId: undefined,
      seriesId: undefined,
    })
  })
})

describe("buildStartDownloadMessage", () => {
  it("sends only the source tab, current revision, and selected IDs", () => {
    const message = buildStartDownloadMessage({
      windowId: 11,
      tabId: 321,
      sourceUrl: "https://mangadex.org/title/series-1",
      siteIntegrationId: "mangadex",
      seriesId: "series-1",
      seriesRevision: 7,
      selectedChapterIds: ["chapter-1"],
    })

    expect(message).toEqual({
      target: "background",
      type: "START_DOWNLOAD",
      commandId: expect.any(String),
      issuedAt: expect.any(Number),
      payload: {
        sourceWindowId: 11,
        sourceTabId: 321,
        sourceUrl: "https://mangadex.org/title/series-1",
        siteIntegrationId: "mangadex",
        seriesId: "series-1",
        seriesRevision: 7,
        selectedChapterIds: ["chapter-1"],
      },
    })
  })

  it("preserves zero as a valid sourceTabId", () => {
    const message = buildStartDownloadMessage({
      windowId: 0,
      tabId: 0,
      sourceUrl: "https://mangadex.org/title/series-1",
      siteIntegrationId: "mangadex",
      seriesId: "series-1",
      seriesRevision: 0,
      selectedChapterIds: ["chapter-1"],
    })

    expect(message.payload.sourceTabId).toBe(0)
  })

  it("preserves selected ID order", () => {
    const message = buildStartDownloadMessage({
      windowId: 11,
      tabId: 321,
      sourceUrl: "https://mangadex.org/title/series-1",
      siteIntegrationId: "mangadex",
      seriesId: "series-1",
      seriesRevision: 2,
      selectedChapterIds: ["chapter-2", "chapter-1"],
    })

    expect(message.payload.selectedChapterIds).toEqual([
      "chapter-2",
      "chapter-1",
    ])
  })
})
