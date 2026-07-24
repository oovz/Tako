import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  buildComicNettaiViewerApiUrl,
  extractComicNettaiBookContentId,
  parseComicNettaiSeriesIdFromPath,
  parseComicNettaiViewerCid,
} from "@/src/site-integrations/comicnettai/shared"
import {
  buildPublusImageUrlsFromConfig,
  downloadComicNettaiChapterImage,
  processComicNettaiImageUrls,
  resolveComicNettaiChapterImageUrls,
} from "@/src/site-integrations/comicnettai/chapter-api"
import {
  buildPublusPageTileRects,
  descramblePublusImage,
  parsePublusImageTransportUrl,
} from "@/src/site-integrations/comicnettai/publus-image"
import {
  extractComicNettaiSeriesMetadataFromDocument,
  extractComicNettaiChapterListFromDocument,
  extractComicNettaiChapterListWithPagination,
  loadComicNettaiPaginationDocument,
} from "@/src/site-integrations/comicnettai/series-dom"
import * as rateLimit from "@/src/runtime/rate-limit"

const LIVE_PUBLUS_KEYS = {
  key1: "77fb2c670460a4daeb0463c40976806a63750720ceb768cf43031fca8f3eb5e2",
  key2: "49840499d31b5b7bffadf76a48b1308b25f6c2ed154d91f66abc7764ec9029d2",
  key3: "f7cccf3b883fb488f842ec6afc7129a5ded56bd98143c6bfd6951a958f2843e1",
} as const

const LIVE_PUBLUS_CONFIG = {
  configuration: {
    "file-name-version": "1.0",
    keys: LIVE_PUBLUS_KEYS,
    contents: [
      {
        file: "item/xhtml/p-cover.xhtml",
        index: 1,
        "original-file-path": "item/xhtml/p-cover.xhtml",
        type: "jpeg",
      },
      {
        file: "item/xhtml/p-000.xhtml",
        index: 2,
        "original-file-path": "item/xhtml/p-000.xhtml",
        type: "jpeg",
      },
      {
        file: "item/xhtml/p-001.xhtml",
        index: 3,
        "original-file-path": "item/xhtml/p-001.xhtml",
        type: "jpeg",
      },
    ],
  },
  "item/xhtml/p-cover.xhtml": {
    FileLinkInfo: {
      PageLinkInfoList: [
        {
          Page: {
            No: 0,
            NS: 492551829,
            PS: 1062163659,
            RS: 1425211224,
            BlockWidth: 32,
            BlockHeight: 32,
          },
        },
      ],
    },
  },
  "item/xhtml/p-000.xhtml": {
    FileLinkInfo: {
      PageLinkInfoList: [
        {
          Page: {
            No: 0,
            NS: 3426648385,
            PS: 2558111233,
            RS: 4130047053,
            BlockWidth: 32,
            BlockHeight: 32,
          },
        },
      ],
    },
  },
  "item/xhtml/p-001.xhtml": {
    FileLinkInfo: {
      PageLinkInfoList: [
        {
          Page: {
            No: 0,
            NS: 3964085832,
            PS: 2712502983,
            RS: 3995491631,
            BlockWidth: 32,
            BlockHeight: 32,
          },
        },
      ],
    },
  },
} as const

describe("Comic Nettai site integration", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("extracts the series id from /book/{id} URLs only", () => {
    expect(parseComicNettaiSeriesIdFromPath("/book/9")).toBe("9")
    expect(parseComicNettaiSeriesIdFromPath("/book/9/")).toBe("9")
    expect(parseComicNettaiSeriesIdFromPath("/publus/viewer.html")).toBeNull()
    expect(parseComicNettaiSeriesIdFromPath("/book/not-numeric")).toBeNull()
  })

  it("uses the book content thumbnail directory as the stable chapter id", () => {
    expect(
      extractComicNettaiBookContentId(
        "https://cdn.comicnettai.com/9_hash/book_contents/958/icon_chap46.jpg"
      )
    ).toBe("958")
    expect(
      extractComicNettaiBookContentId("https://cdn.comicnettai.com/cover.jpg")
    ).toBeNull()
    expect(
      extractComicNettaiBookContentId(
        "https://attacker.example/9_hash/book_contents/958/icon_chap46.jpg"
      )
    ).toBeNull()
  })

  it("extracts viewer cids and builds the official viewer content-check API URL", () => {
    const chapterUrl =
      "https://www.comicnettai.com/publus/viewer.html?cid=mock-cid"

    expect(parseComicNettaiViewerCid(chapterUrl)).toBe("mock-cid")
    expect(buildComicNettaiViewerApiUrl(chapterUrl)).toBe(
      "https://www.comicnettai.com/api/viewer/c?cid=mock-cid"
    )
  })

  it("derives PUBLUS image URLs from decoded configuration data", () => {
    const urls = buildPublusImageUrlsFromConfig(
      "https://cdn.comicnettai.com/9_hash/epub/book_contents/c958/",
      LIVE_PUBLUS_CONFIG
    )

    expect(
      urls.map((url) => parsePublusImageTransportUrl(url).sourceUrl)
    ).toEqual([
      "https://cdn.comicnettai.com/9_hash/epub/book_contents/c958/item/xhtml/p-cover.xhtml/106858d4a8cf8d2165.jpeg",
      "https://cdn.comicnettai.com/9_hash/epub/book_contents/c958/item/xhtml/p-000.xhtml/1016cec4222ae82a25.jpeg",
      "https://cdn.comicnettai.com/9_hash/epub/book_contents/c958/item/xhtml/p-001.xhtml/1039055a13d52f0869.jpeg",
    ])
    expect(parsePublusImageTransportUrl(urls[0]!).metadata).toMatchObject({
      mode: 372,
      seed1: 2734906895,
      seed2: 3927281451,
      seed3: 1733819256,
      tileWidth: 32,
      tileHeight: 32,
    })
  })

  it("builds the same PUBLUS tile rectangles as the official Comic Nettai viewer", () => {
    const rects = buildPublusPageTileRects({
      sourceWidth: 920,
      sourceHeight: 1304,
      mode: 372,
      seed1: 2734906895,
      seed2: 3927281451,
      seed3: 1733819256,
      tileWidth: 32,
      tileHeight: 32,
    })

    expect(rects).toHaveLength(1189)
    expect(rects.slice(0, 8)).toEqual([
      { srcX: 0, srcY: 0, destX: 32, destY: 856, width: 32, height: 32 },
      { srcX: 0, srcY: 32, destX: 824, destY: 568, width: 32, height: 32 },
      { srcX: 0, srcY: 64, destX: 760, destY: 440, width: 32, height: 32 },
      { srcX: 0, srcY: 96, destX: 824, destY: 160, width: 32, height: 32 },
      { srcX: 0, srcY: 128, destX: 64, destY: 288, width: 32, height: 32 },
      { srcX: 0, srcY: 160, destX: 440, destY: 32, width: 32, height: 32 },
      { srcX: 0, srcY: 192, destX: 512, destY: 1176, width: 32, height: 32 },
      { srcX: 0, srcY: 224, destX: 160, destY: 792, width: 32, height: 32 },
    ])
    expect(rects.slice(-8)).toEqual([
      { srcX: 512, srcY: 1024, destX: 320, destY: 960, width: 24, height: 32 },
      { srcX: 512, srcY: 1056, destX: 192, destY: 160, width: 24, height: 32 },
      { srcX: 320, srcY: 1112, destX: 288, destY: 1144, width: 24, height: 32 },
      { srcX: 544, srcY: 1144, destX: 128, destY: 1272, width: 24, height: 32 },
      { srcX: 416, srcY: 1176, destX: 352, destY: 576, width: 24, height: 32 },
      { srcX: 64, srcY: 1208, destX: 288, destY: 608, width: 24, height: 32 },
      { srcX: 512, srcY: 1240, destX: 288, destY: 1016, width: 24, height: 32 },
      { srcX: 224, srcY: 1272, destX: 160, destY: 256, width: 24, height: 32 },
    ])
  })

  it("fetches viewer metadata and configuration_pack.json to resolve image URLs", async () => {
    const scheduleSpy = vi.spyOn(rateLimit, "scheduleForIntegrationScope")
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "https://www.comicnettai.com/api/viewer/c?cid=mock-cid") {
        return new Response(
          JSON.stringify({
            status: "200",
            url: "https://cdn.comicnettai.com/9_hash/epub/book_contents/c958/",
            cti: "第46話",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      }

      if (
        url ===
        "https://cdn.comicnettai.com/9_hash/epub/book_contents/c958/configuration_pack.json"
      ) {
        return new Response(JSON.stringify(LIVE_PUBLUS_CONFIG), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      }

      throw new Error(`Unexpected fetch URL: ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      resolveComicNettaiChapterImageUrls({
        id: "958",
        url: "https://www.comicnettai.com/publus/viewer.html?cid=mock-cid",
      })
    ).resolves.toHaveLength(3)
    expect(scheduleSpy).toHaveBeenCalledWith(
      "comicnettai",
      "chapter",
      expect.any(Function),
      undefined
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://cdn.comicnettai.com/9_hash/epub/book_contents/c958/configuration_pack.json",
      expect.objectContaining({ credentials: "omit" })
    )
  })

  it("rejects viewer-provided configuration origins outside the Comic Nettai CDN", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ status: "200", url: "https://attacker.example/" }),
            { status: 200, headers: { "content-type": "application/json" } }
          )
      )
    )

    await expect(
      resolveComicNettaiChapterImageUrls({
        id: "958",
        url: "https://www.comicnettai.com/publus/viewer.html?cid=mock-cid",
      })
    ).rejects.toThrow("trusted Comic Nettai CDN")
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it("reports viewer status failures as canonical non-retryable HTTP errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ status: "404" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
      )
    )

    await expect(
      resolveComicNettaiChapterImageUrls({
        id: "958",
        url: "https://www.comicnettai.com/publus/viewer.html?cid=expired",
      })
    ).rejects.toThrow("HTTP 404")
  })

  it("classifies a malformed viewer payload as provider drift", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({}), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
      )
    )

    await expect(
      resolveComicNettaiChapterImageUrls({
        id: "958",
        url: "https://www.comicnettai.com/publus/viewer.html?cid=malformed",
      })
    ).rejects.toMatchObject({
      category: "provider_changed",
      message: expect.stringContaining("invalid viewer response"),
    })
  })

  it("filters invalid image candidates and rejects images without reconstruction metadata", async () => {
    await expect(
      processComicNettaiImageUrls([
        "https://cdn.comicnettai.com/page.jpeg",
        "https://attacker.example/page.jpeg",
        "not-a-url",
      ])
    ).resolves.toEqual(["https://cdn.comicnettai.com/page.jpeg"])

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
            status: 200,
            headers: { "content-type": "image/png" },
          })
      )
    )

    await expect(
      downloadComicNettaiChapterImage("https://cdn.comicnettai.com/page.png")
    ).rejects.toThrow("reconstruction metadata is missing")
    expect(fetch).not.toHaveBeenCalled()
  })

  it("returns the MIME type produced by PUBLUS descrambling", async () => {
    const [transportUrl] = buildPublusImageUrlsFromConfig(
      "https://cdn.comicnettai.com/9_hash/epub/book_contents/c958/",
      LIVE_PUBLUS_CONFIG
    )
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new Uint8Array([1, 2, 3, 4]), {
            status: 200,
            headers: { "content-type": "image/gif" },
          })
      )
    )
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 32, height: 32, close: vi.fn() }))
    )
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        constructor(
          public width: number,
          public height: number
        ) {}
        getContext() {
          return { imageSmoothingEnabled: true, drawImage: vi.fn() }
        }
        convertToBlob() {
          return Promise.resolve(
            new Blob([new Uint8Array([4, 5, 6])], { type: "image/png" })
          )
        }
      }
    )

    try {
      const image = await downloadComicNettaiChapterImage(transportUrl)
      expect(image.mimeType).toBe("image/png")
      expect(new Uint8Array(image.data)).toEqual(new Uint8Array([4, 5, 6]))
    } finally {
      vi.unstubAllGlobals()
    }
  })

  describe("buildPublusImageUrlsFromConfig edge cases", () => {
    const BASE_URL =
      "https://cdn.comicnettai.com/9_hash/epub/book_contents/c958/"

    it("throws when configuration keys are missing", () => {
      const config = {
        ...LIVE_PUBLUS_CONFIG,
        configuration: { ...LIVE_PUBLUS_CONFIG.configuration, keys: {} },
      }

      expect(() => buildPublusImageUrlsFromConfig(BASE_URL, config)).toThrow(
        "Comic Nettai PUBLUS configuration keys are missing"
      )
    })

    it("returns empty array when contents is empty", () => {
      const config = {
        ...LIVE_PUBLUS_CONFIG,
        configuration: { ...LIVE_PUBLUS_CONFIG.configuration, contents: [] },
      }

      expect(buildPublusImageUrlsFromConfig(BASE_URL, config)).toEqual([])
    })

    it("filters out content items missing file or type", () => {
      const config = {
        ...LIVE_PUBLUS_CONFIG,
        configuration: {
          ...LIVE_PUBLUS_CONFIG.configuration,
          contents: [
            { file: "item/xhtml/p-cover.xhtml", index: 1, type: "jpeg" },
            { index: 2, type: "jpeg" } as {
              file: string
              index: number
              type: string
            },
            { file: "item/xhtml/p-000.xhtml", index: 3 } as {
              file: string
              index: number
              type: string
            },
          ],
        },
      }

      const urls = buildPublusImageUrlsFromConfig(BASE_URL, config)
      expect(urls).toHaveLength(1)
    })

    it("sorts contents by index before building URLs", () => {
      const config = {
        ...LIVE_PUBLUS_CONFIG,
        configuration: {
          ...LIVE_PUBLUS_CONFIG.configuration,
          contents: [
            { file: "item/xhtml/p-001.xhtml", index: 3, type: "jpeg" },
            { file: "item/xhtml/p-cover.xhtml", index: 1, type: "jpeg" },
            { file: "item/xhtml/p-000.xhtml", index: 2, type: "jpeg" },
          ],
        },
      }

      const urls = buildPublusImageUrlsFromConfig(BASE_URL, config)
      expect(urls).toHaveLength(3)
      expect(parsePublusImageTransportUrl(urls[0]!).sourceUrl).toContain(
        "p-cover"
      )
      expect(parsePublusImageTransportUrl(urls[1]!).sourceUrl).toContain(
        "p-000"
      )
      expect(parsePublusImageTransportUrl(urls[2]!).sourceUrl).toContain(
        "p-001"
      )
    })

    it("fails closed when a content item has no reconstruction metadata", () => {
      const config = {
        ...LIVE_PUBLUS_CONFIG,
        configuration: {
          ...LIVE_PUBLUS_CONFIG.configuration,
          contents: [
            { file: "item/xhtml/p-cover.xhtml", index: 1, type: "jpeg" },
            { file: "item/xhtml/nonexistent.xhtml", index: 2, type: "jpeg" },
          ],
        },
      }

      expect(() => buildPublusImageUrlsFromConfig(BASE_URL, config)).toThrow(
        "reconstruction metadata is missing"
      )
    })

    it("rejects absolute content paths and unsupported image types", () => {
      const absolutePathConfig = {
        ...LIVE_PUBLUS_CONFIG,
        configuration: {
          ...LIVE_PUBLUS_CONFIG.configuration,
          contents: [
            {
              file: "https://attacker.example/page",
              index: 1,
              type: "jpeg",
            },
          ],
        },
      }
      expect(() =>
        buildPublusImageUrlsFromConfig(BASE_URL, absolutePathConfig)
      ).toThrow("invalid content path")

      const unsupportedTypeConfig = {
        ...LIVE_PUBLUS_CONFIG,
        configuration: {
          ...LIVE_PUBLUS_CONFIG.configuration,
          contents: [
            {
              file: "item/xhtml/p-cover.xhtml",
              index: 1,
              type: "svg",
            },
          ],
        },
      }
      expect(() =>
        buildPublusImageUrlsFromConfig(BASE_URL, unsupportedTypeConfig)
      ).toThrow("unsupported image type")
    })
  })

  it("fails rather than returning scrambled bytes when reconstruction is unavailable", async () => {
    vi.stubGlobal("createImageBitmap", undefined)
    vi.stubGlobal("OffscreenCanvas", undefined)

    await expect(
      descramblePublusImage(new ArrayBuffer(4), "image/jpeg", {
        mode: 1,
        seed1: 2,
        seed2: 3,
        seed3: 4,
        tileWidth: 32,
        tileHeight: 32,
      })
    ).rejects.toThrow("reconstruction is unavailable")
  })

  describe("series-dom extraction", () => {
    function makeElement(opts: {
      textContent?: string
      href?: string
      classList?: string[]
      src?: string
      dataSrc?: string
      alt?: string
      closed?: boolean
      getAttribute?: (name: string) => string | null
    }) {
      return {
        textContent: opts.textContent ?? "",
        getAttribute:
          opts.getAttribute ??
          ((name: string) => {
            if (name === "href") return opts.href ?? null
            if (name === "data-src") return opts.dataSrc ?? null
            if (name === "content") return opts.textContent ?? null
            return null
          }),
        classList: {
          contains: (cls: string) => (opts.classList ?? []).includes(cls),
        },
        src: opts.src ?? "",
        alt: opts.alt ?? "",
        querySelector: vi.fn((selector: string) => {
          if (selector === ".detail--product__thum") {
            return opts.dataSrc || opts.src
              ? {
                  getAttribute: (name: string) =>
                    name === "data-src" ? (opts.dataSrc ?? null) : null,
                  src: opts.src ?? "",
                  alt: opts.alt ?? "",
                }
              : null
          }
          if (selector === ".detail--product__item__title") {
            return opts.textContent ? { textContent: opts.textContent } : null
          }
          return null
        }),
      }
    }

    function makeDocument(opts: {
      title?: string
      author?: string
      description?: string
      coverUrl?: string
      ogTitle?: string
      ogDescription?: string
      ogImage?: string
      metaDescription?: string
      chapters?: Array<{
        href?: string
        title: string
        open?: boolean
        closed?: boolean
        thumbnailDataSrc?: string
        thumbnailSrc?: string
        thumbnailAlt?: string
      }>
      paginationHrefs?: string[]
    }) {
      const querySelector = vi.fn((selector: string) => {
        if (selector === ".detail--title")
          return opts.title ? { textContent: opts.title } : null
        if (selector === ".detail__author__item")
          return opts.author ? { textContent: opts.author } : null
        if (selector === ".detail--discription")
          return opts.description ? { textContent: opts.description } : null
        if (selector === 'meta[property="og:title"]')
          return opts.ogTitle ? { getAttribute: () => opts.ogTitle! } : null
        if (selector === 'meta[name="description"]')
          return opts.metaDescription
            ? { getAttribute: () => opts.metaDescription! }
            : null
        if (selector === 'meta[property="og:description"]')
          return opts.ogDescription
            ? { getAttribute: () => opts.ogDescription! }
            : null
        if (selector === 'meta[property="og:image"]')
          return opts.ogImage ? { getAttribute: () => opts.ogImage! } : null
        if (selector === ".detail-catch__img")
          return opts.coverUrl ? { src: opts.coverUrl } : null
        return null
      })

      const querySelectorAll = vi.fn((selector: string) => {
        if (
          selector === "a.detail--product__item[href]" ||
          selector === ".detail--product__item"
        ) {
          const chapters =
            selector === "a.detail--product__item[href]"
              ? (opts.chapters ?? []).filter((chapter) => chapter.href)
              : (opts.chapters ?? [])
          return chapters.map((ch) =>
            makeElement({
              href: ch.href,
              textContent: ch.title,
              classList: ch.open ? ["is-open"] : ch.closed ? ["is-close"] : [],
              dataSrc: ch.thumbnailDataSrc,
              src: ch.thumbnailSrc,
              alt: ch.thumbnailAlt,
              closed: ch.closed,
              getAttribute: (name: string) => {
                if (name === "href") return ch.href ?? null
                if (name === "data-src") return ch.thumbnailDataSrc ?? null
                return null
              },
            })
          )
        }
        if (selector === 'a[href*="page="]') {
          return (opts.paginationHrefs ?? []).map((href) => ({
            getAttribute: (name: string) => (name === "href" ? href : null),
          }))
        }
        return []
      })

      return { querySelector, querySelectorAll } as unknown as Document
    }

    it("extracts series metadata from DOM selectors", () => {
      const doc = makeDocument({
        title: "Test Manga",
        author: "Test Author",
        description: "A test manga description",
        coverUrl: "https://cdn.comicnettai.com/cover.jpg",
      })

      const metadata = extractComicNettaiSeriesMetadataFromDocument(doc)
      expect(metadata).toMatchObject({
        title: "Test Manga",
        author: "Test Author",
        description: "A test manga description",
        coverUrl: "https://cdn.comicnettai.com/cover.jpg",
        language: "ja",
        readingDirection: "rtl",
      })
    })

    it("falls back to OpenGraph title when .detail--title is missing", () => {
      const doc = makeDocument({
        ogTitle: "Test Manga - Comic Nettai",
        ogImage: "https://cdn.comicnettai.com/og.jpg",
      })

      const metadata = extractComicNettaiSeriesMetadataFromDocument(doc)
      expect(metadata.title).toBe("Test Manga")
      expect(metadata.coverUrl).toBe("https://cdn.comicnettai.com/og.jpg")
    })

    it("throws when no title can be found", () => {
      const doc = makeDocument({})
      expect(() => extractComicNettaiSeriesMetadataFromDocument(doc)).toThrow(
        "Comic Nettai series title not found in page DOM"
      )
    })

    it("extracts chapter list from anchor elements", () => {
      const doc = makeDocument({
        title: "Test Manga",
        chapters: [
          {
            href: "/publus/viewer.html?cid=chap1",
            title: "第1話",
            open: true,
            thumbnailDataSrc:
              "https://cdn.comicnettai.com/9_hash/book_contents/100/icon_1.jpg",
          },
          {
            title: "第40話",
            closed: true,
            thumbnailDataSrc:
              "https://cdn.comicnettai.com/9_hash/book_contents/829/chap40_icon.jpg",
          },
        ],
      })

      const result = extractComicNettaiChapterListFromDocument(doc)
      const chapters = Array.isArray(result) ? result : result.chapters
      expect(chapters).toHaveLength(2)
      expect(chapters[0]).toMatchObject({
        id: "100",
        url: "https://www.comicnettai.com/publus/viewer.html?cid=chap1",
        title: "第1話",
        locked: false,
        language: "ja",
        chapterNumber: 1,
      })
      expect(chapters[1]).toMatchObject({
        id: "829",
        url: "https://www.comicnettai.com/book/9#book-content-829",
        title: "第40話",
        locked: true,
        chapterNumber: 40,
      })
    })

    it("rejects an open chapter with an invalid viewer URL", () => {
      const doc = makeDocument({
        title: "Test Manga",
        chapters: [
          { href: "/invalid-url", title: "Invalid" },
          { href: "/publus/viewer.html?cid=valid", title: "Valid", open: true },
        ],
      })

      expect(() => extractComicNettaiChapterListFromDocument(doc)).toThrow(
        "Comic Nettai open chapter is missing a valid viewer URL"
      )
    })

    it("falls back to the trusted viewer cid when the thumbnail host is untrusted", () => {
      const doc = makeDocument({
        title: "Test Manga",
        chapters: [
          {
            href: "/publus/viewer.html?cid=trusted-viewer-cid",
            title: "第1話",
            open: true,
            thumbnailDataSrc:
              "https://attacker.example/9_hash/book_contents/999/icon_1.jpg",
          },
        ],
      })

      const result = extractComicNettaiChapterListFromDocument(doc)
      const chapters = Array.isArray(result) ? result : result.chapters
      expect(chapters).toEqual([
        expect.objectContaining({
          id: "trusted-viewer-cid",
          url: "https://www.comicnettai.com/publus/viewer.html?cid=trusted-viewer-cid",
          locked: false,
        }),
      ])
    })

    it("does not retain an untrusted URL for a structurally closed chapter", () => {
      const doc = makeDocument({
        title: "Test Manga",
        chapters: [
          {
            href: "https://attacker.example/publus/viewer.html?cid=expired",
            title: "第40話",
            closed: true,
            thumbnailDataSrc:
              "https://cdn.comicnettai.com/9_hash/book_contents/829/chap40_icon.jpg",
          },
        ],
      })

      const result = extractComicNettaiChapterListFromDocument(doc)
      const chapters = Array.isArray(result) ? result : result.chapters
      expect(chapters).toEqual([
        expect.objectContaining({
          id: "829",
          url: "https://www.comicnettai.com/book/9#book-content-829",
          locked: true,
        }),
      ])
    })

    it("deduplicates chapters by id", () => {
      const doc = makeDocument({
        title: "Test Manga",
        chapters: [
          { href: "/publus/viewer.html?cid=dup", title: "First", open: true },
          { href: "/publus/viewer.html?cid=dup", title: "Second", open: true },
        ],
      })

      const result = extractComicNettaiChapterListFromDocument(doc)
      const chapters = Array.isArray(result) ? result : result.chapters
      expect(chapters).toHaveLength(1)
    })

    it("includes the current DOM and follows all discovered series pagination pages", async () => {
      const firstPage = makeDocument({
        title: "Test Manga",
        chapters: [
          { href: "/publus/viewer.html?cid=new", title: "第3話", open: true },
        ],
        paginationHrefs: ["/book/9?page=2"],
      })
      const secondPage = makeDocument({
        title: "Test Manga",
        chapters: [
          {
            href: "/publus/viewer.html?cid=middle",
            title: "第2話",
            open: true,
          },
        ],
        paginationHrefs: ["/book/9?page=1", "/book/9?page=3"],
      })
      const thirdPage = makeDocument({
        title: "Test Manga",
        chapters: [
          { href: "/publus/viewer.html?cid=old", title: "第1話", open: true },
        ],
        paginationHrefs: ["/book/9?page=2"],
      })
      const loadDocument = vi.fn(async (url: string) => {
        if (url.endsWith("page=2")) return secondPage
        if (url.endsWith("page=3")) return thirdPage
        throw new Error(`Unexpected page URL: ${url}`)
      })

      const result = await extractComicNettaiChapterListWithPagination(
        firstPage,
        "https://www.comicnettai.com/book/9",
        loadDocument
      )

      const chapters = Array.isArray(result) ? result : result.chapters
      expect(chapters.map((chapter) => chapter.id)).toEqual([
        "new",
        "middle",
        "old",
      ])
      expect(loadDocument).toHaveBeenCalledTimes(2)
    })

    it("ignores disabled or malformed pagination controls while loading valid pages", async () => {
      const firstPage = makeDocument({
        chapters: [
          { href: "/publus/viewer.html?cid=new", title: "第2話", open: true },
        ],
        paginationHrefs: [
          "/book/9?page=0",
          "/book/9?page=not-a-page",
          "/book/9?page=2",
        ],
      })
      const secondPage = makeDocument({
        chapters: [
          { href: "/publus/viewer.html?cid=old", title: "第1話", open: true },
        ],
      })
      const loadDocument = vi.fn(async () => secondPage)

      const result = await extractComicNettaiChapterListWithPagination(
        firstPage,
        "https://www.comicnettai.com/book/9",
        loadDocument
      )

      const chapters = Array.isArray(result) ? result : result.chapters
      expect(chapters.map((chapter) => chapter.id)).toEqual(["new", "old"])
      expect(loadDocument).toHaveBeenCalledOnce()
      expect(loadDocument).toHaveBeenCalledWith(
        "https://www.comicnettai.com/book/9?page=2"
      )
    })

    it("starts independently discovered pagination pages concurrently", async () => {
      const firstPage = makeDocument({
        title: "Test Manga",
        chapters: [
          { href: "/publus/viewer.html?cid=new", title: "第3話", open: true },
        ],
        paginationHrefs: ["/book/9?page=2", "/book/9?page=3"],
      })
      const secondPage = makeDocument({
        chapters: [
          {
            href: "/publus/viewer.html?cid=middle",
            title: "第2話",
            open: true,
          },
        ],
      })
      const thirdPage = makeDocument({
        chapters: [
          { href: "/publus/viewer.html?cid=old", title: "第1話", open: true },
        ],
      })
      const resolvers = new Map<string, (document: Document) => void>()
      const loadDocument = vi.fn(
        (url: string) =>
          new Promise<Document>((resolve) => {
            resolvers.set(url, resolve)
          })
      )

      const resultPromise = extractComicNettaiChapterListWithPagination(
        firstPage,
        "https://www.comicnettai.com/book/9",
        loadDocument
      )
      await vi.waitFor(() => expect(loadDocument).toHaveBeenCalledTimes(2))

      resolvers.get("https://www.comicnettai.com/book/9?page=2")!(secondPage)
      resolvers.get("https://www.comicnettai.com/book/9?page=3")!(thirdPage)
      const result = await resultPromise
      const chapters = Array.isArray(result) ? result : result.chapters
      expect(chapters.map((chapter) => chapter.id)).toEqual([
        "new",
        "middle",
        "old",
      ])
    })

    it("aborts a stalled default pagination request after its deadline", async () => {
      vi.useFakeTimers()
      let observedSignal: AbortSignal | undefined
      vi.stubGlobal(
        "fetch",
        vi.fn((_url: string, init?: RequestInit) => {
          observedSignal = init?.signal ?? undefined
          return new Promise<Response>((_resolve, reject) => {
            observedSignal?.addEventListener("abort", () => {
              reject(observedSignal?.reason)
            })
          })
        })
      )
      const firstPage = makeDocument({
        paginationHrefs: ["/book/9?page=2"],
      })

      const resultPromise = extractComicNettaiChapterListWithPagination(
        firstPage,
        "https://www.comicnettai.com/book/9"
      )
      const rejection = expect(resultPromise).rejects.toThrow(
        "Comic Nettai pagination request timed out"
      )
      await vi.advanceTimersByTimeAsync(15_000)
      expect(observedSignal).toBeInstanceOf(AbortSignal)
      expect(observedSignal?.aborted).toBe(true)
      await rejection
    })

    it("uses the integration URL limiter and browser-managed credentials for pagination", async () => {
      const fetchForIntegration = vi
        .spyOn(rateLimit, "rateLimitedFetchForIntegration")
        .mockResolvedValue(
          new Response("<html><body></body></html>", { status: 200 })
        )
      const parsedDocument = { querySelector: vi.fn() } as unknown as Document
      const parseFromString = vi.fn(() => parsedDocument)
      vi.stubGlobal(
        "DOMParser",
        class {
          parseFromString = parseFromString
        }
      )

      await expect(
        loadComicNettaiPaginationDocument(
          "https://www.comicnettai.com/book/9?page=2"
        )
      ).resolves.toBe(parsedDocument)

      expect(fetchForIntegration).toHaveBeenCalledWith(
        "comicnettai",
        "https://www.comicnettai.com/book/9?page=2",
        "chapter",
        expect.objectContaining({
          credentials: "include",
          redirect: "error",
          signal: expect.any(AbortSignal),
        })
      )
      expect(parseFromString).toHaveBeenCalledWith(
        "<html><body></body></html>",
        "text/html"
      )
    })
  })
})
