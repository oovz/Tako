import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  SeriesMetadataSchema,
  SeriesMetadataSnapshotSchema,
} from "@/src/runtime/series-data-schemas"
import { extractComicNettaiSeriesMetadataFromDocument } from "@/src/site-integrations/comicnettai/series-dom"
import { backgroundSiteAdapter as mangaMillionBackgroundAdapter } from "@/src/site-integrations/mangamillion/background-runtime"
import * as mangaMillionApi from "@/src/site-integrations/mangamillion/api"
import { readEpisodeJsonSeriesMetadataFromHtml } from "@/src/site-integrations/shonenjumpplus/episode-json"

vi.mock("@/src/site-integrations/mangamillion/api", () => ({
  fetchChapterList: vi.fn(),
  fetchTitleDetail: vi.fn(),
}))

const rateLimitService = {
  resolveEffectivePolicy: vi.fn(async () => ({ concurrency: 1, delayMs: 0 })),
  scheduleForIntegrationScope: vi.fn(
    async <T>(_integrationId: string, _scope: string, task: () => Promise<T>) =>
      task()
  ),
  cleanupRateLimiters: vi.fn(),
} as never

const nonPublicUrl = "https://127.0.0.1/cover.jpg"
const credentialedUrl = "https://user:password@provider.example/cover.jpg"
const validMangaMillionCoverUrl =
  "https://img.mangamillion.shueisha.co.jp/cover.jpg"
function encodeEpisodeJson(value: unknown): string {
  return JSON.stringify(value)
}

describe("provider cover admission", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("rejects unsafe stored metadata before it can be rehydrated", () => {
    for (const schema of [SeriesMetadataSchema, SeriesMetadataSnapshotSchema]) {
      const title = schema === SeriesMetadataSchema ? { title: "Test" } : {}
      expect(() => schema.parse({ ...title, coverUrl: nonPublicUrl })).toThrow()
      expect(() =>
        schema.parse({ ...title, coverUrl: credentialedUrl })
      ).toThrow()
      expect(() =>
        schema.parse({
          ...title,
          coverUrl: "http://provider.example/cover.jpg",
        })
      ).toThrow()
    }
  })

  it("rejects a non-public MangaMillion cover at the API resolver boundary", async () => {
    vi.mocked(mangaMillionApi.fetchTitleDetail).mockResolvedValue({
      serviceTitle: { serviceTitleName: "Test", coverUrl: nonPublicUrl },
    })
    vi.mocked(mangaMillionApi.fetchChapterList).mockResolvedValue({
      chapterGroups: [],
    })

    await expect(
      mangaMillionBackgroundAdapter.background.series!.resolveSeriesData({
        seriesUrl: "https://mangamillion.shueisha.co.jp/en/title/1",
        rateLimitService,
        siteIntegrationSettingsReader: {
          getAll: async () => ({}),
          getForSite: async () => ({}),
        },
      })
    ).rejects.toThrow("non-public")
  })

  it.each([credentialedUrl, "http://provider.example/cover.jpg", "not a URL"])(
    "rejects unsafe MangaMillion cover %s before metadata admission",
    async (coverUrl) => {
      vi.mocked(mangaMillionApi.fetchTitleDetail).mockResolvedValue({
        serviceTitle: { serviceTitleName: "Test", coverUrl },
      })
      vi.mocked(mangaMillionApi.fetchChapterList).mockResolvedValue({
        chapterGroups: [],
      })

      await expect(
        mangaMillionBackgroundAdapter.background.series!.resolveSeriesData({
          seriesUrl: "https://mangamillion.shueisha.co.jp/en/title/1",
          rateLimitService,
          siteIntegrationSettingsReader: {
            getAll: async () => ({}),
            getForSite: async () => ({}),
          },
        })
      ).rejects.toThrow()
    }
  )

  it("accepts a provider CDN cover at the MangaMillion API resolver boundary", async () => {
    vi.mocked(mangaMillionApi.fetchTitleDetail).mockResolvedValue({
      serviceTitle: {
        serviceTitleName: "Test",
        coverUrl: validMangaMillionCoverUrl,
      },
    })
    vi.mocked(mangaMillionApi.fetchChapterList).mockResolvedValue({
      chapterGroups: [],
    })

    await expect(
      mangaMillionBackgroundAdapter.background.series!.resolveSeriesData({
        seriesUrl: "https://mangamillion.shueisha.co.jp/en/title/1",
        rateLimitService,
        siteIntegrationSettingsReader: {
          getAll: async () => ({}),
          getForSite: async () => ({}),
        },
      })
    ).resolves.toMatchObject({
      seriesMetadata: { coverUrl: validMangaMillionCoverUrl },
    })
  })

  it("rejects a non-public Shonen Jump+ cover at the episode resolver boundary", () => {
    const html = `<script id="episode-json" data-value='${encodeEpisodeJson({
      readableProduct: {
        series: { title: "Test", thumbnailUri: nonPublicUrl },
      },
    })}'></script>`

    expect(() => readEpisodeJsonSeriesMetadataFromHtml(html)).toThrow(
      "non-public"
    )
  })

  it.each([credentialedUrl, "http://provider.example/cover.jpg", "not a URL"])(
    "rejects unsafe Shonen Jump+ cover %s before metadata admission",
    (coverUrl) => {
      const html = `<script id="episode-json" data-value='${encodeEpisodeJson({
        readableProduct: {
          series: { title: "Test", thumbnailUri: coverUrl },
        },
      })}'></script>`

      expect(() => readEpisodeJsonSeriesMetadataFromHtml(html)).toThrow()
    }
  )

  it("rejects a non-public Comic Nettai cover at the DOM resolver boundary", () => {
    const document = {
      querySelector(selector: string) {
        if (selector === ".detail--title") return { textContent: "Test" }
        if (selector === 'meta[property="og:image"]') {
          return { getAttribute: () => nonPublicUrl }
        }
        return null
      },
    }

    expect(() =>
      extractComicNettaiSeriesMetadataFromDocument(
        document as unknown as Document
      )
    ).toThrow("non-public")
  })

  it.each([credentialedUrl, "http://provider.example/cover.jpg", "not a URL"])(
    "rejects unsafe Comic Nettai cover %s before metadata admission",
    (coverUrl) => {
      const document = {
        querySelector(selector: string) {
          if (selector === ".detail--title") return { textContent: "Test" }
          if (selector === 'meta[property="og:image"]') {
            return { getAttribute: () => coverUrl }
          }
          return null
        },
      }

      expect(() =>
        extractComicNettaiSeriesMetadataFromDocument(
          document as unknown as Document
        )
      ).toThrow()
    }
  )

  it("accepts provider CDN covers without requiring page same-origin", () => {
    const document = {
      querySelector(selector: string) {
        if (selector === ".detail--title") return { textContent: "Test" }
        if (selector === 'meta[property="og:image"]') {
          return { getAttribute: () => "https://cdn.comicnettai.com/cover.jpg" }
        }
        return null
      },
    }

    expect(
      extractComicNettaiSeriesMetadataFromDocument(
        document as unknown as Document
      ).coverUrl
    ).toBe("https://cdn.comicnettai.com/cover.jpg")

    const episode = `<script id="episode-json" data-value='${encodeEpisodeJson({
      readableProduct: {
        series: {
          title: "Test",
          thumbnailUri:
            "https://cdn-ak-img.shonenjumpplus.com/series/cover.jpg",
        },
      },
    })}'></script>`
    expect(
      readEpisodeJsonSeriesMetadataFromHtml(episode).seriesThumbnailUri
    ).toBe("https://cdn-ak-img.shonenjumpplus.com/series/cover.jpg")
  })
})
