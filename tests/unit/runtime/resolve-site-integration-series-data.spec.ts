import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getBackgroundSiteAdapterById: vi.fn(),
  fetchSeriesMetadata: vi.fn(),
  fetchChapterList: vi.fn(),
}))

vi.mock("@/src/runtime/background-site-integration-initialization", () => ({
  getBackgroundSiteAdapterById: mocks.getBackgroundSiteAdapterById,
}))

import { resolveSiteIntegrationSeriesData } from "@/src/runtime/resolve-site-integration-series-data"

describe("resolveSiteIntegrationSeriesData", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getBackgroundSiteAdapterById.mockResolvedValue({
      background: {
        series: {
          fetchSeriesMetadata: mocks.fetchSeriesMetadata,
          fetchChapterList: mocks.fetchChapterList,
        },
      },
    })
  })

  it("starts metadata and chapter requests together and emits metadata while chapters are pending", async () => {
    let resolveMetadata:
      ((value: { title: string; authors: string[] }) => void) | undefined
    let resolveChapters:
      ((value: { chapters: never[]; volumes: never[] }) => void) | undefined
    mocks.fetchSeriesMetadata.mockReturnValue(
      new Promise((resolve) => {
        resolveMetadata = resolve
      })
    )
    mocks.fetchChapterList.mockReturnValue(
      new Promise((resolve) => {
        resolveChapters = resolve
      })
    )
    const onPartial = vi.fn(async () => undefined)

    const resolution = resolveSiteIntegrationSeriesData({
      siteIntegrationId: "generic-site",
      seriesId: "series-1",
      onPartial,
    })

    await vi.waitFor(() => {
      expect(mocks.fetchSeriesMetadata).toHaveBeenCalledOnce()
      expect(mocks.fetchChapterList).toHaveBeenCalledOnce()
    })
    resolveMetadata?.({ title: "Series", authors: [] })
    await vi.waitFor(() =>
      expect(onPartial).toHaveBeenCalledWith({
        seriesId: "series-1",
        seriesMetadata: { title: "Series", authors: [] },
        chaptersLoading: true,
      })
    )

    resolveChapters?.({ chapters: [], volumes: [] })
    await expect(resolution).resolves.toMatchObject({
      seriesId: "series-1",
      seriesMetadata: { title: "Series", authors: [] },
      chapterList: { chapters: [], volumes: [] },
    })
  })

  it("returns chapter data when metadata fails", async () => {
    mocks.fetchSeriesMetadata.mockRejectedValue(new Error("metadata failed"))
    mocks.fetchChapterList.mockResolvedValue({
      chapters: [],
      volumes: [],
    })

    await expect(
      resolveSiteIntegrationSeriesData({
        siteIntegrationId: "generic-site",
        seriesId: "series-1",
      })
    ).resolves.toMatchObject({
      seriesId: "series-1",
      chapterList: { chapters: [], volumes: [] },
      metadataError: "metadata failed",
    })
  })

  it("returns metadata and its partial result when chapters fail", async () => {
    mocks.fetchSeriesMetadata.mockResolvedValue({
      title: "Series",
      authors: [],
    })
    let rejectChapters: ((reason: Error) => void) | undefined
    mocks.fetchChapterList.mockReturnValue(
      new Promise((_, reject) => {
        rejectChapters = reject
      })
    )
    const onPartial = vi.fn(async () => undefined)

    const resolution = resolveSiteIntegrationSeriesData({
      siteIntegrationId: "generic-site",
      seriesId: "series-1",
      onPartial,
    })
    await vi.waitFor(() => expect(onPartial).toHaveBeenCalledOnce())
    rejectChapters?.(new Error("chapters failed"))

    await expect(resolution).resolves.toMatchObject({
      seriesId: "series-1",
      seriesMetadata: { title: "Series", authors: [] },
      chapterListError: "chapters failed",
    })
  })
})
