import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  fetchMangadexSeriesMetadata: vi.fn(),
  fetchMangadexChapterList: vi.fn(),
}))

vi.mock("@/src/site-integrations/mangadex/series-api", () => ({
  fetchMangadexSeriesMetadata: mocks.fetchMangadexSeriesMetadata,
  fetchMangadexChapterList: mocks.fetchMangadexChapterList,
}))

import { backgroundSiteAdapter } from "@/src/site-integrations/mangadex/background-runtime"

function resolveMangadexSeriesData() {
  const resolver = backgroundSiteAdapter.background.series?.resolveSeriesData
  if (!resolver) {
    throw new Error("Expected MangaDex to expose a series resolver")
  }
  return resolver
}

describe("MangaDex background series resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("starts metadata and chapter requests together and emits metadata while chapters are pending", async () => {
    let resolveMetadata:
      ((value: { title: string; authors: string[] }) => void) | undefined
    let resolveChapters:
      ((value: { chapters: never[]; volumes: never[] }) => void) | undefined
    mocks.fetchMangadexSeriesMetadata.mockReturnValue(
      new Promise((resolve) => {
        resolveMetadata = resolve
      })
    )
    mocks.fetchMangadexChapterList.mockReturnValue(
      new Promise((resolve) => {
        resolveChapters = resolve
      })
    )
    const onPartial = vi.fn(async () => undefined)

    const resolution = resolveMangadexSeriesData()({
      seriesUrl:
        "https://mangadex.org/title/db692d58-4b13-4174-942a-837e532011a6",
      language: "en",
      onPartial,
    })

    await vi.waitFor(() => {
      expect(mocks.fetchMangadexSeriesMetadata).toHaveBeenCalledOnce()
      expect(mocks.fetchMangadexChapterList).toHaveBeenCalledOnce()
    })
    expect(mocks.fetchMangadexChapterList).toHaveBeenCalledWith(
      "db692d58-4b13-4174-942a-837e532011a6",
      "en",
      undefined,
      "interactive"
    )

    resolveMetadata?.({ title: "MangaDex Series", authors: [] })
    await vi.waitFor(() => expect(onPartial).toHaveBeenCalledOnce())
    resolveChapters?.({ chapters: [], volumes: [] })

    await expect(resolution).resolves.toMatchObject({
      seriesId: "db692d58-4b13-4174-942a-837e532011a6",
      seriesMetadata: { title: "MangaDex Series", authors: [] },
      chapterList: { chapters: [], volumes: [] },
    })
  })

  it("keeps chapter and metadata failures independent", async () => {
    mocks.fetchMangadexSeriesMetadata.mockRejectedValue(
      new Error("metadata failed")
    )
    mocks.fetchMangadexChapterList.mockResolvedValue({
      chapters: [],
      volumes: [],
    })

    await expect(
      resolveMangadexSeriesData()({
        seriesUrl:
          "https://mangadex.org/title/db692d58-4b13-4174-942a-837e532011a6",
      })
    ).resolves.toMatchObject({
      chapterList: { chapters: [], volumes: [] },
      metadataError: "metadata failed",
    })

    mocks.fetchMangadexSeriesMetadata.mockResolvedValue({
      title: "MangaDex Series",
      authors: [],
    })
    mocks.fetchMangadexChapterList.mockRejectedValue(
      new Error("chapters failed")
    )

    await expect(
      resolveMangadexSeriesData()({
        seriesUrl:
          "https://mangadex.org/title/db692d58-4b13-4174-942a-837e532011a6",
      })
    ).resolves.toMatchObject({
      seriesMetadata: { title: "MangaDex Series", authors: [] },
      chapterListError: "chapters failed",
    })
  })
})
