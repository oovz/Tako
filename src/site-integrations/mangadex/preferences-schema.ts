import { z } from 'zod'

export const MANGADEX_PREFS_SESSION_KEY = 'mangadexUserPreferencesBySeries'

const UnknownObjectSchema = z.record(z.string(), z.unknown())
const UnknownObjectWithFallbackSchema = UnknownObjectSchema.catch({})

const BooleanOptionalSchema = z.preprocess(
  (value) => typeof value === 'boolean' ? value : undefined,
  z.boolean().optional(),
)

const StringArrayOptionalSchema = z.preprocess(
  (value) => Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : undefined,
  z.array(z.string()).optional(),
)

export const MangadexUserPreferencesSchema = z.object({
  dataSaver: z.boolean(),
  filteredLanguages: z.array(z.string()),
  showSafe: z.boolean().optional(),
  showSuggestive: z.boolean().optional(),
  showErotic: z.boolean().optional(),
  showHentai: z.boolean().optional(),
}).strip()

const PartialMangadexUserPreferencesSchema = z.preprocess(
  (value) => UnknownObjectWithFallbackSchema.parse(value),
  z.object({
    dataSaver: BooleanOptionalSchema,
    filteredLanguages: StringArrayOptionalSchema,
    showSafe: BooleanOptionalSchema,
    showSuggestive: BooleanOptionalSchema,
    showErotic: BooleanOptionalSchema,
    showHentai: BooleanOptionalSchema,
  }).strip(),
)

export type MangadexUserPreferences = z.infer<typeof MangadexUserPreferencesSchema>

export function parseMangadexUserPreferences(value: unknown): MangadexUserPreferences | undefined {
  const parsed = MangadexUserPreferencesSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

export function parseMangadexPreferencesBySeries(value: unknown): Record<string, MangadexUserPreferences> {
  const parsedEntries = UnknownObjectWithFallbackSchema.parse(value)
  const normalized: Record<string, MangadexUserPreferences> = {}

  for (const [seriesKey, prefs] of Object.entries(parsedEntries)) {
    const parsedPreferences = MangadexUserPreferencesSchema.safeParse(prefs)
    if (parsedPreferences.success) {
      normalized[seriesKey] = parsedPreferences.data
    }
  }

  return normalized
}

export function selectMangadexUserPreferencesSource(value: unknown): unknown {
  const parsed = UnknownObjectWithFallbackSchema.parse(value)
  const userPreferences = UnknownObjectSchema.safeParse(parsed.userPreferences)
  if (userPreferences.success) {
    return userPreferences.data
  }

  const settings = UnknownObjectSchema.safeParse(parsed.settings)
  if (settings.success) {
    return settings.data
  }

  return parsed
}

export function normalizeMangadexUserPreferences(
  value: unknown,
  defaults: Pick<MangadexUserPreferences, 'dataSaver' | 'filteredLanguages'>,
): MangadexUserPreferences {
  const parsed = PartialMangadexUserPreferencesSchema.parse(value)

  return {
    dataSaver: parsed.dataSaver ?? defaults.dataSaver,
    filteredLanguages: parsed.filteredLanguages ?? defaults.filteredLanguages,
    ...(parsed.showSafe !== undefined ? { showSafe: parsed.showSafe } : {}),
    ...(parsed.showSuggestive !== undefined ? { showSuggestive: parsed.showSuggestive } : {}),
    ...(parsed.showErotic !== undefined ? { showErotic: parsed.showErotic } : {}),
    ...(parsed.showHentai !== undefined ? { showHentai: parsed.showHentai } : {}),
  }
}
