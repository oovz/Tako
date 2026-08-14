import { z } from "zod"

export const MangadexPageProbeDataSchema = z.strictObject({
  dataSaver: z.boolean().optional(),
  filteredLanguages: z.array(z.string().max(32)).max(32).optional(),
  showSafe: z.boolean().optional(),
  showSuggestive: z.boolean().optional(),
  showErotic: z.boolean().optional(),
  showHentai: z.boolean().optional(),
})

export type MangadexPageProbeData = z.infer<typeof MangadexPageProbeDataSchema>
