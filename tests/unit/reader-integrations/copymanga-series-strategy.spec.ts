// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { offscreenSiteAdapter } from "@/src/site-integrations/copymanga/offscreen-runtime"
import type { RateLimitService } from "@/src/runtime/rate-limit"
import contract from "@/tests/fixtures/site-integrations/copymanga/contract.json"

const rateLimitService = {
  scheduleForIntegrationScope: async <T>(
    _id: string,
    _scope: string,
    operation: () => Promise<T>
  ) => operation(),
} as unknown as RateLimitService

function inputFor(content: string) {
  const html = `${content}<span id="dnt" value="9"></span><script>var ccz='${contract.data.key}';</script>`
  return {
    requestId: "copy-series",
    seriesUrl: "https://www.copy4000.com/comic/yiquanchaoren",
    html,
    document: new DOMParser().parseFromString(html, "text/html"),
    rateLimitService,
  }
}
const resolve = (content: string) =>
  offscreenSiteAdapter.offscreen.series!.resolveSeriesData(inputFor(content))
const title = '<div class="comicParticulars-title"><h6>Work</h6></div>'

function catalogResponse(url: string, value: unknown = contract.data.catalog) {
  const response = Response.json(value)
  Object.defineProperty(response, "url", { value: url })
  return response
}

afterEach(() => vi.unstubAllGlobals())

describe("Copy series strategy metadata and catalog boundary", () => {
  it.each([
    [
      '<img src="https://sd.mangafunb.fun/cover.jpg">',
      "https://sd.mangafunb.fun/cover.jpg",
    ],
    ['<img data-src="" src="https://sd.mangafunb.fun/cover.jpg">', undefined],
    ["", undefined],
  ])(
    "resolves the cover from %s with optional metadata absent",
    async (image, expected) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => catalogResponse(url))
      )
      const result = await resolve(
        `${title}<div class="comicParticulars-left-img">${image}</div>`
      )
      expect(result.seriesMetadata).toMatchObject({
        title: "Work",
        language: "zh",
      })
      expect(result.seriesMetadata?.coverUrl).toBe(expected)
      expect(result.seriesMetadata?.description).toBeUndefined()
      expect(result.seriesMetadata?.author).toBe("")
      expect(result.seriesMetadata?.genres).toEqual([])
      const chapters = Array.isArray(result.chapterList)
        ? result.chapterList
        : result.chapterList?.chapters
      expect(chapters).toHaveLength(490)
    }
  )

  it("rejects a missing title before requesting the catalog", async () => {
    const fetcher = vi.fn()
    vi.stubGlobal("fetch", fetcher)
    await expect(resolve("<h1>Unrelated title</h1>")).rejects.toThrow(
      /metadata/
    )
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("validates the cover origin before requesting the catalog", async () => {
    const fetcher = vi.fn()
    vi.stubGlobal("fetch", fetcher)
    await expect(
      resolve(
        `${title}<div class="comicParticulars-left-img"><img data-src="https://outside.example/cover.jpg"></div>`
      )
    ).rejects.toThrow(/origin/)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("rejects a successful catalog response without encrypted results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => catalogResponse(url, { code: 200 }))
    )
    await expect(resolve(title)).rejects.toThrow(/catalog is unavailable/)
  })

  it("releases an unsuccessful catalog response and preserves its status", async () => {
    const cancel = vi.fn()
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("unavailable"))
        },
        cancel,
      }),
      { status: 503, headers: { "content-type": "application/json" } }
    )
    Object.defineProperty(response, "url", {
      value: "https://www.copy4000.com/comicdetail/yiquanchaoren/chapters",
    })
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response)
    )
    await expect(resolve(title)).rejects.toMatchObject({ status: 503 })
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce())
  })
})
