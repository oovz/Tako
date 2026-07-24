import { siteIntegrationSettingsService } from "@/src/storage/site-integration-settings-service"
import {
  normalizeMangadexUserPreferences,
  parseMangadexUserPreferences,
  selectMangadexUserPreferencesSource,
} from "./preferences-schema"
import { parseConfiguredMangadexImageQuality } from "../mangadex-dispatch-context"

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

export function parseMangadexStoragePreferences(
  raw: string | null | undefined
): MangadexUserPreferences {
  if (!raw) return DEFAULT_MANGADEX_PREFERENCES
  try {
    const parsed: unknown = JSON.parse(raw)
    return normalizeMangadexUserPreferences(
      selectMangadexUserPreferencesSource(parsed),
      DEFAULT_MANGADEX_PREFERENCES
    )
  } catch {
    return DEFAULT_MANGADEX_PREFERENCES
  }
}

export function parseMangadexPagePreferences(
  value: unknown
): MangadexUserPreferences | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined
  }

  return normalizeMangadexUserPreferences(value, DEFAULT_MANGADEX_PREFERENCES)
}

export const getContextMangadexPreferences = (
  context?: Record<string, unknown>
): MangadexUserPreferences | undefined => {
  return parseMangadexUserPreferences(context?.mangadexUserPreferences)
}

const getContextConfiguredMangadexImageQuality = (
  context?: Record<string, unknown>
): "data" | "data-saver" | undefined => {
  return parseConfiguredMangadexImageQuality(
    context?.mangadexConfiguredImageQuality
  )
}

const resolveConfiguredMangadexImageQuality = async (): Promise<
  "data" | "data-saver" | undefined
> => {
  try {
    const allSettings = await siteIntegrationSettingsService.getAll()
    const siteSettings = allSettings.mangadex
    if (!siteSettings) {
      return undefined
    }

    return parseConfiguredMangadexImageQuality(siteSettings.imageQuality)
  } catch {
    return undefined
  }
}

export async function resolveMangadexImageQuality(
  context?: Record<string, unknown>
): Promise<"data" | "data-saver"> {
  const configuredImageQuality =
    getContextConfiguredMangadexImageQuality(context) ??
    (await resolveConfiguredMangadexImageQuality())
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
  requestPreferences?: MangadexUserPreferences
): Promise<{
  languages?: string[]
  contentRatings?: string[]
}> {
  let storedSettings: Record<string, unknown> = {}

  try {
    const allSettings = await siteIntegrationSettingsService.getAll()
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
