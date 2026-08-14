import type { SiteIntegrationSettingsReader } from "@/src/types/site-integrations"
import { normalizeMangadexUserPreferences } from "./preferences-schema"
import type { MangadexDispatchContext } from "./contracts/dispatch-context"
import { MangadexPageProbeDataSchema } from "./contracts/page-probe"

export interface MangadexUserPreferences {
  dataSaver: boolean
  filteredLanguages: string[]
  showSafe?: boolean
  showSuggestive?: boolean
  showErotic?: boolean
  showHentai?: boolean
}

const DEFAULT_MANGADEX_PREFERENCES: MangadexUserPreferences = {
  dataSaver: true,
  filteredLanguages: [],
}

export function parseMangadexPagePreferences(
  value: unknown
): MangadexUserPreferences | undefined {
  if (value === undefined) return undefined
  return normalizeMangadexUserPreferences(
    MangadexPageProbeDataSchema.parse(value),
    DEFAULT_MANGADEX_PREFERENCES
  )
}

export const getContextMangadexPreferences = (
  context?: MangadexDispatchContext
): MangadexUserPreferences | undefined => {
  return context?.mangadexUserPreferences
}

const getContextConfiguredMangadexImageQuality = (
  context?: MangadexDispatchContext
): "data" | "data-saver" | undefined => {
  return context?.mangadexConfiguredImageQuality
}

export function resolveMangadexImageQuality(
  context?: MangadexDispatchContext
): "data" | "data-saver" {
  const configuredImageQuality =
    getContextConfiguredMangadexImageQuality(context)
  const contextPrefs = getContextMangadexPreferences(context)

  if (configuredImageQuality) {
    return configuredImageQuality
  }

  const prefs = contextPrefs ?? { dataSaver: true, filteredLanguages: [] }
  return prefs.dataSaver ? "data-saver" : "data"
}

const parseConfiguredMangadexLanguageFilter = (
  value: unknown
): string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined
  }

  return value.filter(
    (language): language is string => typeof language === "string"
  )
}

const resolveMangadexContentRatings = (
  preferences?: MangadexUserPreferences
): string[] | undefined => {
  if (!preferences) {
    return undefined
  }

  const hasContentRatingPreference = [
    preferences.showSafe,
    preferences.showSuggestive,
    preferences.showErotic,
    preferences.showHentai,
  ].some((value) => typeof value === "boolean")

  if (!hasContentRatingPreference) {
    return undefined
  }

  const ratings: string[] = []
  if (preferences.showSafe) {
    ratings.push("safe")
  }
  if (preferences.showSuggestive) {
    ratings.push("suggestive")
  }
  if (preferences.showErotic) {
    ratings.push("erotica")
  }
  if (preferences.showHentai) {
    ratings.push("pornographic")
  }

  return ratings
}

export async function resolveMangadexChapterFeedOptions(
  language?: string,
  requestPreferences?: MangadexUserPreferences,
  settingsReader?: SiteIntegrationSettingsReader
): Promise<{
  languages?: string[]
  contentRatings?: string[]
}> {
  let storedSettings: Record<string, unknown> = {}

  try {
    if (!settingsReader) {
      throw new Error("MangaDex chapter options require settings reader")
    }
    const allSettings = await settingsReader.getAll()
    const rawSettings = allSettings.mangadex
    if (rawSettings) {
      storedSettings = rawSettings
    }
  } catch {
    storedSettings = {}
  }

  const autoReadEnabled = storedSettings.autoReadMangaDexSettings !== false
  const configuredLanguages = parseConfiguredMangadexLanguageFilter(
    storedSettings.chapterLanguageFilter
  )
  const cachedPreferences = autoReadEnabled ? requestPreferences : undefined

  const languages = language
    ? [language]
    : configuredLanguages !== undefined
      ? configuredLanguages
      : autoReadEnabled
        ? cachedPreferences?.filteredLanguages
        : undefined

  const contentRatings = autoReadEnabled
    ? resolveMangadexContentRatings(cachedPreferences)
    : undefined

  return {
    languages: languages && languages.length > 0 ? languages : undefined,
    contentRatings,
  }
}
