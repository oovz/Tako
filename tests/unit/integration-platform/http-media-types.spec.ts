import { afterEach, describe, expect, it, vi } from "vitest"

import { integrationHttpClient } from "@/src/site-integrations/http-client"
import { RateLimitService } from "@/src/runtime/rate-limit"

const rateLimitService = new RateLimitService({
  resolveEffectivePolicy: async () => ({ concurrency: 1, delayMs: 0 }),
})
const endpoints = {
  json: {
    integrationId: "mangadex",
    endpointId: "mangadex-api",
    url: "https://api.mangadex.org/manga/example",
  },
  html: {
    integrationId: "pixiv-comic",
    endpointId: "pixiv-comic-homepage",
    url: "https://comic.pixiv.net/",
  },
  text: {
    integrationId: "readmanga",
    endpointId: "readmanga-reader-config",
    url: "https://cf.mhgui.com/config.js",
  },
  bytes: {
    integrationId: "pixiv-comic",
    endpointId: "pixiv-comic-image-cdn",
    url: "https://img-comic.pximg.net/page.jpg",
  },
}

afterEach(() => {
  rateLimitService.cleanupRateLimiters()
  vi.unstubAllGlobals()
})

describe("declared endpoint response formats", () => {
  it.each<[keyof typeof endpoints, string]>([
    ["json", "Application/JSON; charset=UTF-8"],
    ["json", "application/problem+json"],
    ["html", "application/xhtml+xml"],
    ["text", "text/plain"],
    ["text", "application/javascript"],
    ["text", "application/x-javascript"],
    ["bytes", "image/webp"],
    ["bytes", "application/octet-stream"],
    ["bytes", "binary/octet-stream"],
    ["bytes", "application/protobuf"],
    ["bytes", "application/x-protobuf"],
  ])(
    "hands %s content to the caller for media type %s",
    async (type, contentType) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response("payload", {
              headers: { "content-type": contentType },
            })
        )
      )
      const response = await integrationHttpClient.request({
        ...endpoints[type],
        scope: "chapter",
        skipRateLimit: true,
        rateLimitService,
      })
      await expect(response.text()).resolves.toBe("payload")
    }
  )

  it.each<[keyof typeof endpoints, string]>([
    ["json", "text/json"],
    ["html", "text/plain"],
    ["text", "application/json"],
    ["bytes", "text/html"],
  ])(
    "rejects %s responses with media type %s and releases their body",
    async (type, contentType) => {
      const cancel = vi.fn()
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(new ReadableStream({ cancel }), {
              headers: { "content-type": contentType },
            })
        )
      )
      await expect(
        integrationHttpClient.request({
          ...endpoints[type],
          scope: "chapter",
          skipRateLimit: true,
          rateLimitService,
        })
      ).rejects.toThrow()
      expect(cancel).toHaveBeenCalledOnce()
    }
  )

  it.each([204, 205, 404])(
    "preserves status %s without imposing a successful-body media type",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(null, { status }))
      )
      const response = await integrationHttpClient.request({
        ...endpoints.json,
        scope: "chapter",
        skipRateLimit: true,
        rateLimitService,
      })
      expect(response.status).toBe(status)
    }
  )

  it("rejects caller redirect overrides before making a network request", async () => {
    const fetcher = vi.fn()
    vi.stubGlobal("fetch", fetcher)
    await expect(
      integrationHttpClient.request({
        ...endpoints.json,
        scope: "chapter",
        skipRateLimit: true,
        rateLimitService,
        init: { redirect: "follow" },
      })
    ).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("accepts the declared request options and applies scheduling", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response("{}", { headers: { "content-type": "application/json" } })
    )
    vi.stubGlobal("fetch", fetcher)
    const response = await integrationHttpClient.request({
      ...endpoints.json,
      scope: "chapter",
      rateLimitService,
      init: { redirect: "error", credentials: "omit" },
    })
    await expect(response.json()).resolves.toEqual({})
    expect(fetcher).toHaveBeenCalledWith(
      endpoints.json.url,
      expect.objectContaining({ redirect: "error", credentials: "omit" })
    )
  })
})
