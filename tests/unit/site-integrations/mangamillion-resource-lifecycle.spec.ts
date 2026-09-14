import { afterEach, describe, expect, it, vi } from "vitest"

import {
  HARD_TIMEOUT_MS,
  MAX_IMAGE_BYTES,
  STALL_TIMEOUT_MS,
} from "@/src/constants/timeouts"
import { OffscreenLiveResourceLedger } from "@/src/runtime/offscreen-live-resource-ledger"
import { integrationHttpClient } from "@/src/site-integrations/http-client"
import { offscreen } from "@/src/site-integrations/mangamillion/offscreen-runtime"
import { decryptPageImage } from "@/src/site-integrations/mangamillion/crypto"
import type { RateLimitService } from "@/src/runtime/rate-limit"

const rateLimitService = {
  resolveEffectivePolicy: vi.fn(async () => ({ concurrency: 1, delayMs: 0 })),
  scheduleForIntegrationScope: vi.fn(
    async <T>(_id: string, _scope: string, operation: () => Promise<T>) =>
      operation()
  ),
  cleanupRateLimiters: vi.fn(),
} as unknown as RateLimitService

const rateLimitSettings = {
  image: { concurrency: 1, delayMs: 0 },
  chapter: { concurrency: 1, delayMs: 0 },
}

function makeRuntime() {
  return { rateLimitService, rateLimitSettings }
}

function makeAvifFixture(width: number, height: number): ArrayBuffer {
  const bytes = new Uint8Array(72)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 24)
  bytes.set([0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66], 4)
  bytes.set([0x61, 0x76, 0x69, 0x66], 16)
  view.setUint32(24, 48)
  bytes.set([0x6d, 0x65, 0x74, 0x61], 28)
  view.setUint32(36, 36)
  bytes.set([0x69, 0x70, 0x72, 0x70], 40)
  view.setUint32(44, 28)
  bytes.set([0x69, 0x70, 0x63, 0x6f], 48)
  view.setUint32(52, 20)
  bytes.set([0x69, 0x73, 0x70, 0x65], 56)
  view.setUint32(64, width)
  view.setUint32(68, height)
  return bytes.buffer
}

function makeResponse(data: ArrayBuffer, contentType = "image/avif") {
  return new Response(data, {
    status: 200,
    headers: { "content-type": contentType },
  })
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("MangaMillion image resource ownership", () => {
  it.each(["cover", "chapter"] as const)(
    "cancels a stalled %s body through the actual HTTP and image pipeline",
    async (kind) => {
      vi.useFakeTimers()
      const ledger = new OffscreenLiveResourceLedger()
      const cancel = vi.fn()
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(new ReadableStream({ cancel }), {
              headers: { "content-type": "image/webp" },
            })
        )
      )
      const result = offscreen[kind]!.downloadImage(
        "https://img.mangamillion.shueisha.co.jp/image.webp",
        { runtime: makeRuntime(), liveResourceLedger: ledger }
      )
      const rejected = expect(result).rejects.toThrow(/stalled/)
      await vi.advanceTimersByTimeAsync(STALL_TIMEOUT_MS + 1)
      await rejected
      expect(cancel).toHaveBeenCalledOnce()
      expect(ledger.getUsedBytes()).toBe(0)
    }
  )

  it.each(["cover", "chapter"] as const)(
    "bounds the %s header wait with the shared hard deadline",
    async (kind) => {
      vi.useFakeTimers()
      const ledger = new OffscreenLiveResourceLedger()
      const aborted = vi.fn()
      vi.stubGlobal(
        "fetch",
        vi.fn(
          (_url: string, init: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
              init.signal!.addEventListener(
                "abort",
                () => {
                  aborted()
                  reject(init.signal!.reason)
                },
                { once: true }
              )
            })
        )
      )
      const result = offscreen[kind]!.downloadImage(
        "https://img.mangamillion.shueisha.co.jp/image.webp",
        { runtime: makeRuntime(), liveResourceLedger: ledger }
      )
      const rejected = expect(result).rejects.toThrow(/hard timeout/)
      await vi.advanceTimersByTimeAsync(HARD_TIMEOUT_MS + 1)
      await rejected
      expect(aborted).toHaveBeenCalledOnce()
      expect(ledger.getUsedBytes()).toBe(0)
    }
  )

  it("rejects excessive AVIF dimensions before creating a bitmap", async () => {
    const ledger = new OffscreenLiveResourceLedger()
    vi.spyOn(integrationHttpClient, "request").mockResolvedValue(
      makeResponse(makeAvifFixture(16_385, 4096))
    )
    const decode = vi.fn()
    vi.stubGlobal("createImageBitmap", decode)
    vi.stubGlobal("OffscreenCanvas", class {})
    await expect(
      offscreen.cover!.downloadImage(
        "https://img.mangamillion.shueisha.co.jp/cover.avif",
        { runtime: makeRuntime(), liveResourceLedger: ledger }
      )
    ).rejects.toThrow(/dimension|pixel/i)
    expect(decode).not.toHaveBeenCalled()
    expect(ledger.getUsedBytes()).toBe(0)
  })

  it("admits AES input and output overlap before invoking native decryption", async () => {
    const encrypted = new ArrayBuffer(16)
    const ledger = new OffscreenLiveResourceLedger(32)
    const source = ledger.reserve(encrypted.byteLength, "encrypted source")
    const decrypt = vi.spyOn(globalThis.crypto.subtle, "decrypt")
    await expect(
      decryptPageImage(
        encrypted,
        "00".repeat(32),
        "00".repeat(16),
        ledger,
        source
      )
    ).rejects.toThrow(/resource cap exceeded/i)
    expect(decrypt).not.toHaveBeenCalled()
    expect(ledger.getUsedBytes()).toBe(0)
  })

  it("bounds and owns AVIF cover conversion until the caller releases it", async () => {
    const source = makeAvifFixture(32, 32)
    const ledger = new OffscreenLiveResourceLedger()
    vi.spyOn(integrationHttpClient, "request").mockResolvedValue(
      makeResponse(source)
    )
    const close = vi.fn()
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 32, height: 32, close }))
    )
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        getContext() {
          return { drawImage: vi.fn() }
        }

        convertToBlob() {
          return Promise.resolve(
            new Blob([Uint8Array.of(1, 2, 3)], { type: "image/jpeg" })
          )
        }
      }
    )

    const result = await offscreen.cover!.downloadImage(
      "https://img.mangamillion.shueisha.co.jp/cover.avif",
      { runtime: makeRuntime(), liveResourceLedger: ledger }
    )

    expect(result.mimeType).toBe("image/jpeg")
    expect(result.filename).toBe("cover.jpg")
    expect(close).toHaveBeenCalledOnce()
    expect(ledger.getUsedBytes()).toBe(result.data.byteLength)
    result.liveResourceLease.release()
    expect(ledger.getUsedBytes()).toBe(0)
  })

  it("rejects an oversized AVIF output before copying it to an ArrayBuffer", async () => {
    const source = makeAvifFixture(32, 32)
    const ledger = new OffscreenLiveResourceLedger()
    vi.spyOn(integrationHttpClient, "request").mockResolvedValue(
      makeResponse(source)
    )
    const close = vi.fn()
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 32, height: 32, close }))
    )
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(1))
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        getContext() {
          return { drawImage: vi.fn() }
        }

        convertToBlob() {
          return Promise.resolve({
            size: MAX_IMAGE_BYTES + 1,
            type: "image/jpeg",
            arrayBuffer,
          } as unknown as Blob)
        }
      }
    )

    await expect(
      offscreen.cover!.downloadImage(
        "https://img.mangamillion.shueisha.co.jp/cover.avif",
        { runtime: makeRuntime(), liveResourceLedger: ledger }
      )
    ).rejects.toThrow("byte limit")

    expect(arrayBuffer).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledOnce()
    expect(ledger.getUsedBytes()).toBe(0)
  })

  it("rejects truncated AVIF metadata before native decoding", async () => {
    const source = Uint8Array.from([
      0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66, 0, 0, 0, 0,
    ]).buffer
    const ledger = new OffscreenLiveResourceLedger()
    vi.spyOn(integrationHttpClient, "request").mockResolvedValue(
      makeResponse(source)
    )
    const createImageBitmap = vi.fn()
    vi.stubGlobal("createImageBitmap", createImageBitmap)
    vi.stubGlobal("OffscreenCanvas", class {})

    await expect(
      offscreen.cover!.downloadImage(
        "https://img.mangamillion.shueisha.co.jp/cover.avif",
        { runtime: makeRuntime(), liveResourceLedger: ledger }
      )
    ).rejects.toThrow("dimensions are unavailable")

    expect(createImageBitmap).not.toHaveBeenCalled()
    expect(ledger.getUsedBytes()).toBe(0)
  })

  it("converts a supported AVIF chapter page before returning it", async () => {
    const source = makeAvifFixture(32, 32)
    const ledger = new OffscreenLiveResourceLedger()
    vi.spyOn(integrationHttpClient, "request").mockResolvedValue(
      makeResponse(source)
    )
    const close = vi.fn()
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 32, height: 32, close }))
    )
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        getContext() {
          return { drawImage: vi.fn() }
        }

        convertToBlob() {
          return Promise.resolve(
            new Blob([Uint8Array.of(4, 5, 6)], { type: "image/jpeg" })
          )
        }
      }
    )

    const result = await offscreen.chapter.downloadImage(
      "https://img.mangamillion.shueisha.co.jp/page.avif",
      { runtime: makeRuntime(), liveResourceLedger: ledger }
    )

    expect(result.mimeType).toBe("image/jpeg")
    expect(result.filename).toBe("page.jpg")
    expect(close).toHaveBeenCalledOnce()
    result.liveResourceLease.release()
    expect(ledger.getUsedBytes()).toBe(0)
  })

  it("decrypts and converts an AVIF chapter page while retaining owned output", async () => {
    const source = makeAvifFixture(32, 32)
    const keyHex =
      "8c12434255319a2a5fb903fc39994f409eb27979d1d78f1009f1a015f69db321"
    const ivHex = "4af66d450c1244868dc4a5cff035898c"
    const key = await globalThis.crypto.subtle.importKey(
      "raw",
      Uint8Array.from(keyHex.match(/.{1,2}/g)!, (value) =>
        Number.parseInt(value, 16)
      ),
      { name: "AES-CBC" },
      false,
      ["encrypt"]
    )
    const encrypted = await globalThis.crypto.subtle.encrypt(
      {
        name: "AES-CBC",
        iv: Uint8Array.from(ivHex.match(/.{1,2}/g)!, (value) =>
          Number.parseInt(value, 16)
        ),
      },
      key,
      source
    )
    const ledger = new OffscreenLiveResourceLedger()
    vi.spyOn(integrationHttpClient, "request").mockResolvedValue(
      makeResponse(encrypted, "application/octet-stream")
    )
    const close = vi.fn()
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 32, height: 32, close }))
    )
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        getContext() {
          return { drawImage: vi.fn() }
        }

        convertToBlob() {
          return Promise.resolve(
            new Blob([Uint8Array.of(7, 8, 9)], { type: "image/jpeg" })
          )
        }
      }
    )

    const result = await offscreen.chapter.downloadImage(
      `https://img.mangamillion.shueisha.co.jp/page.avif.enc#k=${keyHex}&iv=${ivHex}`,
      { runtime: makeRuntime(), liveResourceLedger: ledger }
    )

    expect(result.mimeType).toBe("image/jpeg")
    expect(result.filename).toBe("page.jpg")
    expect(close).toHaveBeenCalledOnce()
    result.liveResourceLease.release()
    expect(ledger.getUsedBytes()).toBe(0)
  })

  it("rejects chapter bytes without a supported signature instead of assuming WebP", async () => {
    const ledger = new OffscreenLiveResourceLedger()
    vi.spyOn(integrationHttpClient, "request").mockResolvedValue(
      makeResponse(Uint8Array.of(1, 2, 3).buffer, "application/octet-stream")
    )

    await expect(
      offscreen.chapter.downloadImage(
        "https://img.mangamillion.shueisha.co.jp/page.webp.enc",
        { runtime: makeRuntime(), liveResourceLedger: ledger }
      )
    ).rejects.toThrow("supported image signature")

    expect(ledger.getUsedBytes()).toBe(0)
  })
})
