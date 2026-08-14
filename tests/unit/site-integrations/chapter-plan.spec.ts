import { describe, expect, it } from "vitest"

import { MAX_CHAPTER_IMAGES } from "@/src/constants/timeouts"
import { ChapterImagePlanSchema } from "@/src/site-integrations/chapter-plan"

describe("ChapterImagePlanSchema", () => {
  it("accepts bounded HTTP(S) image plans", () => {
    expect(
      ChapterImagePlanSchema.parse({
        imageUrls: [
          "https://cdn.example.test/1.jpg",
          "http://cdn.example.test/2.webp",
        ],
      })
    ).toEqual({
      imageUrls: [
        "https://cdn.example.test/1.jpg",
        "http://cdn.example.test/2.webp",
      ],
    })
  })

  it.each([
    { imageUrls: [] },
    { imageUrls: ["data:image/png;base64,AA=="] },
    { imageUrls: ["not-a-url"] },
    { imageUrls: ["https://cdn.example.test/1.jpg"], obsolete: true },
  ])("rejects malformed plan %#", (plan) => {
    expect(() => ChapterImagePlanSchema.parse(plan)).toThrow()
  })

  it("rejects aggregate plans beyond the chapter image bound", () => {
    expect(() =>
      ChapterImagePlanSchema.parse({
        imageUrls: Array.from(
          { length: MAX_CHAPTER_IMAGES + 1 },
          (_, index) => `https://cdn.example.test/${index}.jpg`
        ),
      })
    ).toThrow()
  })
})
