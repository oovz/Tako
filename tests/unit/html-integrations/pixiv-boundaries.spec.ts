import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { integrationHttpClient } from "@/src/site-integrations/http-client"
import { backgroundSiteAdapter } from "@/src/site-integrations/pixiv-comic/background-runtime"
import { resolvePixivChapterImageUrls } from "@/src/site-integrations/pixiv-comic/chapter-api"
import {
  fetchPixivChapterList,
  fetchPixivSeriesMetadata,
} from "@/src/site-integrations/pixiv-comic/series-api"
import { cachePixivBuildId } from "@/src/site-integrations/pixiv-comic/shared"
import type { RateLimitService } from "@/src/runtime/rate-limit"

vi.mock("@/src/site-integrations/http-client", () => ({
  integrationHttpClient: { request: vi.fn() },
}))
vi.mock("@/src/runtime/logger", () => ({
  default: { debug: vi.fn(), error: vi.fn() },
}))
const rateLimitService = {} as RateLimitService
const chapter = { id: "123", url: "https://comic.pixiv.net/viewer/stories/123" }
const source = "https://img-comic.pximg.net/page.jpg"
const seriesInput = {
  seriesUrl: "https://comic.pixiv.net/works/1",
  rateLimitService,
  siteIntegrationSettingsReader: {
    getAll: async () => ({}),
    getForSite: async () => ({}),
  },
}
const resolveSeries = () =>
  backgroundSiteAdapter.background.series!.resolveSeriesData(seriesInput)

beforeEach(() => {
  vi.mocked(integrationHttpClient.request).mockReset()
})
afterEach(() => vi.unstubAllGlobals())

describe("Pixiv catalog boundaries", () => {
  it.each([
    [{ main: source }, source],
    [{ thumbnail: source }, source],
    [{}, undefined],
    [undefined, undefined],
  ])("selects the available cover variant", async (image, expected) => {
    vi.mocked(integrationHttpClient.request).mockResolvedValueOnce(
      Response.json({ data: { official_work: { name: "Work", image } } })
    )
    expect(
      (await fetchPixivSeriesMetadata("1", rateLimitService)).coverUrl
    ).toBe(expected)
  })

  it("preserves successful chapters when metadata fails", async () => {
    vi.mocked(integrationHttpClient.request).mockImplementation(
      async ({ url }) => {
        if (url.includes("works/v5")) throw new Error("metadata unavailable")
        return Response.json({
          data: { episodes: [{ state: "readable", episode: { id: 2 } }] },
        })
      }
    )
    expect(await resolveSeries()).toMatchObject({
      seriesId: "1",
      metadataError: "metadata unavailable",
      chapterList: {
        chapters: [{ id: "2", title: "Chapter 2", locked: false }],
      },
    })
  })

  it("preserves successful metadata when chapter retrieval fails", async () => {
    vi.mocked(integrationHttpClient.request).mockImplementation(
      async ({ url }) => {
        if (url.includes("episodes/v2")) throw "chapters unavailable"
        return Response.json({ data: { official_work: { name: "Work" } } })
      }
    )
    expect(await resolveSeries()).toMatchObject({
      seriesMetadata: { title: "Work" },
      chapterListError: "chapters unavailable",
    })
  })

  it("canonicalizes viewer routes that refer to another chapter or origin", async () => {
    vi.mocked(integrationHttpClient.request).mockResolvedValueOnce(
      Response.json({
        data: {
          episodes: [
            {
              episode: {
                id: 1,
                viewer_path: "https://attacker.example/viewer/stories/1",
              },
            },
            { episode: { id: 2, viewer_path: "/viewer/stories/99" } },
            { episode: { id: 3, viewer_path: "/episodes/3" } },
          ],
        },
      })
    )
    expect(await fetchPixivChapterList("1", rateLimitService)).toMatchObject({
      chapters: [
        { url: "https://comic.pixiv.net/viewer/stories/1", locked: true },
        { url: "https://comic.pixiv.net/viewer/stories/2", locked: true },
        { url: "https://comic.pixiv.net/episodes/3", locked: true },
      ],
    })
  })
})

describe("Pixiv reader responses", () => {
  it.each([
    { pages: [{ src: source }] },
    { reading_episode: { pages: [{ image_url: source }] } },
    { data: { pages: [{ url: source }] } },
    { data: { reading_episode: { pages: [{ url: source }] } } },
    {},
  ])(
    "accepts a supported page envelope or bootstrap fallback",
    async (payload) => {
      cachePixivBuildId("envelope", "build")
      vi.mocked(integrationHttpClient.request).mockImplementation(
        async ({ url }) =>
          Response.json(
            url.includes(".json")
              ? {
                  pageProps: {
                    salt: "salt",
                    story: { reading_episode: { pages: [{ url: source }] } },
                  },
                }
              : payload
          )
      )
      expect(
        await resolvePixivChapterImageUrls(chapter, {
          taskId: "envelope",
          rateLimitService,
        })
      ).toEqual([source])
      expect(
        vi
          .mocked(integrationHttpClient.request)
          .mock.calls.every(
            ([request]) => request.init?.credentials === "include"
          )
      ).toBe(true)
    }
  )

  it("reports a stale build after exactly one refresh and a second salt 404", async () => {
    cachePixivBuildId("stale", "old")
    vi.mocked(integrationHttpClient.request).mockImplementation(
      async ({ url }) =>
        url.endsWith("/")
          ? new Response("/_next/static/new/_buildManifest.js")
          : new Response(null, { status: 404 })
    )
    await expect(
      resolvePixivChapterImageUrls(chapter, {
        taskId: "stale",
        rateLimitService,
      })
    ).rejects.toMatchObject({ category: "provider_changed" })
    expect(
      vi
        .mocked(integrationHttpClient.request)
        .mock.calls.map(([request]) => request.url)
    ).toEqual([
      "https://comic.pixiv.net/_next/data/old/viewer/stories/123.json?id=123",
      "https://comic.pixiv.net/",
      "https://comic.pixiv.net/_next/data/new/viewer/stories/123.json?id=123",
    ])
  })

  it("preserves an authorization failure from the refreshed salt request", async () => {
    cachePixivBuildId("refresh-forbidden", "old")
    vi.mocked(integrationHttpClient.request)
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(
        new Response("/_next/static/new/_buildManifest.js")
      )
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
    await expect(
      resolvePixivChapterImageUrls(chapter, {
        taskId: "refresh-forbidden",
        rateLimitService,
      })
    ).rejects.toMatchObject({ status: 403 })
    expect(integrationHttpClient.request).toHaveBeenCalledTimes(3)
  })

  it("propagates a salt authorization failure without refreshing the build", async () => {
    cachePixivBuildId("forbidden", "build")
    vi.mocked(integrationHttpClient.request).mockResolvedValueOnce(
      new Response(null, { status: 403 })
    )
    await expect(
      resolvePixivChapterImageUrls(chapter, {
        taskId: "forbidden",
        rateLimitService,
      })
    ).rejects.toMatchObject({ status: 403 })
    expect(integrationHttpClient.request).toHaveBeenCalledTimes(1)
  })
})
