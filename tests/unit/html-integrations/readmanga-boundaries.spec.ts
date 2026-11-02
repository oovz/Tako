// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { integrationHttpClient } from "@/src/site-integrations/http-client"
import { buildManhuaguiChapterImageUrlsFromHtml } from "@/src/site-integrations/readmanga/chapter-viewer"
import { fetchReaderConfig } from "@/src/site-integrations/readmanga/reader-config"
import {
  extractChapterListFromDocument,
  extractSeriesMetadataFromDocument,
} from "@/src/site-integrations/readmanga/series-dom"
import { pageProbe } from "@/src/site-integrations/readmanga/probe"
import { decompressFromBase64 } from "@/src/site-integrations/readmanga/lz-string"
import { toAllowedManhuaguiAssetUrl } from "@/src/site-integrations/readmanga/shared"
import { downloadManhuaguiCoverImage } from "@/src/site-integrations/readmanga/chapter-api"
import { OffscreenLiveResourceLedger } from "@/src/runtime/offscreen-live-resource-ledger"
import type { RateLimitService } from "@/src/runtime/rate-limit"
import { compressToBase64 } from "../../shared/manhuagui-compress"

vi.mock("@/src/site-integrations/http-client", () => ({
  integrationHttpClient: { request: vi.fn() },
}))
const rateLimitService = {} as RateLimitService
const configScript =
  'var c={curServ:0,curHost:0,picserv:[{name:"auto",hosts:[{h:"i",w:1}]}]};'
const configTag =
  '<script src="https://cf.mhgui.com/scripts/config_16.js"></script>'
function packedHtml(data: unknown): string {
  const template = `SMH.imgData(${JSON.stringify(data)});`
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
  return `${configTag}<script>window["eval"](function(p,a,c,k,e,d){return p;}('${template}',62,0,'${compressToBase64("")}'['split']('|'),0,{}))</script>`
}
function dataWithPath(path: unknown) {
  return { path, files: ["page.jpg"], sl: { e: 123, m: "signed & value" } }
}

beforeEach(() => {
  vi.mocked(integrationHttpClient.request)
    .mockReset()
    .mockImplementation(async () => new Response(configScript))
})
afterEach(() => vi.unstubAllGlobals())

describe("Manhuagui viewer boundaries", () => {
  it.each([
    ["https://eu.hamreus.com/chapter", "https://eu.hamreus.com/chapter/"],
    ["//us.hamreus.com/chapter/", "https://us.hamreus.com/chapter/"],
    ["/chapter/", "https://i.hamreus.com/chapter/"],
  ])("resolves the supported image directory %s", async (path, base) => {
    expect(
      await buildManhuaguiChapterImageUrlsFromHtml(
        packedHtml(dataWithPath(path)),
        rateLimitService
      )
    ).toEqual([`${base}page.jpg?e=123&m=signed%20%26%20value`])
  })

  it.each(["https://attacker.example/chapter/", "//attacker.example/chapter/"])(
    "rejects the untrusted image directory %s",
    async (path) => {
      await expect(
        buildManhuaguiChapterImageUrlsFromHtml(
          packedHtml(dataWithPath(path)),
          rateLimitService
        )
      ).rejects.toMatchObject({ category: "provider_changed" })
    }
  )

  it.each([
    { ...dataWithPath("/chapter/"), files: [] },
    { ...dataWithPath("/chapter/"), files: [42] },
    { ...dataWithPath("/chapter/"), files: Array(5_001).fill("page.jpg") },
    { ...dataWithPath("/chapter/"), sl: { e: 123 } },
    dataWithPath(null),
  ])("rejects incomplete or unbounded viewer data", async (data) => {
    await expect(
      buildManhuaguiChapterImageUrlsFromHtml(packedHtml(data), rateLimitService)
    ).rejects.toMatchObject({ category: "provider_changed" })
  })

  it("ignores braces and escaped quotes inside JSON strings", async () => {
    const data = {
      ...dataWithPath("/chapter/"),
      extra: { text: 'brace } and "quoted" text' },
    }
    expect(
      await buildManhuaguiChapterImageUrlsFromHtml(
        packedHtml(data),
        rateLimitService
      )
    ).toHaveLength(1)
  })

  it("rejects reader configurations whose hosts are all untrusted", async () => {
    vi.mocked(integrationHttpClient.request).mockResolvedValueOnce(
      new Response('{name:"auto",hosts:[{h:"attacker",w:1}]}')
    )
    await expect(
      fetchReaderConfig(configTag, rateLimitService)
    ).rejects.toMatchObject({ category: "provider_changed" })
  })

  it("keeps allowed hosts and defaults missing reader indexes", async () => {
    vi.mocked(integrationHttpClient.request).mockResolvedValueOnce(
      new Response('{name:"auto",hosts:[{h:"attacker",w:1},{h:"eu",w:0.5}]}')
    )
    expect(await fetchReaderConfig(configTag, rateLimitService)).toEqual({
      curHost: 0,
      curServ: 0,
      services: [{ name: "auto", hosts: [{ name: "eu", weight: 0.5 }] }],
    })
  })

  it("rejects a relative directory when the selected reader service is unavailable", async () => {
    vi.mocked(integrationHttpClient.request).mockResolvedValueOnce(
      new Response(
        'var c={curServ:9,curHost:0,picserv:[{name:"auto",hosts:[{h:"i",w:1}]}]};'
      )
    )
    await expect(
      buildManhuaguiChapterImageUrlsFromHtml(
        packedHtml(dataWithPath("/chapter/")),
        rateLimitService
      )
    ).rejects.toMatchObject({
      category: "provider_changed",
      cause: { category: "provider_changed" },
    })
  })

  it("downloads a permitted cover with independent retained output ownership", async () => {
    vi.mocked(integrationHttpClient.request).mockResolvedValueOnce(
      new Response(new Uint8Array([1, 2]), {
        headers: { "content-type": "image/png" },
      })
    )
    const ledger = new OffscreenLiveResourceLedger()
    const cover = await downloadManhuaguiCoverImage(
      "https://cf.mhgui.com/cover.png",
      {
        runtime: {
          rateLimitService,
          rateLimitSettings: {
            chapter: { concurrency: 1, delayMs: 0 },
            image: { concurrency: 1, delayMs: 0 },
          },
        },
        skipRateLimit: true,
        liveResourceLedger: ledger,
      }
    )
    expect(cover).toMatchObject({
      filename: "cover.png",
      mimeType: "image/png",
    })
    expect(new Uint8Array(cover.data)).toEqual(new Uint8Array([1, 2]))
    expect(ledger.getUsedBytes()).toBe(2)
    cover.liveResourceLease.release()
    expect(ledger.getUsedBytes()).toBe(0)
    expect(integrationHttpClient.request).toHaveBeenCalledWith(
      expect.objectContaining({
        endpointId: "readmanga-cover-image",
        init: expect.objectContaining({ credentials: "omit" }),
      })
    )
  })

  it("decodes Unicode literals and a growing LZ dictionary", () => {
    const source = "漢字 😀 abracadabra ".repeat(300)
    expect(decompressFromBase64(compressToBase64(source))).toBe(source)
    expect(decompressFromBase64(compressToBase64(""))).toBe("")
    expect(decompressFromBase64("A")).toBe("")
  })
})

describe("Manhuagui page metadata and snapshot", () => {
  it("uses social metadata and the short introduction when visible fields are absent", () => {
    const dom = new DOMParser().parseFromString(
      '<meta property="og:title" content="Fallback title"><meta property="og:image" content="//cf.mhgui.com/cover.jpg"><div class="book-cont"><div class="book-intro">Short intro</div></div>',
      "text/html"
    )
    expect(extractSeriesMetadataFromDocument(dom)).toMatchObject({
      title: "Fallback title",
      description: "Short intro",
      coverUrl: "https://cf.mhgui.com/cover.jpg",
    })
  })

  it.each([
    {
      links: [
        ["20", "第1话"],
        ["10", "第2话"],
      ],
      ids: ["20", "10"],
    },
    {
      links: [
        ["20", "Special"],
        ["10", "Bonus"],
      ],
      ids: ["10", "20"],
    },
    {
      links: [
        ["20", "第1话"],
        ["10", "第1话"],
      ],
      ids: ["10", "20"],
    },
    {
      links: [
        ["0001", "Special"],
        ["1", "Bonus"],
      ],
      ids: ["0001", "1"],
    },
  ])(
    "orders chapter numbers, numeric ids, and tied ids with stable DOM order",
    ({ links, ids }) => {
      const html = `<div class="chapter"><h4>Chapters</h4><div class="chapter-list">${links.map(([id, title]) => `<a href="/comic/1/${id}.html">${title}</a>`).join("")}</div></div>`
      const dom = new DOMParser().parseFromString(html, "text/html")
      expect(
        extractChapterListFromDocument(dom).chapters.map(
          (chapter) => chapter.id
        )
      ).toEqual(ids)
    }
  )

  it.each([
    "http://cf.mhgui.com/cover.jpg",
    "https://attacker.example/cover.jpg",
  ])("rejects an unauthorized cover URL %s", (url) => {
    expect(toAllowedManhuaguiAssetUrl(url)).toBeUndefined()
  })

  it("collects only bounded rendered chapter containers and removes active elements", () => {
    const dom = new DOMParser().parseFromString(
      '<div id="checkAdult"></div>' +
        '<div class="chapter"><a href="/comic/1/2.html">Chapter</a><script type="application/json">{}</script><form>form</form><object></object></div>'.repeat(
          33
        ),
      "text/html"
    )
    vi.stubGlobal("document", dom)
    vi.stubGlobal("location", { href: "https://www.manhuagui.com/comic/1/" })
    const result = pageProbe.parse(pageProbe.collect())
    const data = result.data as {
      chapterHtml: string
      adultGatePresent: boolean
    }
    const snapshot = new DOMParser().parseFromString(
      data.chapterHtml,
      "text/html"
    )
    expect(data.adultGatePresent).toBe(true)
    expect(snapshot.querySelectorAll(".chapter")).toHaveLength(32)
    expect(snapshot.querySelectorAll("script, form, object")).toHaveLength(0)
    expect(snapshot.querySelectorAll("a")).toHaveLength(32)
  })

  it("returns the page identity when optional snapshot access fails", () => {
    vi.stubGlobal("location", { href: "https://www.manhuagui.com/comic/1/" })
    vi.stubGlobal("document", {
      querySelector() {
        throw new Error("DOM unavailable")
      },
    })
    expect(pageProbe.collect()).toEqual({
      url: "https://www.manhuagui.com/comic/1/",
    })
  })
})
