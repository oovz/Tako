import { z } from "zod"

export const MyComicChapterGroupSchema = z
  .array(
    z.object({
      id: z.number().int().positive(),
      title: z.string().trim().min(1).max(1000),
    })
  )
  .min(1)
  .max(10000)
