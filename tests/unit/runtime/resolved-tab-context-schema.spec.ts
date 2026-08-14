import { describe, expect, it } from "vitest"

import { ResolvedTabContextSchema } from "@/src/runtime/resolved-tab-context-schema"

describe("ResolvedTabContextSchema", () => {
  const readyContext = {
    context: "ready",
    sourceUrl: "https://example.test/series/1",
    siteIntegrationId: "site",
    mangaId: "series-1",
    seriesTitle: "Authoritative Series",
    chapters: [],
    metadata: {
      author: "Test Author",
      genres: ["Action"],
    },
  } as const

  it("keeps the authoritative title separate from strict metadata", () => {
    expect(ResolvedTabContextSchema.safeParse(readyContext).success).toBe(true)
  })

  it.each([{ title: "Injected Title" }, { unsupported: true }])(
    "rejects metadata with non-snapshot fields %#",
    (extraMetadata) => {
      expect(
        ResolvedTabContextSchema.safeParse({
          ...readyContext,
          metadata: {
            ...readyContext.metadata,
            ...extraMetadata,
          },
        }).success
      ).toBe(false)
    }
  )

  it("rejects duplicate resolved chapter IDs with the canonical invariant", () => {
    const result = ResolvedTabContextSchema.safeParse({
      ...readyContext,
      chapters: [
        {
          id: "chapter-1",
          url: "https://example.test/chapter/1",
          title: "Chapter 1",
        },
        {
          id: "chapter-1",
          url: "https://example.test/chapter/duplicate",
          title: "Duplicate Chapter",
        },
      ],
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          message: "Chapter IDs must be unique",
          path: ["chapters", 1, "id"],
        })
      )
    }
  })
})
