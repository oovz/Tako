import { Window } from "happy-dom"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  extractImageUrlsFromEpisodeJsonScript,
  readEpisodeJsonAttributeFromHtml,
  readEpisodeJsonSeriesMetadataFromHtml,
} from "@/src/site-integrations/shonenjumpplus/episode-json"
import { parseAggregateIdFromHtml } from "@/src/site-integrations/shonenjumpplus/page-context"
import { mapEpisode } from "@/src/site-integrations/shonenjumpplus/series-api"

function episodeHtml(payload: unknown, quote = "&quot;"): string {
  return `<script data-value="${JSON.stringify(payload).replaceAll("&", "&amp;").replaceAll('"', quote)}" id="episode-json"></script>`
}
afterEach(() => vi.unstubAllGlobals())

describe("Shonen Jump+ episode metadata", () => {
  it.each(["&quot;", "&#34;", "&#x22;"])(
    "decodes %s attributes without a DOM",
    (quote) => {
      vi.stubGlobal("DOMParser", undefined)
      expect(
        readEpisodeJsonSeriesMetadataFromHtml(
          episodeHtml(
            {
              readableProduct: {
                series: {
                  id: "456",
                  title: "  A & B  ",
                  thumbnailUri: "https://cdn-ak.shonenjumpplus.com/cover.jpg",
                },
              },
            },
            quote
          )
        )
      ).toEqual({
        seriesId: "456",
        seriesTitle: "A & B",
        seriesThumbnailUri: "https://cdn-ak.shonenjumpplus.com/cover.jpg",
      })
    }
  )

  it("reads browser-parsed attributes through the same payload boundary", () => {
    vi.stubGlobal("DOMParser", new Window().DOMParser)
    expect(
      readEpisodeJsonSeriesMetadataFromHtml(
        episodeHtml({
          readableProduct: { series: { id: "not-numeric", title: "   " } },
        })
      )
    ).toEqual({
      seriesId: undefined,
      seriesTitle: undefined,
      seriesThumbnailUri: undefined,
    })
  })

  it.each([
    "",
    '<script id="other"></script>',
    '<script id="episode-json"></script>',
    '<script id="episode-json" data-value="invalid"></script>',
    episodeHtml({ readableProduct: { series: { title: 123 } } }),
  ])("returns no images for absent or invalid episode payloads", (html) => {
    expect(extractImageUrlsFromEpisodeJsonScript(html)).toEqual([])
  })

  it("keeps only main page images in source order", () => {
    expect(
      extractImageUrlsFromEpisodeJsonScript(
        episodeHtml({
          readableProduct: {
            pageStructure: {
              pages: [
                { type: "advertisement", src: "ad" },
                { type: "main", src: "first" },
                { type: "main", src: "second" },
              ],
            },
          },
        })
      )
    ).toEqual(["first", "second"])
  })

  it("returns no attribute when the script has an empty value", () => {
    vi.stubGlobal("DOMParser", undefined)
    expect(
      readEpisodeJsonAttributeFromHtml(
        '<script id="episode-json" data-value=""></script>'
      )
    ).toBeNull()
  })
})

describe("Shonen Jump+ identities", () => {
  it("reads the numeric aggregate identity from its catalog marker", () => {
    expect(
      parseAggregateIdFromHtml(
        '<div class="other js-readable-products-pagination" data-aggregate-id="456"></div>'
      )
    ).toBe("456")
    expect(
      parseAggregateIdFromHtml(
        '<div class="js-readable-products-pagination" data-aggregate-id="456x"></div>'
      )
    ).toBeNull()
    expect(
      parseAggregateIdFromHtml('<div data-aggregate-id="456"></div>')
    ).toBeNull()
  })

  it.each([
    { readable_product_id: "invalid" },
    {
      readable_product_id: "123",
      viewer_uri: "https://attacker.example/episode/123",
    },
    { readable_product_id: "123", viewer_uri: "/episode/456" },
    { readable_product_id: "123", viewer_uri: "/volume/123" },
  ])("excludes products without a trusted matching episode", (product) => {
    expect(mapEpisode(product)).toBeNull()
  })

  it("builds the canonical URL and fallback title while treating unknown access as locked", () => {
    expect(mapEpisode({ readable_product_id: "123" })).toMatchObject({
      id: "123",
      url: "https://shonenjumpplus.com/episode/123",
      title: "Episode 123",
      locked: true,
    })
  })
})
