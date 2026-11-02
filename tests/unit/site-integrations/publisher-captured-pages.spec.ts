// @vitest-environment happy-dom

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import capturedEpisode from "@/tests/fixtures/site-integrations/shonenjumpplus/captured-episode.json"
import capturedProducts from "@/tests/fixtures/site-integrations/shonenjumpplus/captured-products.json"
import capturedPagination from "@/tests/fixtures/site-integrations/shonenjumpplus/captured-pagination.json"
import {
  extractImageUrlsFromEpisodeJsonScript,
  readEpisodeJsonSeriesMetadataFromHtml,
} from "@/src/site-integrations/shonenjumpplus/episode-json"
import { isTrustedShonenJumpPlusAssetUrl } from "@/src/site-integrations/shonenjumpplus/urls"
import { fetchShonenJumpPlusChapterList } from "@/src/site-integrations/shonenjumpplus/series-api"
import { integrationHttpClient } from "@/src/site-integrations/http-client"
import {
  extractComicNettaiChapterListWithPagination,
  extractComicNettaiSeriesMetadataFromDocument,
} from "@/src/site-integrations/comictropics/series-dom"
import type { RateLimitService } from "@/src/runtime/rate-limit"

const rateLimitService = {} as RateLimitService

afterEach(() => vi.restoreAllMocks())

function comicPage(page: number): Document {
  return new DOMParser().parseFromString(
    readFileSync(
      resolve(
        `tests/fixtures/site-integrations/comictropics/series-page-${page}.html`
      ),
      "utf8"
    ),
    "text/html"
  )
}

describe("captured publisher pages", () => {
  it("paginates the guest Shonen Jump+ catalog with its access labels and episode identities", async () => {
    const offsets: number[] = []
    vi.spyOn(integrationHttpClient, "request").mockImplementation(
      async ({ url }) => {
        const parsed = new URL(url)
        if (
          parsed.pathname.endsWith("readable_product_pagination_information")
        ) {
          return Response.json(capturedPagination)
        }
        const offset = Number(parsed.searchParams.get("offset"))
        offsets.push(offset)
        return Response.json(capturedProducts.slice(offset, offset + 50))
      }
    )
    const result = await fetchShonenJumpPlusChapterList(
      "10834108156648240732",
      "10834108156648240735",
      rateLimitService
    )
    const chapters = Array.isArray(result) ? result : result.chapters

    expect(offsets).toEqual([0, 50, 100, 150])
    expect(chapters).toHaveLength(183)
    expect(
      chapters.filter((chapter) => chapter?.locked === false)
    ).toHaveLength(32)
    expect(chapters.filter((chapter) => chapter?.locked === true)).toHaveLength(
      151
    )
    expect(chapters.at(-1)).toMatchObject({
      id: "10834108156648240735",
      title: "1話",
      chapterNumber: 1,
      locked: false,
    })
  })

  it("reads the current Shonen Jump+ cover and all main episode pages", () => {
    const attribute = JSON.stringify(capturedEpisode).replaceAll('"', "&quot;")
    const html = `<script id="episode-json" data-value="${attribute}"></script>`
    const metadata = readEpisodeJsonSeriesMetadataFromHtml(html)

    expect(metadata.seriesTitle).toBe("SPY×FAMILY")
    expect(metadata.seriesId).toBe("10834108156648240732")
    expect(isTrustedShonenJumpPlusAssetUrl(metadata.seriesThumbnailUri!)).toBe(
      true
    )
    expect(extractImageUrlsFromEpisodeJsonScript(html)).toHaveLength(71)
  })

  it("collects the three COMIC熱帯 catalog pages and skips the hidden next control", async () => {
    const firstPage = comicPage(1)
    const loadDocument = vi.fn(async (url: string) => {
      const page = Number(new URL(url).searchParams.get("page") ?? 1)
      if (page > 3) throw new Error(`Unexpected catalog page ${page}`)
      return comicPage(page)
    })
    const result = await extractComicNettaiChapterListWithPagination(
      firstPage,
      "https://www.comicnettai.com/book/9",
      rateLimitService,
      loadDocument
    )
    const chapters = Array.isArray(result) ? result : result.chapters

    expect(
      extractComicNettaiSeriesMetadataFromDocument(firstPage)
    ).toMatchObject({
      title: "煙たい話",
      author: "林史也",
      language: "ja",
    })
    expect(loadDocument.mock.calls.map(([url]) => new URL(url).search)).toEqual(
      ["?page=2", "?page=3"]
    )
    expect(chapters).toHaveLength(51)
    expect(chapters.filter((chapter) => !chapter.locked)).toHaveLength(6)
    expect(chapters[0]).toMatchObject({
      id: "1033",
      title: "第49話",
      locked: false,
    })
    expect(chapters.at(-1)).toMatchObject({
      id: "97",
      title: "第1話",
      locked: false,
    })
  })
})
