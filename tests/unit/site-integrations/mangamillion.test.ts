import { afterEach, describe, expect, it, vi } from "vitest"

import {
  buildMangaMillionChapterUrl,
  isTrustedMangaMillionApiUrl,
  isTrustedMangaMillionAssetUrl,
  parseMangaMillionChapterId,
  parseMangaMillionSeriesUrl,
} from "@/src/site-integrations/mangamillion/urls"
import { decodeMangaMillionResponse } from "@/src/site-integrations/mangamillion/proto"
import {
  decryptPageImage,
  detectImageMimeTypeAndExt,
  hexToBytes,
} from "@/src/site-integrations/mangamillion/crypto"
import {
  getDeviceToken,
  setCachedDeviceTokenForTesting,
} from "@/src/site-integrations/mangamillion/api"
import { backgroundSiteAdapter } from "@/src/site-integrations/mangamillion/background-runtime"
import { offscreenSiteAdapter } from "@/src/site-integrations/mangamillion/offscreen-runtime"
import { integrationHttpClient } from "@/src/site-integrations/http-client"
import type { Chapter } from "@/src/types/chapter"
import type { RateLimitService } from "@/src/runtime/rate-limit"

const mockRateLimitService = {
  resolveEffectivePolicy: vi.fn(async () => ({ concurrency: 1, delayMs: 0 })),
  scheduleForIntegrationScope: vi.fn(
    async <T>(_integrationId: string, _scope: string, task: () => Promise<T>) =>
      task()
  ),
  cleanupRateLimiters: vi.fn(),
} as unknown as RateLimitService

const rateLimitSettings = {
  image: { concurrency: 2, delayMs: 0 },
  chapter: { concurrency: 1, delayMs: 0 },
}

function encodeVarint(val: number): number[] {
  let v = val
  const bytes: number[] = []
  while (v >= 0x80) {
    bytes.push((v & 0x7f) | 0x80)
    v >>>= 7
  }
  bytes.push(v & 0x7f)
  return bytes
}

function encodeField(
  tag: number,
  wireType: number,
  payload: number[]
): number[] {
  const header = encodeVarint((tag << 3) | wireType)
  if (wireType === 2) {
    const len = encodeVarint(payload.length)
    return [...header, ...len, ...payload]
  }
  return [...header, ...payload]
}

function encodeString(tag: number, str: string): number[] {
  return encodeField(tag, 2, Array.from(new TextEncoder().encode(str)))
}

function encodeInt32(tag: number, val: number): number[] {
  return encodeField(tag, 0, encodeVarint(val))
}

function encodeMessage(tag: number, payload: number[]): number[] {
  return encodeField(tag, 2, payload)
}

describe("MangaMillion site integration", () => {
  afterEach(() => {
    setCachedDeviceTokenForTesting(null)
    vi.restoreAllMocks()
  })

  describe("URL matching and parsing", () => {
    it("parses valid series URLs with and without language prefix", () => {
      expect(
        parseMangaMillionSeriesUrl(
          "https://mangamillion.shueisha.co.jp/en/title/1"
        )
      ).toEqual({
        titleId: 1,
        language: "en",
      })

      expect(
        parseMangaMillionSeriesUrl(
          "https://mangamillion.shueisha.co.jp/title/42"
        )
      ).toEqual({
        titleId: 42,
        language: "en",
      })

      expect(
        parseMangaMillionSeriesUrl(
          "https://mangamillion.shueisha.co.jp/ja/title/100"
        )
      ).toEqual({
        titleId: 100,
        language: "ja",
      })

      expect(
        parseMangaMillionSeriesUrl(
          "https://mangamillion.shueisha.co.jp/zh-CN/title/123/chapter/456"
        )
      ).toEqual({
        titleId: 123,
        language: "zh-CN",
        chapterId: 456,
      })
    })

    it("rejects untrusted or invalid series URLs", () => {
      expect(
        parseMangaMillionSeriesUrl(
          "http://mangamillion.shueisha.co.jp/en/title/1"
        )
      ).toBeNull()
      expect(
        parseMangaMillionSeriesUrl("https://other-domain.com/en/title/1")
      ).toBeNull()
      expect(
        parseMangaMillionSeriesUrl(
          "https://mangamillion.shueisha.co.jp/invalid/path"
        )
      ).toBeNull()
      expect(
        parseMangaMillionSeriesUrl(
          "https://user:pass@mangamillion.shueisha.co.jp/en/title/1"
        )
      ).toBeNull()
    })

    it("parses chapter identifiers correctly", () => {
      expect(parseMangaMillionChapterId(6736)).toBe(6736)
      expect(parseMangaMillionChapterId("6736")).toBe(6736)
      expect(
        parseMangaMillionChapterId(
          "https://mangamillion.shueisha.co.jp/en/title/1/chapter/6736"
        )
      ).toBe(6736)
      expect(parseMangaMillionChapterId("invalid")).toBeNull()
      expect(parseMangaMillionChapterId(-5)).toBeNull()
    })

    it("builds chapter URLs", () => {
      expect(buildMangaMillionChapterUrl(1, 6736, "en")).toBe(
        "https://mangamillion.shueisha.co.jp/en/title/1/chapter/6736"
      )
    })

    it("validates trusted API and asset URLs", () => {
      expect(
        isTrustedMangaMillionApiUrl(
          "https://api.mangamillion.shueisha.co.jp/api/viewer?translated_chapter_id=1"
        )
      ).toBe(true)
      expect(isTrustedMangaMillionApiUrl("https://evil.com/api/viewer")).toBe(
        false
      )

      expect(
        isTrustedMangaMillionAssetUrl(
          "https://img.mangamillion.shueisha.co.jp/en/translated_chapter_page/1/1.webp.enc"
        )
      ).toBe(true)
      expect(isTrustedMangaMillionAssetUrl("https://evil.com/page.jpg")).toBe(
        false
      )
    })
  })

  describe("Protobuf reader and response decoding", () => {
    it("decodes basic protobuf fields and skipTypes", () => {
      const buf = new Uint8Array([
        ...encodeInt32(1, 0),
        ...encodeString(2, "error"),
        ...encodeField(99, 0, encodeVarint(1)),
      ])
      const decoded = decodeMangaMillionResponse(buf)
      expect(decoded.status).toBe(0)
      expect(decoded.errorMessage).toBe("error")
    })

    it("decodes DeviceTokenRegisterResponse", () => {
      const tokenPayload = [...encodeString(1, "my-token")]
      const buf = new Uint8Array([
        ...encodeInt32(1, 0),
        ...encodeMessage(170, tokenPayload),
      ])
      const decoded = decodeMangaMillionResponse(buf)
      expect(decoded.deviceTokenRegister?.token).toBe("my-token")
    })
  })

  describe("AES-256-CBC Decryption and Format Detection", () => {
    it("converts hex strings to bytes correctly", () => {
      const hex = "4af66d450c1244868dc4a5cff035898c"
      const bytes = hexToBytes(hex)
      expect(bytes.length).toBe(16)
      expect(bytes[0]).toBe(0x4a)
      expect(bytes[15]).toBe(0x8c)
    })

    it("detects image MIME types from headers", () => {
      const webpHeader = new Uint8Array([
        0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
      ])
      expect(detectImageMimeTypeAndExt(webpHeader)).toEqual({
        mimeType: "image/webp",
        extension: ".webp",
      })

      const avifHeader = new Uint8Array([
        0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66,
      ])
      expect(detectImageMimeTypeAndExt(avifHeader)).toEqual({
        mimeType: "image/avif",
        extension: ".avif",
      })

      const jpegHeader = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
      expect(detectImageMimeTypeAndExt(jpegHeader)).toEqual({
        mimeType: "image/jpeg",
        extension: ".jpg",
      })

      const pngHeader = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
      expect(detectImageMimeTypeAndExt(pngHeader)).toEqual({
        mimeType: "image/png",
        extension: ".png",
      })
    })

    it("encrypts and decrypts payload with AES-256-CBC", async () => {
      const keyHex =
        "8c12434255319a2a5fb903fc39994f409eb27979d1d78f1009f1a015f69db321"
      const ivHex = "4af66d450c1244868dc4a5cff035898c"

      const plainText = new TextEncoder().encode(
        "RIFF____WEBPDecryptedPageContent"
      )

      const keyBytes = hexToBytes(keyHex)
      const ivBytes = hexToBytes(ivHex)
      const cryptoKey = await globalThis.crypto.subtle.importKey(
        "raw",
        keyBytes as unknown as BufferSource,
        { name: "AES-CBC" },
        false,
        ["encrypt"]
      )
      const encrypted = await globalThis.crypto.subtle.encrypt(
        { name: "AES-CBC", iv: ivBytes as unknown as BufferSource },
        cryptoKey,
        plainText
      )

      const decrypted = await decryptPageImage(encrypted, keyHex, ivHex)
      expect(decrypted.mimeType).toBe("image/webp")
      expect(decrypted.extension).toBe(".webp")
      expect(new Uint8Array(decrypted.data)).toEqual(plainText)
    })
  })

  describe("API and Token Management", () => {
    it("fetches and caches device token", async () => {
      const tokenPayload = [...encodeString(1, "sample-device-token")]
      const mockProtoResponse = new Uint8Array([
        ...encodeInt32(1, 0),
        ...encodeMessage(170, tokenPayload),
      ])

      const requestSpy = vi
        .spyOn(integrationHttpClient, "request")
        .mockResolvedValue({
          ok: true,
          status: 200,
          arrayBuffer: async () => mockProtoResponse.buffer,
        } as unknown as Response)

      const token1 = await getDeviceToken(mockRateLimitService)
      expect(token1).toBe("sample-device-token")
      expect(requestSpy).toHaveBeenCalledTimes(1)

      const token2 = await getDeviceToken(mockRateLimitService)
      expect(token2).toBe("sample-device-token")
      expect(requestSpy).toHaveBeenCalledTimes(1)
    })

    it("coalesces concurrent device token requests into a single network call", async () => {
      const tokenPayload = [...encodeString(1, "concurrent-device-token")]
      const mockProtoResponse = new Uint8Array([
        ...encodeInt32(1, 0),
        ...encodeMessage(170, tokenPayload),
      ])

      const { promise: gatePromise, resolve: openGate } =
        Promise.withResolvers<void>()

      const requestSpy = vi
        .spyOn(integrationHttpClient, "request")
        .mockImplementation(async () => {
          await gatePromise
          return {
            ok: true,
            status: 200,
            arrayBuffer: async () => mockProtoResponse.buffer,
          } as unknown as Response
        })

      const p1 = getDeviceToken(mockRateLimitService)
      const p2 = getDeviceToken(mockRateLimitService)

      openGate()
      const [token1, token2] = await Promise.all([p1, p2])

      expect(token1).toBe("concurrent-device-token")
      expect(token2).toBe("concurrent-device-token")
      expect(requestSpy).toHaveBeenCalledTimes(1)
    })
  })

  describe("Background Resolver", () => {
    it("resolves series metadata and chapter list", async () => {
      setCachedDeviceTokenForTesting("test-token")

      const serviceTitleBytes = [
        ...encodeString(2, "One Piece"),
        ...encodeString(3, "Eiichiro Oda"),
      ]
      const titleDetailBytes = [...encodeMessage(1, serviceTitleBytes)]
      const titleDetailBuf = new Uint8Array([
        ...encodeInt32(1, 0),
        ...encodeMessage(50, titleDetailBytes),
      ])

      const chInfoBytes = [
        ...encodeString(1, "#001"),
        ...encodeString(2, "Chapter 1:Romance Dawn"),
        ...encodeInt32(3, 6736),
      ]
      const groupBytes = [
        ...encodeInt32(1, 0),
        ...encodeMessage(2, chInfoBytes),
      ]
      const chapterListBytes = [...encodeMessage(2, groupBytes)]
      const chapterListBuf = new Uint8Array([
        ...encodeInt32(1, 0),
        ...encodeMessage(60, chapterListBytes),
      ])

      vi.spyOn(integrationHttpClient, "request").mockImplementation(
        async (opts) => {
          if (opts.url.includes("/api/title_detail")) {
            return {
              ok: true,
              status: 200,
              arrayBuffer: async () => titleDetailBuf.buffer,
            } as unknown as Response
          }
          if (opts.url.includes("/api/chapter_list")) {
            return {
              ok: true,
              status: 200,
              arrayBuffer: async () => chapterListBuf.buffer,
            } as unknown as Response
          }
          throw new Error(`Unexpected request: ${opts.url}`)
        }
      )

      const result =
        await backgroundSiteAdapter.background.series!.resolveSeriesData({
          seriesUrl: "https://mangamillion.shueisha.co.jp/en/title/1",
          rateLimitService: mockRateLimitService,
          siteIntegrationSettingsReader: {
            getAll: async () => ({}),
            getForSite: async () => ({}),
          },
        })

      expect(result.seriesId).toBe("1")
      expect(result.seriesMetadata?.title).toBe("One Piece")
      expect(result.seriesMetadata?.author).toBe("Eiichiro Oda")
      expect(result.seriesMetadata?.language).toBe("en")

      const chapters = result.chapterList as Chapter[]
      expect(chapters).toHaveLength(1)
      expect(chapters[0].id).toBe("6736")
      expect(chapters[0].title).toBe("Chapter 1:Romance Dawn")
      expect(chapters[0].chapterNumber).toBe(1)
      expect(chapters[0].chapterLabel).toBe("#001")
      expect(chapters[0].locked).toBe(false)
      expect(chapters[0].comicInfo.Series).toBe("One Piece")
    })
  })

  describe("Offscreen Resolver and Downloader", () => {
    it("resolves chapter image plan with encryption parameters", async () => {
      setCachedDeviceTokenForTesting("test-token")

      const pageBytes = [
        ...encodeString(
          1,
          "https://img.mangamillion.shueisha.co.jp/en/translated_chapter_page/6736/1.webp.enc"
        ),
        ...encodeInt32(2, 1080),
        ...encodeInt32(3, 1620),
      ]

      const viewerBytes = [
        ...encodeMessage(1, pageBytes),
        ...encodeString(
          7,
          "8c12434255319a2a5fb903fc39994f409eb27979d1d78f1009f1a015f69db321"
        ),
        ...encodeString(8, "4af66d450c1244868dc4a5cff035898c"),
      ]

      const viewerBuf = new Uint8Array([
        ...encodeInt32(1, 0),
        ...encodeMessage(70, viewerBytes),
      ])

      vi.spyOn(integrationHttpClient, "request").mockResolvedValue({
        ok: true,
        status: 200,
        arrayBuffer: async () => viewerBuf.buffer,
      } as unknown as Response)

      const plan =
        await offscreenSiteAdapter.offscreen.chapter.resolveChapterPlan(
          {
            id: "6736",
            url: "https://mangamillion.shueisha.co.jp/en/title/1/chapter/6736",
          },
          {
            runtime: {
              chapterId: "6736",
              rateLimitService: mockRateLimitService,
              rateLimitSettings,
            },
          }
        )

      expect(plan.imageUrls).toHaveLength(1)
      expect(plan.imageUrls[0]).toContain(
        "https://img.mangamillion.shueisha.co.jp/en/translated_chapter_page/6736/1.webp.enc#k="
      )
      expect(plan.imageUrls[0]).toContain(
        "&iv=4af66d450c1244868dc4a5cff035898c"
      )
    })

    it("downloads and decrypts chapter image", async () => {
      const keyHex =
        "8c12434255319a2a5fb903fc39994f409eb27979d1d78f1009f1a015f69db321"
      const ivHex = "4af66d450c1244868dc4a5cff035898c"

      const plainText = new TextEncoder().encode(
        "RIFF____WEBPDecryptedPageContent"
      )

      const keyBytes = hexToBytes(keyHex)
      const ivBytes = hexToBytes(ivHex)
      const cryptoKey = await globalThis.crypto.subtle.importKey(
        "raw",
        keyBytes as unknown as BufferSource,
        { name: "AES-CBC" },
        false,
        ["encrypt"]
      )
      const encryptedBuffer = await globalThis.crypto.subtle.encrypt(
        { name: "AES-CBC", iv: ivBytes as unknown as BufferSource },
        cryptoKey,
        plainText
      )

      const requestSpy = vi
        .spyOn(integrationHttpClient, "request")
        .mockResolvedValue({
          ok: true,
          status: 200,
          headers: new Headers({ "content-type": "application/octet-stream" }),
          arrayBuffer: async () => encryptedBuffer,
        } as unknown as Response)

      const imageUrl = `https://img.mangamillion.shueisha.co.jp/en/translated_chapter_page/6736/1.webp.enc#k=${keyHex}&iv=${ivHex}`

      const downloaded =
        await offscreenSiteAdapter.offscreen.chapter.downloadImage(imageUrl, {
          runtime: {
            chapterId: "6736",
            rateLimitService: mockRateLimitService,
            rateLimitSettings,
          },
        })

      expect(downloaded.filename).toBe("1.webp")
      expect(downloaded.mimeType).toBe("image/webp")
      expect(new Uint8Array(downloaded.data)).toEqual(plainText)

      // Batch image downloads are already scheduled by chapter-image-downloads.
      // Re-scheduling through the shared limiter deadlocks it, so image requests
      // must bypass the rate limiter (skipRateLimit: true).
      const imageRequest = requestSpy.mock.calls.find(
        (call) => call[0].endpointId === "mangamillion-image"
      )
      expect(imageRequest?.[0].skipRateLimit).toBe(true)
    })
  })
})
