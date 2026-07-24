import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { decompressFromBase64 } from "@/src/site-integrations/manhuagui/lz-string"
import {
  MANHUAGUI_BASE_URL,
  parseChapterIdFromUrl,
  parseSeriesIdFromPath,
  toAbsoluteUrl,
} from "@/src/site-integrations/manhuagui/shared"
import { selectReaderHost } from "@/src/site-integrations/manhuagui/reader-config"

vi.mock("@/src/runtime/rate-limit", () => ({
  rateLimitedFetchForIntegration: vi.fn(async (url: string) => {
    throw new Error(`Unexpected fetch: ${url}`)
  }),
  rateLimitedFetchByUrlScope: vi.fn(async (url: string) => {
    throw new Error(`Unexpected fetch: ${url}`)
  }),
  scheduleForIntegrationScope: vi.fn(
    async (_integrationId: string, _scope: string, task: () => unknown) =>
      task()
  ),
  getRateLimitPolicyFromContext: vi.fn(() => undefined),
  getRateLimitPolicyFromSnapshot: vi.fn(() => undefined),
}))

vi.mock("@/src/runtime/logger", () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

const { compressToBase64 } = await import("../../shared/manhuagui-compress")

const SERIES_ID = "55555"
const CHAPTER_ID = "100001"
const CHAPTER_URL = `https://www.manhuagui.com/comic/${SERIES_ID}/${CHAPTER_ID}.html`

describe("Manhuagui site integration", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe("shared utilities", () => {
    it("exposes the correct base URL", () => {
      expect(MANHUAGUI_BASE_URL).toBe("https://www.manhuagui.com")
    })

    it("parses series id from /comic/{id} path", () => {
      expect(parseSeriesIdFromPath("/comic/55555/")).toBe("55555")
      expect(parseSeriesIdFromPath("/comic/55555")).toBe("55555")
      expect(parseSeriesIdFromPath("/comic/55555/100001.html")).toBeNull()
      expect(parseSeriesIdFromPath("/not-comic/55555")).toBeNull()
    })

    it("parses chapter id from chapter URL", () => {
      expect(parseChapterIdFromUrl(CHAPTER_URL)).toBe("100001")
      expect(
        parseChapterIdFromUrl(
          "https://www.manhuagui.com/comic/55555/100001_p2.html"
        )
      ).toBe("100001")
      expect(
        parseChapterIdFromUrl("https://www.manhuagui.com/comic/55555/")
      ).toBeNull()
      expect(parseChapterIdFromUrl("not-a-url")).toBeNull()
      expect(
        parseChapterIdFromUrl(
          "https://attacker.example/comic/55555/100001.html"
        )
      ).toBeNull()
    })

    it("resolves relative URLs to absolute", () => {
      expect(toAbsoluteUrl("/scripts/config_16.js")).toBe(
        "https://www.manhuagui.com/scripts/config_16.js"
      )
      expect(toAbsoluteUrl("//cf.mhgui.com/scripts/config_16.js")).toBe(
        "https://cf.mhgui.com/scripts/config_16.js"
      )
      expect(toAbsoluteUrl("https://example.com/path")).toBe(
        "https://example.com/path"
      )
      expect(toAbsoluteUrl("")).toBeUndefined()
      expect(toAbsoluteUrl(null)).toBeUndefined()
    })
  })

  describe("lz-string decompression", () => {
    it("round-trips a simple string through compress/decompress", () => {
      const original =
        '<div class="chapter"><ul><li><a href="/comic/55555/100001.html">第1话</a></li></ul></div>'
      const compressed = compressToBase64(original)
      const decompressed = decompressFromBase64(compressed)

      expect(decompressed).toBe(original)
    })

    it("returns null for empty string input", () => {
      expect(decompressFromBase64("")).toBeNull()
    })

    it("returns empty string for null input", () => {
      expect(decompressFromBase64(null as unknown as string)).toBe("")
    })

    it("decompresses a known compressed value", () => {
      const compressed = compressToBase64("test")
      expect(decompressFromBase64(compressed)).toBe("test")
    })
  })

  describe("reader-config", () => {
    it("fetches the reader config through the URL limiter without nesting the chapter scheduler", async () => {
      const { fetchReaderConfig } =
        await import("@/src/site-integrations/manhuagui/reader-config")
      const { rateLimitedFetchForIntegration, scheduleForIntegrationScope } =
        await import("@/src/runtime/rate-limit")

      vi.mocked(rateLimitedFetchForIntegration).mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "application/javascript" }),
        arrayBuffer: async () =>
          new TextEncoder().encode(
            'var c={curServ:0,curHost:0,picserv:[{name:"auto",hosts:[{h:"i",w:1}]}]};'
          ).buffer,
      } as Response)

      await expect(
        fetchReaderConfig(
          '<script src="https://cf.mhgui.com/scripts/config_16.js"></script>'
        )
      ).resolves.toMatchObject({ curServ: 0, curHost: 0 })

      expect(rateLimitedFetchForIntegration).toHaveBeenCalledWith(
        "manhuagui",
        "https://cf.mhgui.com/scripts/config_16.js",
        "chapter",
        { credentials: "omit" },
        undefined
      )
      expect(scheduleForIntegrationScope).not.toHaveBeenCalled()
    })

    it("selects the current host when it has non-zero weight", () => {
      const host = selectReaderHost({
        curHost: 0,
        curServ: 0,
        services: [{ name: "auto", hosts: [{ name: "eu", weight: 4 }] }],
      })
      expect(host).toBe("eu")
    })

    it("falls back to first host with weight > 0 when current host has zero weight", () => {
      const host = selectReaderHost({
        curHost: 0,
        curServ: 0,
        services: [
          {
            name: "auto",
            hosts: [
              { name: "i", weight: 0 },
              { name: "eu", weight: 4 },
            ],
          },
        ],
      })
      expect(host).toBe("eu")
    })

    it("rejects a config with no enabled image host", () => {
      expect(() =>
        selectReaderHost({
          curHost: 0,
          curServ: 0,
          services: [{ name: "auto", hosts: [{ name: "i", weight: 0 }] }],
        })
      ).toThrow("no enabled image hosts")
    })

    it("rejects an out-of-bounds service index", () => {
      expect(() =>
        selectReaderHost({
          curHost: 0,
          curServ: 99,
          services: [{ name: "auto", hosts: [{ name: "eu", weight: 1 }] }],
        })
      ).toThrow("selected service is unavailable")
    })
  })

  describe("chapter-viewer packed payload extraction", () => {
    it("extracts image URLs from a packed chapter HTML page", async () => {
      const {
        buildManhuaguiPackedPayloadScript,
        buildManhuaguiChapterPathSegment,
        buildManhuaguiChapterSlMetadata,
      } =
        await import("@/tests/e2e/fixtures/mock-data/site-integrations/manhuagui/api-fixtures")

      const imgData = {
        path: buildManhuaguiChapterPathSegment(SERIES_ID, CHAPTER_ID),
        files: ["page1.jpg", "page2.jpg", "page3.jpg"],
        sl: buildManhuaguiChapterSlMetadata(CHAPTER_ID),
      }
      const packedScript = buildManhuaguiPackedPayloadScript(imgData)
      const chapterHtml = `<!DOCTYPE html><html><head><script src="https://cf.mhgui.com/scripts/config_16.js"></script></head><body><script>${packedScript}</script></body></html>`

      const { resolveImageUrlsFromChapterHtml } =
        await import("@/src/site-integrations/manhuagui/chapter-viewer")
      const { rateLimitedFetchForIntegration } =
        await import("@/src/runtime/rate-limit")

      vi.mocked(rateLimitedFetchForIntegration).mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "application/javascript" }),
        json: async () => ({}),
        text: async () => "",
        arrayBuffer: async () =>
          new TextEncoder().encode(
            'var c={curServ:0,curHost:0,picserv:[{name:"auto",hosts:[{h:"i",w:1}]}]};'
          ).buffer,
        clone: function () {
          return this
        },
      } as Response)

      const urls = await resolveImageUrlsFromChapterHtml(chapterHtml)

      expect(urls).toHaveLength(3)
      expect(urls[0]).toContain("page1.jpg")
      expect(urls[0]).toContain("e=9999999999")
      expect(urls[0]).toContain("m=mock-sig-100001")
      expect(urls[1]).toContain("page2.jpg")
    })

    it("categorizes malformed packed JSON as a provider contract failure", async () => {
      const rawKeys = compressToBase64("placeholder")
      const html = `
        <script src="https://cf.mhgui.com/scripts/config_16.js"></script>
        <script>window["eval"](function(p,a,c,k,e,d){return p;}('SMH.imgData({"path":});',2,1,'${rawKeys}'['split']('|'),0,{}))</script>
      `
      const { resolveImageUrlsFromChapterHtml } =
        await import("@/src/site-integrations/manhuagui/chapter-viewer")
      const { rateLimitedFetchForIntegration } =
        await import("@/src/runtime/rate-limit")

      vi.mocked(rateLimitedFetchForIntegration).mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "application/javascript" }),
        arrayBuffer: async () =>
          new TextEncoder().encode(
            'var c={curServ:0,curHost:0,picserv:[{name:"auto",hosts:[{h:"i",w:1}]}]};'
          ).buffer,
      } as Response)

      await expect(resolveImageUrlsFromChapterHtml(html)).rejects.toMatchObject(
        {
          category: "provider_changed",
          message:
            "Manhuagui viewer data no longer matches the supported format.",
        }
      )
    })

    it("throws on age-gated chapter HTML without bypass", async () => {
      const html =
        '<html><body><div id="checkAdult"><p>本漫画包含敏感内容</p></div></body></html>'

      const { resolveImageUrlsFromChapterHtml } =
        await import("@/src/site-integrations/manhuagui/chapter-viewer")

      await expect(resolveImageUrlsFromChapterHtml(html)).rejects.toThrow(
        "complete the site consent prompt"
      )
    })

    it("throws on chapter HTML with no packed payload", async () => {
      const html = "<html><body><div>no scripts here</div></body></html>"

      const { resolveImageUrlsFromChapterHtml } =
        await import("@/src/site-integrations/manhuagui/chapter-viewer")

      await expect(resolveImageUrlsFromChapterHtml(html)).rejects.toMatchObject(
        {
          category: "provider_changed",
          message:
            "Manhuagui viewer data no longer matches the supported format.",
        }
      )
    })

    it("rejects a packed payload with an unsafe radix before unpacking", async () => {
      const rawKeys = compressToBase64("one|two")
      const html = `<script>window["eval"](function(p,a,c,k,e,d){return p;}('SMH.imgData({});',1,2,'${rawKeys}'['split']('|'),0,{}))</script>`
      const { resolveImageUrlsFromChapterHtml } =
        await import("@/src/site-integrations/manhuagui/chapter-viewer")

      await expect(resolveImageUrlsFromChapterHtml(html)).rejects.toThrow(
        "packed radix is out of bounds"
      )
    })

    it("fails when a relative image path has no official reader config", async () => {
      const {
        buildManhuaguiPackedPayloadScript,
        buildManhuaguiChapterPathSegment,
        buildManhuaguiChapterSlMetadata,
      } =
        await import("@/tests/e2e/fixtures/mock-data/site-integrations/manhuagui/api-fixtures")
      const packedScript = buildManhuaguiPackedPayloadScript({
        path: buildManhuaguiChapterPathSegment(SERIES_ID, CHAPTER_ID),
        files: ["page1.jpg"],
        sl: buildManhuaguiChapterSlMetadata(CHAPTER_ID),
      })
      const { resolveImageUrlsFromChapterHtml } =
        await import("@/src/site-integrations/manhuagui/chapter-viewer")

      await expect(
        resolveImageUrlsFromChapterHtml(`<script>${packedScript}</script>`)
      ).rejects.toMatchObject({
        category: "provider_changed",
        message:
          "Manhuagui viewer data no longer matches the supported format.",
      })
    })

    it("rejects reader config scripts on arbitrary origins", async () => {
      const {
        buildManhuaguiPackedPayloadScript,
        buildManhuaguiChapterPathSegment,
        buildManhuaguiChapterSlMetadata,
      } =
        await import("@/tests/e2e/fixtures/mock-data/site-integrations/manhuagui/api-fixtures")
      const packedScript = buildManhuaguiPackedPayloadScript({
        path: buildManhuaguiChapterPathSegment(SERIES_ID, CHAPTER_ID),
        files: ["page1.jpg"],
        sl: buildManhuaguiChapterSlMetadata(CHAPTER_ID),
      })
      const html = `<script src="https://attacker.example/scripts/config_16.js"></script><script>${packedScript}</script>`
      const { resolveImageUrlsFromChapterHtml } =
        await import("@/src/site-integrations/manhuagui/chapter-viewer")

      await expect(resolveImageUrlsFromChapterHtml(html)).rejects.toThrow(
        "reader config origin is not allowed"
      )
    })
  })

  describe("chapter-api", () => {
    it("processImageUrls filters invalid URLs", async () => {
      const { processManhuaguiImageUrls } =
        await import("@/src/site-integrations/manhuagui/chapter-api")

      const urls = await processManhuaguiImageUrls([
        "https://i.hamreus.com/ps1/f/page1.jpg?e=1&m=sig",
        "https://attacker.example/page1.jpg",
        "not-a-url",
      ])

      expect(urls).toEqual(["https://i.hamreus.com/ps1/f/page1.jpg?e=1&m=sig"])
    })

    it("offscreen image downloads use the outer image scheduler without re-entering the URL limiter", async () => {
      const { offscreenSiteAdapter } =
        await import("@/src/site-integrations/manhuagui/offscreen-runtime")
      const { rateLimitedFetchForIntegration } =
        await import("@/src/runtime/rate-limit")
      const payload = new Uint8Array([1, 2, 3, 4]).buffer
      const fetch = vi.fn(
        async (_input: RequestInfo | URL, _init?: RequestInit) =>
          ({
            ok: true,
            status: 200,
            statusText: "OK",
            headers: new Headers({ "content-type": "image/webp" }),
            body: null,
            arrayBuffer: async () => payload,
          }) as unknown as Response
      )
      vi.stubGlobal("fetch", fetch)

      const image = await offscreenSiteAdapter.offscreen.chapter.downloadImage(
        "https://i.hamreus.com/ps1/f/page1.jpg?e=1&m=sig",
        { signal: new AbortController().signal, context: undefined }
      )

      expect(image.filename).toBe("page1.jpg")
      expect(image.mimeType).toBe("image/webp")
      expect(rateLimitedFetchForIntegration).not.toHaveBeenCalled()
      const [, init] = fetch.mock.calls.at(-1) ?? []
      expect(init).toMatchObject({
        credentials: "include",
        referrer: "https://www.manhuagui.com/",
        referrerPolicy: "strict-origin-when-cross-origin",
        headers: {
          referer: "https://www.manhuagui.com/",
        },
      })
      expect((init as RequestInit | undefined)?.signal).toBeInstanceOf(
        AbortSignal
      )
    })

    it("parseManhuaguiImageUrlsFromHtml delegates to chapter-viewer", async () => {
      const {
        buildManhuaguiPackedPayloadScript,
        buildManhuaguiChapterPathSegment,
        buildManhuaguiChapterSlMetadata,
      } =
        await import("@/tests/e2e/fixtures/mock-data/site-integrations/manhuagui/api-fixtures")

      const imgData = {
        path: buildManhuaguiChapterPathSegment(SERIES_ID, CHAPTER_ID),
        files: ["page1.jpg"],
        sl: buildManhuaguiChapterSlMetadata(CHAPTER_ID),
      }
      const packedScript = buildManhuaguiPackedPayloadScript(imgData)
      const chapterHtml = `<!DOCTYPE html><html><head><script src="https://cf.mhgui.com/scripts/config_16.js"></script></head><body><script>${packedScript}</script></body></html>`

      const { parseManhuaguiImageUrlsFromHtml } =
        await import("@/src/site-integrations/manhuagui/chapter-api")
      const { rateLimitedFetchForIntegration } =
        await import("@/src/runtime/rate-limit")

      vi.mocked(rateLimitedFetchForIntegration).mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "application/javascript" }),
        json: async () => ({}),
        text: async () => "",
        arrayBuffer: async () =>
          new TextEncoder().encode(
            'var c={curServ:0,curHost:0,picserv:[{name:"auto",hosts:[{h:"i",w:1}]}]};'
          ).buffer,
        clone: function () {
          return this
        },
      } as Response)

      const urls = await parseManhuaguiImageUrlsFromHtml({
        chapterId: CHAPTER_ID,
        chapterUrl: CHAPTER_URL,
        chapterHtml,
      })

      expect(urls).toHaveLength(1)
      expect(urls[0]).toContain("page1.jpg")
    })
  })
})
