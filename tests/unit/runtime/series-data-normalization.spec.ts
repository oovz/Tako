import { describe, expect, it } from "vitest"

import { buildResolvedTabContext } from "@/src/runtime/series-data-normalization"
import type { SeriesMetadata } from "@/src/types/series-metadata"

describe("buildResolvedTabContext", () => {
  it("stores provider metadata as a title-free canonical snapshot", () => {
    const providerMetadata = {
      title: "Canonical Series",
      author: "Test Author",
      artist: "Test Artist",
      description: "Test description",
      genres: ["Action", "Adventure"],
      communityRating: 4.5,
      year: 2026,
      coverUrl: "https://example.test/cover.jpg",
      alternativeTitles: ["Canonical Alternative"],
      status: "ongoing",
      language: "en",
      contentRating: "safe",
      readingDirection: "ltr",
      publisher: "Test Publisher",
      tags: ["featured"],
    } satisfies SeriesMetadata
    const { title, ...expectedMetadata } = providerMetadata

    const context = buildResolvedTabContext({
      sourceUrl: "https://example.test/series/1",
      siteIntegrationId: "test",
      rawMangaId: "series-1",
      seriesMetadata: providerMetadata,
      chapters: [
        {
          id: "chapter-1",
          url: "https://example.test/chapter/1",
          title: "Chapter 1",
        },
      ],
    })

    expect(context.context).toBe("ready")
    if (context.context !== "ready") return

    expect(context.seriesTitle).toBe(title)
    expect(context.metadata).toEqual(expectedMetadata)
    expect(context.metadata).not.toHaveProperty("title")
  })

  it("rejects duplicate stable chapter identities", () => {
    expect(
      buildResolvedTabContext({
        sourceUrl: "https://example.test/series/1",
        siteIntegrationId: "test",
        rawMangaId: "series-1",
        seriesMetadata: { title: "Series" },
        chapters: [
          { id: "chapter-1", url: "https://example.test/1", title: "One" },
          { id: "chapter-1", url: "https://example.test/2", title: "Two" },
        ],
      })
    ).toEqual({
      context: "error",
      error: "Failed to extract unique stable chapter ids",
    })
  })
})
