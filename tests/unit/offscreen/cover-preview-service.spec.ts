import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CoverPreviewService } from "@/entrypoints/offscreen/cover-preview-service"
import { OffscreenLiveResourceLedger } from "@/src/runtime/offscreen-live-resource-ledger"
import { RateLimitService } from "@/src/runtime/rate-limit"
import { MAX_COVER_PREVIEW_BYTES } from "@/src/runtime/cover-preview-contracts"

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII="
const PNG = Uint8Array.from(atob(PNG_BASE64), (value) => value.charCodeAt(0))
const COVER_URL = "https://biccam.com/comics/123-series.png?version=2"
const POLICY = {
  image: { concurrency: 2, delayMs: 0 },
  chapter: { concurrency: 1, delayMs: 0 },
}

function payload() {
  return {
    requestId: crypto.randomUUID(),
    integrationId: "mycomic",
    coverUrl: COVER_URL,
    rateLimitSettings: POLICY,
  }
}

function imageResponse(
  bytes = PNG,
  mimeType = "image/png",
  status = 200,
  url = COVER_URL
) {
  const response = new Response(bytes, {
    status,
    headers: { "content-type": mimeType },
  })
  Object.defineProperty(response, "url", { value: url })
  return response
}

describe("cover preview image transport", () => {
  let ledger: OffscreenLiveResourceLedger
  let rateLimitService: RateLimitService
  let service: CoverPreviewService
  const fetchImage = vi.fn<typeof fetch>()
  const closeBitmap = vi.fn()
  const decodeImage = vi.fn()
  const sendMessage = vi.fn()

  beforeEach(() => {
    ledger = new OffscreenLiveResourceLedger()
    rateLimitService = new RateLimitService({
      resolveEffectivePolicy: async () => POLICY.image,
    })
    service = new CoverPreviewService(rateLimitService, ledger)
    fetchImage.mockReset().mockImplementation(async () => imageResponse())
    closeBitmap.mockReset()
    decodeImage.mockReset().mockResolvedValue({
      width: 1,
      height: 1,
      close: closeBitmap,
    })
    sendMessage.mockReset().mockResolvedValue({
      success: true,
      enablement: {},
    })
    vi.stubGlobal("fetch", fetchImage)
    vi.stubGlobal("createImageBitmap", decodeImage)
    vi.stubGlobal("chrome", { runtime: { sendMessage } })
  })

  afterEach(() => {
    rateLimitService.cleanupRateLimiters()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it("returns validated provider cover bytes with their issued identity and releases image resources", async () => {
    await expect(service.fetch(payload())).resolves.toEqual({
      success: true,
      integrationId: "mycomic",
      coverUrl: COVER_URL,
      mimeType: "image/png",
      base64: PNG_BASE64,
    })
    expect(fetchImage).toHaveBeenCalledWith(
      COVER_URL,
      expect.objectContaining({ credentials: "omit", redirect: "error" })
    )
    expect(closeBitmap).toHaveBeenCalledOnce()
    expect(ledger.getUsedBytes()).toBe(0)
    expect(service.getActiveCount()).toBe(0)
  })

  it("fetches Manhuagui covers issued by its static image host", async () => {
    const coverUrl = "https://cf.mhgui.com/cpic/b/55555.jpg"
    fetchImage.mockImplementation(async () =>
      imageResponse(PNG, "image/png", 200, coverUrl)
    )
    await expect(
      service.fetch({
        ...payload(),
        integrationId: "readmanga",
        coverUrl,
      })
    ).resolves.toMatchObject({ success: true, coverUrl, base64: PNG_BASE64 })
    expect(ledger.getUsedBytes()).toBe(0)
  })

  it("fetches concurrent MangaDex covers using their explicit image policy", async () => {
    sendMessage.mockResolvedValue({
      success: true,
      enablement: { mangadex: true },
    })
    rateLimitService.cleanupRateLimiters()
    rateLimitService = new RateLimitService({
      resolveEffectivePolicy: async () => {
        throw new Error("Cover previews require an explicit image policy")
      },
    })
    service = new CoverPreviewService(rateLimitService, ledger)
    fetchImage.mockImplementation(async (url) =>
      imageResponse(PNG, "image/png", 200, String(url))
    )
    const urls = [
      "https://uploads.mangadex.org/covers/series/first.jpg",
      "https://uploads.mangadex.org/covers/series/second.jpg",
    ]
    const responses = await Promise.all(
      urls.map((coverUrl) =>
        service.fetch({
          ...payload(),
          integrationId: "mangadex",
          coverUrl,
        })
      )
    )
    expect(responses).toEqual(
      urls.map((coverUrl) => ({
        success: true,
        integrationId: "mangadex",
        coverUrl,
        mimeType: "image/png",
        base64: PNG_BASE64,
      }))
    )
    expect(ledger.getUsedBytes()).toBe(0)
    expect(service.getActiveCount()).toBe(0)
  })

  it.each([
    ["HTTP rejection", () => imageResponse(PNG, "image/png", 403)],
    ["unexpected MIME", () => imageResponse(PNG, "text/html")],
    ["invalid image metadata", () => imageResponse(new Uint8Array([1, 2, 3]))],
  ])(
    "settles unavailable covers after %s without retaining image resources",
    async (_label, response) => {
      fetchImage.mockImplementation(async () => response())
      await expect(service.fetch(payload())).resolves.toMatchObject({
        success: false,
      })
      expect(decodeImage).not.toHaveBeenCalled()
      expect(ledger.getUsedBytes()).toBe(0)
      expect(service.getActiveCount()).toBe(0)
    }
  )

  it("rejects image bytes that the native decoder cannot decode", async () => {
    decodeImage.mockRejectedValue(new Error("Invalid PNG"))
    await expect(service.fetch(payload())).resolves.toMatchObject({
      success: false,
    })
    expect(ledger.getUsedBytes()).toBe(0)
    expect(service.getActiveCount()).toBe(0)
  })

  it("stops an oversized response while reading and releases its body", async () => {
    const cancel = vi.fn()
    fetchImage.mockImplementation(async () => {
      const response = new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(MAX_COVER_PREVIEW_BYTES + 1))
          },
          cancel,
        }),
        { headers: { "content-type": "image/png" } }
      )
      Object.defineProperty(response, "url", { value: COVER_URL })
      return response
    })
    await expect(service.fetch(payload())).resolves.toMatchObject({
      success: false,
    })
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce())
    expect(decodeImage).not.toHaveBeenCalled()
    expect(ledger.getUsedBytes()).toBe(0)
  })

  it("rejects excessive encoded dimensions before allocating a decoder", async () => {
    const bytes = PNG.slice()
    new DataView(bytes.buffer).setUint32(16, 4096)
    new DataView(bytes.buffer).setUint32(20, 4096)
    fetchImage.mockImplementation(async () => imageResponse(bytes))
    await expect(service.fetch(payload())).resolves.toMatchObject({
      success: false,
    })
    expect(decodeImage).not.toHaveBeenCalled()
    expect(ledger.getUsedBytes()).toBe(0)
  })

  it("checks fresh integration enablement before every new preview", async () => {
    sendMessage.mockResolvedValueOnce({
      success: true,
      enablement: { mycomic: false },
    })
    await expect(service.fetch(payload())).resolves.toMatchObject({
      success: false,
    })
    expect(fetchImage).not.toHaveBeenCalled()
    await expect(service.fetch(payload())).resolves.toMatchObject({
      success: true,
    })
  })

  it("rejects cover URLs outside the integration's image policy", async () => {
    await expect(
      service.fetch({
        ...payload(),
        coverUrl: "https://other.example/cover.png",
      })
    ).resolves.toMatchObject({ success: false })
    expect(fetchImage).not.toHaveBeenCalled()
    expect(ledger.getUsedBytes()).toBe(0)
  })

  it("settles cancellation immediately and keeps ownership until a late decoder closes", async () => {
    let finishDecode!: (value: {
      width: number
      height: number
      close: () => void
    }) => void
    decodeImage.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishDecode = resolve
        })
    )
    const request = payload()
    const response = service.fetch(request)
    await vi.waitFor(() => expect(decodeImage).toHaveBeenCalledOnce())

    expect(service.cancel(request.requestId)).toBe(true)
    await expect(response).resolves.toMatchObject({ success: false })
    expect(service.getActiveCount()).toBe(1)
    expect(ledger.getUsedBytes()).toBeGreaterThan(0)
    finishDecode({ width: 1, height: 1, close: closeBitmap })
    await vi.waitFor(() => expect(service.getActiveCount()).toBe(0))
    expect(closeBitmap).toHaveBeenCalledOnce()
    expect(ledger.getUsedBytes()).toBe(0)
    expect(service.cancel(request.requestId)).toBe(false)
  })

  it("times out stalled response bodies and cancels the reader", async () => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    fetchImage.mockImplementation(async () => {
      const response = new Response(new ReadableStream({ cancel }), {
        headers: { "content-type": "image/png" },
      })
      Object.defineProperty(response, "url", { value: COVER_URL })
      return response
    })
    const response = service.fetch(payload())
    await vi.advanceTimersByTimeAsync(100)
    expect(fetchImage).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(15_000)
    await expect(response).resolves.toMatchObject({ success: false })
    expect(cancel).toHaveBeenCalledOnce()
    expect(service.getActiveCount()).toBe(0)
    expect(ledger.getUsedBytes()).toBe(0)
  })

  it("bounds concurrent producers while canceled decoders are still live", async () => {
    const decoders: Array<
      (value: { width: number; height: number; close: () => void }) => void
    > = []
    decodeImage.mockImplementation(
      () => new Promise((resolve) => decoders.push(resolve))
    )
    const first = payload()
    const second = payload()
    const firstResponse = service.fetch(first)
    const secondResponse = service.fetch(second)
    await vi.waitFor(() => expect(decodeImage).toHaveBeenCalledTimes(2))

    service.cancel(first.requestId)
    await expect(firstResponse).resolves.toMatchObject({ success: false })
    await expect(service.fetch(payload())).resolves.toMatchObject({
      success: false,
    })
    expect(fetchImage).toHaveBeenCalledTimes(2)
    expect(service.getActiveCount()).toBe(2)
    service.cancel(second.requestId)
    await expect(secondResponse).resolves.toMatchObject({ success: false })
    for (const resolve of decoders)
      resolve({ width: 1, height: 1, close: closeBitmap })
    await vi.waitFor(() => expect(service.getActiveCount()).toBe(0))
    expect(closeBitmap).toHaveBeenCalledTimes(2)
    expect(ledger.getUsedBytes()).toBe(0)
  })
})
