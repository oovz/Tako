import { describe, expect, it } from "vitest"
import {
  buildSeriesComicInfoBase,
  composeChapterMetadata,
} from "@/src/shared/chapter-metadata"
import type { Book } from "@/src/types/book"

describe("ComicInfo metadata policy", () => {
  it.each([
    ["safe", "Everyone"],
    ["suggestive", "Teen"],
    ["erotica", "Mature 17+"],
    ["pornographic", "Adults Only 18+"],
    ["unrated", undefined],
  ] as const)(
    "maps provider content rating %s to ComicInfo age rating",
    (contentRating, ageRating) => {
      expect(
        buildSeriesComicInfoBase("Series", { contentRating }).AgeRating
      ).toBe(ageRating)
    }
  )

  it.each(["rtl", "right-to-left", "right_to_left", " RTL "])(
    "preserves right-to-left reading direction %s",
    (readingDirection) => {
      expect(
        buildSeriesComicInfoBase("Series", { readingDirection }).Manga
      ).toBe("YesAndRightToLeft")
    }
  )

  it.each(["ltr", "left-to-right", "left_to_right", " LTR ", "unknown"])(
    "uses ordinary manga ordering for direction %s",
    (readingDirection) => {
      expect(
        buildSeriesComicInfoBase("Series", { readingDirection }).Manga
      ).toBe("Yes")
    }
  )

  it("preserves an inherited chapter number when no chapter-specific number is available", () => {
    const book: Book = {
      siteId: "test",
      seriesId: "series",
      seriesTitle: "Series",
      comicInfoBase: { Number: "Special" },
    }
    const chapter = composeChapterMetadata(book, {
      id: "chapter",
      url: "https://example.com/chapter",
      title: "Extra",
    })
    expect(chapter.comicInfo.Number).toBe("Special")
    expect(chapter.chapterLabel).toBe("Special")
    expect(book.comicInfoBase).toEqual({ Number: "Special" })
  })
})
