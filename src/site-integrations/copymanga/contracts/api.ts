import { z } from "zod"
import { MAX_CHAPTER_IMAGES } from "@/src/constants/timeouts"

export const CopyChapterIdSchema = z.string().uuid()
export const CopyCatalogSelectorSchema = z.string().regex(/^[0-9]{1,32}$/)
export const CopyImageUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value)
    return (
      ["https://sy.mangafunb.fun", "https://sd.mangafunb.fun"].includes(
        url.origin
      ) &&
      !url.username &&
      !url.password
    )
  }, "Copy image origin is unavailable")

const groupSchema = z.object({
  name: z.string().max(10_000),
  count: z.number().int().nonnegative().max(20_000),
  chapters: z
    .array(
      z.object({
        id: CopyChapterIdSchema,
        name: z.string().trim().min(1).max(10_000),
        type: z.number().int(),
      })
    )
    .max(20_000),
})

export const CopyCatalogSchema = z.object({
  build: z.object({ path_word: z.string() }),
  groups: z.record(z.string(), groupSchema),
})
export const CopyReaderSchema = z
  .array(z.object({ url: CopyImageUrlSchema }))
  .min(1)
  .max(MAX_CHAPTER_IMAGES)
export const CopyCatalogResponseSchema = z.object({
  code: z.number(),
  results: z.string().max(10_000_000).optional(),
})
