import { z } from "zod"
import { MAX_CHAPTER_IMAGES } from "@/src/constants/timeouts"

export const BoyloveCatalogSchema = z.object({
  list: z
    .array(
      z.object({
        id: z.number().int().positive().safe(),
        title: z.string().min(1).max(1000),
        isvip: z.enum(["0", "1"]),
      })
    )
    .min(1)
    .max(10_000),
})

export const BoyloveReaderPagesSchema = z
  .array(
    z.object({
      id: z.number().int().nonnegative(),
      src: z.string().min(1).max(4096),
      width: z.number().int().positive(),
      height: z.string().min(1).max(30),
    })
  )
  .min(1)
  .max(MAX_CHAPTER_IMAGES)
