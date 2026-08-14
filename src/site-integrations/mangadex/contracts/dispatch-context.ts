import { z } from "zod"

const MangadexDispatchPreferencesSchema = z.strictObject({
  dataSaver: z.boolean(),
  filteredLanguages: z.array(z.string().max(32)).max(32),
  showSafe: z.boolean().optional(),
  showSuggestive: z.boolean().optional(),
  showErotic: z.boolean().optional(),
  showHentai: z.boolean().optional(),
})

export const MangadexDispatchContextSchema = z.strictObject({
  mangadexConfiguredImageQuality: z.enum(["data", "data-saver"]).optional(),
  mangadexUserPreferences: MangadexDispatchPreferencesSchema.optional(),
})

export type MangadexDispatchContext = z.infer<
  typeof MangadexDispatchContextSchema
>
