// @vitest-environment happy-dom

import { readFileSync } from "node:fs"
import { afterEach, describe, expect, it, vi } from "vitest"
import { offscreenSiteAdapter } from "@/src/site-integrations/comictropics/offscreen-runtime"
import { integrationHttpClient } from "@/src/site-integrations/http-client"
import { RateLimitService } from "@/src/runtime/rate-limit"
import type { OffscreenIntegration } from "@/src/types/site-integrations"

const rateLimitService = new RateLimitService({
  resolveEffectivePolicy: async () => ({ concurrency: 1, delayMs: 0 }),
})
const seriesUrl = "https://www.comicnettai.com/book/9"
type SeriesInput = Parameters<
  NonNullable<OffscreenIntegration["series"]>["resolveSeriesData"]
>[0]

function resolveSeries(
  document: Document,
  options: Pick<SeriesInput, "language" | "signal"> = {}
) {
  const series = offscreenSiteAdapter.offscreen.series
  if (!series) throw new Error("The integration has no series resolver")
  return series.resolveSeriesData({
    requestId: "series-strategy-test",
    seriesUrl,
    html: "",
    document,
    rateLimitService,
    ...options,
  })
}

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html")
}

function catalog(page: number): string {
  return readFileSync(
    `tests/fixtures/site-integrations/comictropics/series-page-${page}.html`,
    "utf8"
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  rateLimitService.cleanupRateLimiters()
})

describe("Comic Nettai public offscreen series strategy", () => {
  it("resolves the fetched catalog DOM and all pagination before applying the requested language", async () => {
    const request = vi
      .spyOn(integrationHttpClient, "request")
      .mockImplementation(async ({ url }) => {
        const page = Number(new URL(url).searchParams.get("page"))
        if (page !== 2 && page !== 3)
          throw new Error(`Unexpected catalog URL: ${url}`)
        return new Response(catalog(page), {
          status: 200,
          headers: { "content-type": "text/html" },
        })
      })
    const result = await resolveSeries(parse(catalog(1)), { language: "ko" })
    expect(result.seriesMetadata).toMatchObject({
      title: "煙たい話",
      author: "林史也",
      language: "ko",
      publisher: "Kobunsha",
      imprint: "COMIC熱帯",
    })
    expect(result.metadataError).toBeUndefined()
    expect(result.chapterListError).toBeUndefined()
    const chapterList = result.chapterList
    const chapters = Array.isArray(chapterList)
      ? chapterList
      : chapterList?.chapters
    expect(chapters).toHaveLength(51)
    expect(chapters?.filter((chapter) => !chapter.locked)).toHaveLength(6)
    expect(chapters?.[0]).toMatchObject({
      id: "1033",
      title: "第49話",
      releaseDate: "2026-09-04",
    })
    expect(chapters?.at(-1)).toMatchObject({
      id: "97",
      title: "第1話",
      releaseDate: "2022-06-10",
    })
    expect(
      request.mock.calls.map(([input]) => new URL(input.url).search)
    ).toEqual(["?page=2", "?page=3"])
    for (const [input] of request.mock.calls) {
      expect(input).toMatchObject({
        integrationId: "comictropics",
        endpointId: "comictropics-viewer-page",
        init: { credentials: "include" },
      })
    }
  })

  it("preserves available chapters when the fetched page has no series metadata", async () => {
    const result = await resolveSeries(
      parse(
        '<a class="detail--product__item is-open" href="/publus/viewer.html?cid=one"><span class="detail--product__item__title">Chapter 1</span></a>'
      ),
      { language: "ko" }
    )
    expect(result.seriesMetadata).toBeUndefined()
    expect(result.metadataError).toBeTypeOf("string")
    expect(result.chapterListError).toBeUndefined()
    expect(result.chapterList).toMatchObject({
      chapters: [{ id: "one", title: "Chapter 1" }],
    })
  })

  it("preserves metadata and its default language when chapter data is invalid", async () => {
    const result = await resolveSeries(
      parse(
        '<h1 class="detail--title">Available series</h1><a class="detail--product__item is-open" href="https://attacker.example/viewer?cid=one"></a>'
      )
    )
    expect(result.seriesMetadata).toMatchObject({
      title: "Available series",
      language: "ja",
    })
    expect(result.metadataError).toBeUndefined()
    expect(result.chapterList).toBeUndefined()
    expect(result.chapterListError).toBeTypeOf("string")
  })

  it("retains metadata when cancellation prevents catalog pagination", async () => {
    const request = vi.spyOn(integrationHttpClient, "request")
    const controller = new AbortController()
    const cause = new Error("series request canceled")
    controller.abort(cause)
    const result = await resolveSeries(
      parse(
        '<h1 class="detail--title">Available series</h1><a href="?page=2">Next</a>'
      ),
      { signal: controller.signal }
    )
    expect(result.seriesMetadata).toMatchObject({
      title: "Available series",
      language: "ja",
    })
    expect(result.chapterList).toBeUndefined()
    expect(result.chapterListError).toBe(cause.message)
    expect(request).not.toHaveBeenCalled()
  })
})
