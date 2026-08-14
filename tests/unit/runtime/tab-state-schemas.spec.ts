import { describe, expect, it } from "vitest"

import {
  ActiveTabContextByWindowSchema,
  ChapterStateSchema,
  MangaPageStateSchema,
  ProjectedTabContextSchema,
  isActiveTabContextByWindow,
  isMangaPageState,
  parseActiveTabContextByWindow,
  parseMangaPageState,
} from "@/src/runtime/tab-state-schemas"

const validMangaPageState = {
  sourceUrl: "https://mangadex.org/title/series-1",
  siteIntegrationId: "mangadex",
  mangaId: "series-1",
  seriesTitle: "Series 1",
  chapters: [
    {
      id: "chapter-1",
      url: "https://mangadex.org/chapter/chapter-1",
      title: "Chapter 1",
      locked: false,
      index: 0,
      status: "queued" as const,
      totalImages: 0,
      imagesFailed: 0,
      lastUpdated: 1,
    },
  ],
  volumes: [{ id: "volume-1", title: "Volume 1" }],
  metadata: {
    author: "Author",
    genres: ["Adventure"],
    year: 2024,
  },
  chaptersLoading: false,
  chapterListNotice: "adult-consent-required" as const,
  lastUpdated: 1,
}

describe("tab state schemas", () => {
  it("accepts the exact current tab state and per-window projection", () => {
    expect(MangaPageStateSchema.parse(validMangaPageState)).toEqual(
      validMangaPageState
    )
    expect(
      ActiveTabContextByWindowSchema.parse({
        7: {
          windowId: 7,
          activeTabId: 11,
          context: validMangaPageState,
          revision: 3,
          timestamp: 4,
        },
      })
    ).toEqual({
      7: {
        windowId: 7,
        activeTabId: 11,
        context: validMangaPageState,
        revision: 3,
        timestamp: 4,
      },
    })
    expect(parseMangaPageState(validMangaPageState)).toEqual(
      validMangaPageState
    )
    expect(isMangaPageState(validMangaPageState)).toBe(true)
    expect(
      isActiveTabContextByWindow({
        7: {
          windowId: 7,
          activeTabId: 11,
          context: validMangaPageState,
          revision: 3,
          timestamp: 4,
        },
      })
    ).toBe(true)
  })

  it.each([
    ["missing source URL", { ...validMangaPageState, sourceUrl: undefined }],
    ["empty provider", { ...validMangaPageState, siteIntegrationId: "" }],
    ["empty series", { ...validMangaPageState, mangaId: "" }],
    ["empty title", { ...validMangaPageState, seriesTitle: "" }],
    ["unknown root field", { ...validMangaPageState, untrusted: "unexpected" }],
    [
      "unknown nested chapter field",
      {
        ...validMangaPageState,
        chapters: [
          { ...validMangaPageState.chapters[0], untrusted: "unexpected" },
        ],
      },
    ],
    [
      "malformed chapter URL",
      {
        ...validMangaPageState,
        chapters: [{ ...validMangaPageState.chapters[0], url: "" }],
      },
    ],
    [
      "invalid chapter status",
      {
        ...validMangaPageState,
        chapters: [{ ...validMangaPageState.chapters[0], status: "pending" }],
      },
    ],
    [
      "invalid locked flag",
      {
        ...validMangaPageState,
        chapters: [{ ...validMangaPageState.chapters[0], locked: "false" }],
      },
    ],
    [
      "fractional index",
      {
        ...validMangaPageState,
        chapters: [{ ...validMangaPageState.chapters[0], index: 0.5 }],
      },
    ],
    [
      "negative image count",
      {
        ...validMangaPageState,
        chapters: [{ ...validMangaPageState.chapters[0], totalImages: -1 }],
      },
    ],
    ["non-finite timestamp", { ...validMangaPageState, lastUpdated: NaN }],
    [
      "unknown metadata field",
      {
        ...validMangaPageState,
        metadata: { ...validMangaPageState.metadata, title: "duplicate" },
      },
    ],
    [
      "duplicate chapter IDs",
      {
        ...validMangaPageState,
        chapters: [
          validMangaPageState.chapters[0],
          {
            ...validMangaPageState.chapters[0],
            url: "https://mangadex.org/chapter/duplicate",
          },
        ],
      },
    ],
  ])("rejects %s", (_label, value) => {
    expect(MangaPageStateSchema.safeParse(value).success).toBe(false)
    expect(parseMangaPageState(value)).toBeUndefined()
    expect(isMangaPageState(value)).toBe(false)
  })

  it("rejects malformed projected loading and error states", () => {
    expect(
      ProjectedTabContextSchema.safeParse({ loading: true, error: "extra" })
        .success
    ).toBe(false)
    expect(
      ProjectedTabContextSchema.safeParse({ loading: false }).success
    ).toBe(false)
    expect(ProjectedTabContextSchema.safeParse({ error: "" }).success).toBe(
      false
    )
  })

  it.each([
    ["negative window id", "-1", -1, 11, 0, 0],
    ["fractional active tab id", "7", 7, 1.5, 0, 0],
    ["negative revision", "7", 7, 11, -1, 0],
    ["fractional timestamp", "7", 7, 11, 0, 0.5],
    ["map key mismatch", "8", 7, 11, 0, 0],
  ])(
    "rejects %s in the per-window map",
    (_label, key, windowId, activeTabId, revision, timestamp) => {
      const value = {
        [key]: {
          windowId,
          activeTabId,
          context: null,
          revision,
          timestamp,
        },
      }
      expect(ActiveTabContextByWindowSchema.safeParse(value).success).toBe(
        false
      )
      expect(parseActiveTabContextByWindow(value)).toBeUndefined()
      expect(isActiveTabContextByWindow(value)).toBe(false)
    }
  )

  it("rejects malformed chapter fields directly", () => {
    expect(
      ChapterStateSchema.safeParse({
        ...validMangaPageState.chapters[0],
        id: "",
      }).success
    ).toBe(false)
  })
})
