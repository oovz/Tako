import { z } from "zod"
import { MAX_CHAPTER_IMAGES } from "@/src/constants/timeouts"

export const ReaderParameters = z.object({
  host: z.literal("www.aimanhua.org"),
  source_id: z.union([z.string(), z.number()]),
  comic_id: z.union([z.string(), z.number()]),
  chapter_id: z.union([z.string(), z.number()]),
  images: z.array(z.string().min(1).max(4096)).min(1).max(MAX_CHAPTER_IMAGES),
})
