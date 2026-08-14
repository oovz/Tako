import { z } from "zod"

import { MAX_CHAPTER_IMAGES } from "@/src/constants/timeouts"

const HttpImageUrlSchema = z
  .string()
  .url()
  .refine(
    (value) => {
      const protocol = new URL(value).protocol
      return protocol === "https:" || protocol === "http:"
    },
    { message: "Image URLs must use HTTP(S)" }
  )

export const ChapterImagePlanSchema = z.strictObject({
  imageUrls: z.array(HttpImageUrlSchema).min(1).max(MAX_CHAPTER_IMAGES),
})

export type ChapterImagePlan = z.infer<typeof ChapterImagePlanSchema>

export function parseChapterImagePlan(value: unknown): ChapterImagePlan {
  return ChapterImagePlanSchema.parse(value)
}
