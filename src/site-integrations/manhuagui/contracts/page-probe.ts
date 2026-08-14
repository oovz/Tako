import { z } from "zod"

export const ManhuaguiPageProbeDataSchema = z.strictObject({
  chapterHtml: z.string().min(1).max(512_000).optional(),
  adultGatePresent: z.boolean(),
})

export type ManhuaguiPageProbeData = z.infer<
  typeof ManhuaguiPageProbeDataSchema
>
