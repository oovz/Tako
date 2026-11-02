import { z } from "zod"
import type { MangadexPageProbeData } from "./contracts/page-probe"

export const MangadexUserPreferencesSchema = z
  .object({
    dataSaver: z.boolean(),
    filteredLanguages: z.array(z.string()),
    showSafe: z.boolean().optional(),
    showSuggestive: z.boolean().optional(),
    showErotic: z.boolean().optional(),
    showHentai: z.boolean().optional(),
  })
  .strict()

export type MangadexUserPreferences = z.infer<
  typeof MangadexUserPreferencesSchema
>

export const MANGADEX_PREFERENCES_BY_SERIES_SESSION_KEY =
  "mangadexUserPreferencesBySeries"

const MangadexPreferencesBySeriesSchema = z.record(
  z.string(),
  MangadexUserPreferencesSchema
)

export function parseMangadexPreferencesBySeries(
  value: unknown
): Record<string, MangadexUserPreferences> {
  return value === undefined
    ? {}
    : MangadexPreferencesBySeriesSchema.parse(value)
}

export function normalizeMangadexUserPreferences(
  value: MangadexPageProbeData,
  defaults: Pick<MangadexUserPreferences, "dataSaver" | "filteredLanguages">
): MangadexUserPreferences {
  const preferences: MangadexUserPreferences = {
    dataSaver: value.dataSaver ?? defaults.dataSaver,
    filteredLanguages: value.filteredLanguages ?? defaults.filteredLanguages,
  }
  for (const key of [
    "showSafe",
    "showSuggestive",
    "showErotic",
    "showHentai",
  ] as const) {
    if (value[key] !== undefined) preferences[key] = value[key]
  }
  return preferences
}
