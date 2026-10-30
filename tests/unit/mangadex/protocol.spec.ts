import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  fetchAtHomeServer,
  fetchChapterFeed,
  fetchMangaMetadata,
  fetchMangaStatistics,
  fetchWithMangadexRetry,
} from "@/src/site-integrations/mangadex/api"
import {
  fetchMangadexChapterList,
  fetchMangadexSeriesMetadata,
} from "@/src/site-integrations/mangadex/series-api"
import { parseMangadexImageDeliveryTarget } from "@/src/site-integrations/mangadex/image-delivery"
import { ProviderContractError } from "@/src/site-integrations/provider-contract-error"
import type { RateLimitService } from "@/src/runtime/rate-limit"

vi.mock("@/src/runtime/logger", () => ({
  default: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const schedule = vi.fn(
  async <T>(_id: string, _scope: string, task: () => Promise<T>) => task()
)
const rateLimitService = {
  scheduleForIntegrationScope: schedule,
} as unknown as RateLimitService
const settingsReader = {
  getAll: vi.fn(async () => ({})),
  getForSite: vi.fn(async () => ({})),
}
const fetchMock = vi.fn<typeof fetch>()

function response(url: string, body: unknown, status = 200): Response {
  const result = new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
  Object.defineProperty(result, "url", { value: url })
  return result
}

function manga(attributes: Record<string, unknown>) {
  return {
    result: "ok",
    data: { id: "series", type: "manga", attributes, relationships: [] },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal("fetch", fetchMock)
  settingsReader.getAll.mockResolvedValue({})
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("MangaDex API through the endpoint HTTP boundary", () => {
  it("uses chapter scheduling and omit credentials for all typed API responses", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      const path = new URL(url).pathname
      if (path.startsWith("/statistics/"))
        return response(url, { statistics: {} })
      if (path.startsWith("/at-home/"))
        return response(url, {
          baseUrl: "https://node.example",
          chapter: { hash: "hash", data: [], dataSaver: [] },
        })
      if (path.endsWith("/feed"))
        return response(url, {
          result: "ok",
          data: [],
          total: 0,
          offset: 0,
          limit: 500,
        })
      return response(url, manga({ title: { en: "Title" } }))
    })
    await fetchMangaMetadata("series", rateLimitService, "interactive")
    await fetchMangaStatistics("series", rateLimitService, "interactive")
    await fetchChapterFeed(
      "series",
      rateLimitService,
      {},
      0,
      500,
      "interactive"
    )
    await fetchAtHomeServer("chapter", rateLimitService)
    expect(schedule).toHaveBeenCalledTimes(4)
    expect(
      schedule.mock.calls.every(
        ([id, scope]) => id === "mangadex" && scope === "chapter"
      )
    ).toBe(true)
    for (const [, init] of fetchMock.mock.calls)
      expect(init).toMatchObject({ credentials: "omit", redirect: "error" })
  })

  it("keeps malformed JSON and malformed response shapes distinct", async () => {
    fetchMock.mockImplementationOnce(async (input) => {
      const result = new Response("{", {
        headers: { "content-type": "application/json" },
      })
      Object.defineProperty(result, "url", { value: String(input) })
      return result
    })
    await expect(
      fetchMangaMetadata("series", rateLimitService, "interactive")
    ).rejects.toMatchObject({ status: 200 })
    fetchMock.mockImplementationOnce(async (input) =>
      response(String(input), { result: "ok", data: {} })
    )
    await expect(
      fetchMangaMetadata("series", rateLimitService, "interactive")
    ).rejects.toBeInstanceOf(ProviderContractError)
  })

  it("releases a rejected response body and preserves the HTTP status", async () => {
    const cancel = vi.fn()
    fetchMock.mockImplementationOnce(async (input) => {
      const result = new Response(new ReadableStream({ cancel }), {
        status: 403,
      })
      Object.defineProperty(result, "url", { value: String(input) })
      return result
    })
    await expect(
      fetchMangaMetadata("series", rateLimitService, "interactive")
    ).rejects.toMatchObject({ status: 403 })
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce())
  })

  it("cancels a provider retry wait without sending another request", async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    fetchMock.mockRejectedValue(new TypeError("network offline"))
    const pending = fetchMangaMetadata(
      "series",
      rateLimitService,
      "resilient",
      controller.signal
    )
    const rejected = expect(pending).rejects.toThrow("aborted")
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    await rejected
    await vi.advanceTimersByTimeAsync(10000)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("shares one retry budget between network failures and HTTP rate limits", async () => {
    vi.useFakeTimers()
    fetchMock.mockRejectedValueOnce(new TypeError("network offline"))
    fetchMock.mockImplementation(async (input) =>
      response(String(input), {}, 429)
    )
    const pending = fetchMangaMetadata("series", rateLimitService)
    const rejected = expect(pending).rejects.toMatchObject({ status: 429 })
    await vi.advanceTimersByTimeAsync(20000)
    await rejected
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it("leaves transient image-host HTTP responses to image recovery without adding scheduling", async () => {
    fetchMock.mockImplementation(async (input) =>
      response(String(input), {}, 503)
    )
    const result = await fetchWithMangadexRetry(
      "https://node.example/data/hash/1.jpg",
      rateLimitService
    )
    expect(result.status).toBe(503)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(schedule).not.toHaveBeenCalled()
    await result.body?.cancel()
  })
})

describe("MangaDex series projection", () => {
  it.each([
    [{ en: "English", "ja-ro": "Romaji" }, undefined, "English"],
    [{ "ja-ro": "Romaji", ja: "Japanese" }, undefined, "Romaji"],
    [{ ja: "Japanese" }, undefined, "Japanese"],
    [
      {},
      [{ ja: "Alternative" }, { en: "Alternative English" }],
      "Alternative English",
    ],
    [{}, [{ ja: "Alternative" }], "Alternative"],
    [{}, [{}], "Unknown Title"],
  ])(
    "selects a title from the available metadata languages",
    async (title, altTitles, expected) => {
      fetchMock.mockImplementation(async (input) => {
        const url = String(input)
        return response(
          url,
          new URL(url).pathname.startsWith("/statistics/")
            ? {}
            : manga({ title, altTitles })
        )
      })
      await expect(
        fetchMangadexSeriesMetadata("series", rateLimitService, "interactive")
      ).resolves.toMatchObject({ title: expected })
    }
  )

  it("retains first chapter identity and orders numeric volumes before their original occurrence ties", async () => {
    const entries = [
      { id: "second", volume: "2", chapter: "1.5", title: "" },
      { id: "first", volume: "1", chapter: "invalid", title: null },
      { id: "special", volume: "Special", chapter: null, title: null },
      { id: "again", volume: "2", chapter: "3", title: "Extra" },
      { id: "second", volume: "1", chapter: "9", title: "Duplicate" },
      { id: "external", externalUrl: "https://other.example/chapter" },
      { id: "empty", pages: 0 },
      { id: "missing-language", translatedLanguage: "" },
    ].map((entry) => ({
      id: entry.id,
      type: "chapter",
      attributes: { translatedLanguage: "en", pages: 2, ...entry },
    }))
    fetchMock.mockImplementation(async (input) =>
      response(String(input), {
        result: "ok",
        data: entries,
        total: 600,
        offset: 0,
        limit: 500,
      })
    )
    const result = await fetchMangadexChapterList(
      "series",
      rateLimitService,
      undefined,
      undefined,
      "interactive",
      undefined,
      settingsReader
    )
    if (Array.isArray(result)) {
      throw new Error("Expected the MangaDex paginated chapter result")
    }
    expect(result.chapters.map((entry) => entry.id)).toEqual([
      "second",
      "first",
      "special",
      "again",
    ])
    expect(result.chapters[0]).toMatchObject({
      title: "Chapter 1.5",
      chapterNumber: 1.5,
      chapterLabel: "1.5",
    })
    expect(result.chapters[1].chapterNumber).toBeUndefined()
    expect(result.chapters[2]).toMatchObject({
      title: "Chapter special",
      volumeLabel: "Vol. Special",
    })
    expect(result.volumes?.map((entry) => entry.id)).toEqual([
      "mangadex-volume-1",
      "mangadex-volume-2",
      "mangadex-volume-special",
    ])
    expect(result.truncated).toBe(true)
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})

describe("MangaDex image delivery parsing", () => {
  it.each([
    [
      "https://node.example/proxy/data/hash/page.jpg",
      {
        baseUrl: "https://node.example/proxy",
        quality: "data",
        filename: "page.jpg",
      },
    ],
    [
      "https://node.example/data-saver/hash/page.jpg",
      {
        baseUrl: "https://node.example",
        quality: "data-saver",
        filename: "page.jpg",
      },
    ],
    ["https://node.example/cover.jpg", null],
    ["https://node.example/data/hash", null],
  ])("identifies recoverable image paths", (url, expected) => {
    expect(parseMangadexImageDeliveryTarget(url)).toEqual(expected)
  })
})
