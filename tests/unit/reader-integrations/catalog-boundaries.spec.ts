// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { resolveAimanhuaSeries } from "@/src/site-integrations/lovemanga/series"
import { resolveMangaHereSeries } from "@/src/site-integrations/mangahere/series"
import { parseCopyChapterCatalog } from "@/src/site-integrations/copymanga/api"
import { resolveSeriesDocument } from "@/src/site-integrations/animemangahouse/protocol/series"
import { dm5Site } from "@/src/site-integrations/animemangahouse/contracts"
import { offscreenSiteAdapter as manganato } from "@/src/site-integrations/manganato/offscreen-runtime"
import type { RateLimitService } from "@/src/runtime/rate-limit"

const documentFor = (html: string) =>
  new DOMParser().parseFromString(html, "text/html")
const rateLimitService = {
  scheduleForIntegrationScope: async <T>(
    _id: string,
    _scope: string,
    task: () => Promise<T>
  ) => task(),
} as unknown as RateLimitService

afterEach(() => vi.unstubAllGlobals())

describe("reader catalog boundaries", () => {
  const aimanhua =
    '<h1 class="detail-main-info-title">Work</h1><div class="detail-list-select"><a class="chapteritem" href="/chapter/7/8">第1話</a></div>'
  it("resolves Aimanhua chapters without optional metadata and deduplicates identities", () => {
    const result = resolveAimanhuaSeries(
      documentFor(
        aimanhua.replace(
          "</div>",
          '<a class="chapteritem" href="/chapter/7/8">Repeated</a></div>'
        )
      ),
      "https://www.aimanhua.org/comic/7"
    )
    expect(result.seriesMetadata).toEqual({
      title: "Work",
      language: "zh",
      author: undefined,
      genres: undefined,
      description: undefined,
      coverUrl: undefined,
    })
    expect(result.chapterList).toEqual([
      expect.objectContaining({ id: "8", title: "第1話" }),
    ])
  })
  it("rejects an Aimanhua chapter from a different work", () => {
    expect(() =>
      resolveAimanhuaSeries(
        documentFor(aimanhua.replace("/chapter/7/8", "/chapter/9/8")),
        "https://www.aimanhua.org/comic/7"
      )
    ).toThrow(/selected series/)
  })

  it.each([
    ["", undefined],
    [
      '<div class="detail-text-bar"><p>Fallback summary</p></div>',
      "Fallback summary",
    ],
    [
      '<div class="detail-text-bar"><div class="fullcontent"></div><p>Fallback summary</p></div>',
      undefined,
    ],
  ])(
    "resolves MangaHere optional description from %s",
    (description, expected) => {
      const result = resolveMangaHereSeries(
        documentFor(
          `<h1 class="detail-top-bar-info-title">Work</h1><div class="detail-chapters-list"><a href="/manga/work/c1/1.html">Chapter 1</a></div>${description}`
        ),
        "https://newm.mangahere.cc/manga/work/"
      )
      expect(result.seriesMetadata).toMatchObject({
        title: "Work",
        language: "en",
      })
      expect(result.seriesMetadata?.description).toBe(expected)
      expect(result.seriesMetadata?.author).toBeUndefined()
      expect(result.seriesMetadata?.coverUrl).toBeUndefined()
      expect(result.chapterList).toEqual([
        expect.objectContaining({ id: "work/c1" }),
      ])
    }
  )

  const entry = {
    id: "dc312a94-f526-11e8-a7d3-00163e0ca5bd",
    name: "第1話",
    type: 1,
  }
  function copyCatalog() {
    return {
      build: {
        path_word: "work",
        type: [
          { id: 1, name: "話" },
          { id: 2, name: "卷" },
          { id: 3, name: "番外" },
        ],
      },
      groups: { main: { name: "Main", count: 2, chapters: [entry, entry] } },
    }
  }
  it("keeps a Copy chapter's first catalog occurrence", () => {
    const result = parseCopyChapterCatalog(
      copyCatalog(),
      new URL("https://www.copy4000.com/comic/work")
    )
    expect(result.chapters).toEqual([
      expect.objectContaining({ id: entry.id, volumeId: "copy:main:1" }),
    ])
    expect(result.volumes).toHaveLength(3)
  })
  it("rejects an incomplete Copy group before emitting output", () => {
    const catalog = copyCatalog()
    catalog.groups.main.count = 3
    expect(() =>
      parseCopyChapterCatalog(
        catalog,
        new URL("https://www.copy4000.com/comic/work")
      )
    ).toThrow(/incomplete/)
  })

  it.each(["0", ""])(
    "rejects unavailable signed-reader ordering %s",
    (sort) => {
      const document = documentFor(
        `<script>DM5_COMIC_MID=7;DM5_COMIC_SORT=${sort};</script><div class="banner_detail_form"><div class="info"><h1 class="title">Work</h1></div></div><div id="chapterlistload"><a href="/m8/"><p class="title">第1話</p></a></div>`
      )
      expect(() =>
        resolveSeriesDocument(
          dm5Site,
          document,
          "https://www.dm5.com/manhua-work/"
        )
      ).toThrow(/ordering/)
    }
  )

  it("retains a Manganato catalog when title metadata is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          success: true,
          data: {
            chapters: [
              {
                chapter_name: "Chapter 1",
                chapter_slug: "chapter-1",
                chapter_num: 1,
              },
            ],
            pagination: { total: 1, offset: 0, limit: 50, has_more: false },
          },
        })
      )
    )
    const html =
      '<div id="chapter-list-container" data-comic-slug="work"></div>'
    const result = await manganato.offscreen.series!.resolveSeriesData({
      requestId: "series",
      seriesUrl: "https://www.manganato.gg/manga/work",
      html,
      document: documentFor(html),
      rateLimitService,
    })
    expect(result.metadataError).toMatch(/title/)
    expect(result.chapterList).toEqual([
      expect.objectContaining({ id: "chapter-1" }),
    ])
    expect(result.chapterListError).toBeUndefined()
  })
})
