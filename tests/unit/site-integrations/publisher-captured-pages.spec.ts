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

import type { RateLimitService } from "@/src/runtime/rate-limit"

const rateLimitService = {} as RateLimitService

afterEach(() => vi.restoreAllMocks())

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
})
