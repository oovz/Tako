import { afterEach, describe, expect, it, vi } from "vitest"
import { offscreenSiteAdapter as copy } from "@/src/site-integrations/copymanga/offscreen-runtime"
import { offscreenSiteAdapter as again } from "@/src/site-integrations/mangaagain/offscreen-runtime"
import { offscreenSiteAdapter as love } from "@/src/site-integrations/lovemanga/offscreen-runtime"
import { offscreenSiteAdapter as here } from "@/src/site-integrations/mangahere/offscreen-runtime"
import { downloadMangadexCoverImage } from "@/src/site-integrations/mangadex/chapter-api"
import { downloadPixivCoverImage } from "@/src/site-integrations/pixiv-comic/chapter-api"
import { integrationHttpClient } from "@/src/site-integrations/http-client"
import { RateLimitService } from "@/src/runtime/rate-limit"
import { OffscreenLiveResourceLedger } from "@/src/runtime/offscreen-live-resource-ledger"

const rateLimitService = new RateLimitService({
  resolveEffectivePolicy: async () => ({ concurrency: 1, delayMs: 0 }),
})
const runtime = {
  rateLimitService,
  rateLimitSettings: {
    image: { concurrency: 1, delayMs: 0 },
    chapter: { concurrency: 1, delayMs: 0 },
  },
}

afterEach(() => {
  vi.restoreAllMocks()
  rateLimitService.cleanupRateLimiters()
})

describe("provider image downloads", () => {
  it.each([
    {
      name: "Copy cover",
      download: copy.offscreen.cover!.downloadImage,
      input: "https://cdn.copymanga.tv/book/",
      url: "https://cdn.copymanga.tv/book/",
      filename: "page.jpg",
      integrationId: "copymanga",
      endpointId: "copy-image",
      skipRateLimit: true,
      credentials: "omit",
    },
    {
      name: "Zaimanhua chapter",
      download: again.offscreen.chapter.downloadImage,
      input: "https://img.zaimanhua.com/page.png?token=1",
      url: "https://img.zaimanhua.com/page.png?token=1",
      filename: "page.png",
      integrationId: "mangaagain",
      endpointId: "mangaagain-image",
      skipRateLimit: true,
      credentials: "omit",
    },
    {
      name: "Aimanhua cover",
      download: love.offscreen.cover!.downloadImage,
      input: "/static/upload2/book/",
      url: "https://img1.baipiaoguai.org/static/upload2/book/",
      filename: "page.jpg",
      integrationId: "lovemanga",
      endpointId: "lovemanga-image",
      skipRateLimit: false,
      credentials: "omit",
    },
    {
      name: "Aimanhua chapter",
      download: love.offscreen.chapter.downloadImage,
      input: "/static/upload3/book/page.png",
      url: "https://img1.baipiaoguai.org/static/upload3/book/page.png",
      filename: "page.png",
      integrationId: "lovemanga",
      endpointId: "lovemanga-image",
      skipRateLimit: true,
      credentials: "omit",
    },
    {
      name: "MangaHere cover",
      download: here.offscreen.cover!.downloadImage,
      input: "https://fmcdn.mangahere.com/store/manga/",
      url: "https://fmcdn.mangahere.com/store/manga/",
      filename: "page.jpg",
      integrationId: "mangahere",
      endpointId: "mangahere-image",
      skipRateLimit: false,
      credentials: "omit",
    },
    {
      name: "MangaHere chapter",
      download: here.offscreen.chapter.downloadImage,
      input: "https://zjcdn.mangahere.org/store/manga/page.png",
      url: "https://zjcdn.mangahere.org/store/manga/page.png",
      filename: "page.png",
      integrationId: "mangahere",
      endpointId: "mangahere-image",
      skipRateLimit: true,
      credentials: "omit",
    },
    {
      name: "MangaDex cover with trailing slash",
      download: downloadMangadexCoverImage,
      input: "https://uploads.mangadex.org/covers/work/",
      url: "https://uploads.mangadex.org/covers/work/",
      filename: "work",
      integrationId: "mangadex",
      endpointId: "mangadex-at-home-image",
      skipRateLimit: false,
      credentials: "omit",
    },
    {
      name: "MangaDex cover fallback",
      download: downloadMangadexCoverImage,
      input: "https://uploads.mangadex.org/",
      url: "https://uploads.mangadex.org/",
      filename: "cover.jpg",
      integrationId: "mangadex",
      endpointId: "mangadex-at-home-image",
      skipRateLimit: false,
      credentials: "omit",
    },
    {
      name: "Pixiv cover with trailing slash",
      download: downloadPixivCoverImage,
      input: "//img-comic.pximg.net/covers/work/",
      url: "https://img-comic.pximg.net/covers/work/",
      filename: "work",
      integrationId: "pixiv-comic",
      endpointId: "pixiv-comic-image-cdn",
      skipRateLimit: false,
      credentials: "include",
    },
    {
      name: "Pixiv cover fallback",
      download: downloadPixivCoverImage,
      input: "https://img-comic.pximg.net/",
      url: "https://img-comic.pximg.net/",
      filename: "cover.jpg",
      integrationId: "pixiv-comic",
      endpointId: "pixiv-comic-image-cdn",
      skipRateLimit: false,
      credentials: "include",
    },
  ])(
    "preserves transport policy and owned bytes for $name",
    async ({ download, input, url, filename, ...policy }) => {
      const request = vi
        .spyOn(integrationHttpClient, "request")
        .mockResolvedValueOnce(
          new Response(new Uint8Array([1, 2, 3]), {
            headers: { "content-type": "image/png" },
          })
        )
      const ledger = new OffscreenLiveResourceLedger()
      const onBytesReceived = vi.fn()
      const result = await download(input, {
        runtime,
        skipRateLimit: false,
        onBytesReceived,
        liveResourceLedger: ledger,
      })
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          integrationId: policy.integrationId,
          endpointId: policy.endpointId,
          scope: "image",
          url,
          rateLimitService,
          skipRateLimit: policy.skipRateLimit,
          init: expect.objectContaining({ credentials: policy.credentials }),
        })
      )
      expect(new Uint8Array(result.data)).toEqual(new Uint8Array([1, 2, 3]))
      expect(result).toMatchObject({ filename, mimeType: "image/png" })
      expect(onBytesReceived).toHaveBeenLastCalledWith(3)
      expect(ledger.getUsedBytes()).toBe(3)
      result.liveResourceLease.release()
      expect(ledger.getUsedBytes()).toBe(0)
    }
  )

  it.each([
    [love.offscreen.cover!.downloadImage, "/static/upload2/book/page.png"],
    [
      here.offscreen.cover!.downloadImage,
      "https://zjcdn.mangahere.org/store/manga/page.png",
    ],
    [downloadPixivCoverImage, "https://img-comic.pximg.net/page.png"],
  ] as const)(
    "releases a response and its reservation when its final URL violates provider policy",
    async (download, imageUrl) => {
      const cancel = vi.fn()
      const response = new Response(new ReadableStream({ cancel }), {
        headers: { "content-type": "image/png" },
      })
      Object.defineProperty(response, "url", {
        value: "https://attacker.example/page.png",
      })
      vi.spyOn(integrationHttpClient, "request").mockResolvedValueOnce(response)
      const ledger = new OffscreenLiveResourceLedger()
      await expect(
        download(imageUrl, { runtime, liveResourceLedger: ledger })
      ).rejects.toThrow(/unavailable|untrusted/i)
      expect(cancel).toHaveBeenCalledOnce()
      expect(ledger.getUsedBytes()).toBe(0)
    }
  )

  it("aborts an in-flight image request with its caller and releases its reservation", async () => {
    const request = vi
      .spyOn(integrationHttpClient, "request")
      .mockImplementationOnce(() => new Promise<Response>(() => undefined))
    const ledger = new OffscreenLiveResourceLedger()
    const controller = new AbortController()
    const pending = here.offscreen.cover!.downloadImage(
      "https://zjcdn.mangahere.org/store/manga/page.png",
      { runtime, signal: controller.signal, liveResourceLedger: ledger }
    )
    const outcome = expect(pending).rejects.toThrow("caller canceled")
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce())
    const requestSignal = request.mock.calls[0][0].init?.signal
    controller.abort(new Error("caller canceled"))
    await outcome
    expect(requestSignal?.aborted).toBe(true)
    expect(ledger.getUsedBytes()).toBe(0)
  })
})
