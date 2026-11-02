import { z } from "zod"
import { MAX_CHAPTER_IMAGES } from "@/src/constants/timeouts"

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const label = z.string().trim().min(1).max(10_000)
const imageUrl = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value)
    return (
      url.origin === "https://images.zaimanhua.com" &&
      !url.username &&
      !url.password
    )
  }, "Zaimanhua image origin is unavailable")
const tag = z.object({ tagName: label })
export const ZaimanhuaComicSchema = z.object({
  id,
  title: label,
  comicPy: z.string().regex(/^[a-z0-9_-]+$/),
  description: z.string().max(100_000).optional(),
  cover: imageUrl.optional(),
  canRead: z.boolean(),
  authorInfo: z.object({ authorName: z.string().max(10_000) }).optional(),
  authorsTagList: z.array(tag).max(100).optional(),
  themeTagList: z.array(tag).max(100).optional(),
  types: z.string().max(10_000).optional(),
  chapterList: z
    .array(
      z.object({
        title: label,
        data: z
          .array(
            z.object({
              chapter_id: id,
              chapter_title: label,
              chapter_order: z.number().finite(),
              is_fee: z.boolean(),
            })
          )
          .max(20_000),
      })
    )
    .min(1)
    .max(100),
})

export const ZaimanhuaEnvelopeSchema = z.object({
  errno: z.number(),
  data: z.unknown().optional(),
})
export const ZaimanhuaSeriesDataSchema = z.object({
  comicInfo: ZaimanhuaComicSchema,
})
export const ZaimanhuaChapterDataSchema = z.object({
  chapterInfo: z.object({
    comic_id: id,
    chapter_id: id,
    page_url: z.array(imageUrl).min(1).max(MAX_CHAPTER_IMAGES),
  }),
})
