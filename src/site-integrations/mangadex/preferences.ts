import logger from '@/src/runtime/logger'
import { composeSeriesKey } from '@/src/runtime/queue-task-summary'
import { siteIntegrationSettingsService } from '@/src/storage/site-integration-settings-service'
import {
  MANGADEX_PREFS_SESSION_KEY,
  normalizeMangadexUserPreferences,
  parseMangadexPreferencesBySeries,
  parseMangadexUserPreferences,
  selectMangadexUserPreferencesSource,
} from './preferences-schema'
import { parseConfiguredMangadexImageQuality } from '../mangadex-dispatch-context'

export interface MangadexUserPreferences {
  dataSaver: boolean
  filteredLanguages: string[]
  showSafe?: boolean
  showSuggestive?: boolean
  showErotic?: boolean
  showHentai?: boolean
}

const buildMangadexSeriesKey = (seriesId: string): string => composeSeriesKey('mangadex', seriesId)

export async function cacheMangadexPreferencesForSeries(seriesId: string): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.session) {
    return
  }

  const prefs = readMangadexUserPreferences()
  const session = await chrome.storage.session.get(MANGADEX_PREFS_SESSION_KEY) as Record<string, unknown>
  const bySeries = parseMangadexPreferencesBySeries(session[MANGADEX_PREFS_SESSION_KEY])
  bySeries[buildMangadexSeriesKey(seriesId)] = prefs
  await chrome.storage.session.set({
    [MANGADEX_PREFS_SESSION_KEY]: bySeries,
  })
}

export const getContextMangadexPreferences = (context?: Record<string, unknown>): MangadexUserPreferences | undefined => {
  return parseMangadexUserPreferences(context?.mangadexUserPreferences)
}

const getContextConfiguredMangadexImageQuality = (context?: Record<string, unknown>): 'data' | 'data-saver' | undefined => {
  return parseConfiguredMangadexImageQuality(context?.mangadexConfiguredImageQuality)
}

const resolveConfiguredMangadexImageQuality = async (): Promise<'data' | 'data-saver' | undefined> => {
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

let cachedUserPreferences: MangadexUserPreferences | null = null

export function setCachedMangadexPreferences(prefs: MangadexUserPreferences): void {
  cachedUserPreferences = prefs
  logger.debug('[mangadex] Cached user preferences:', prefs)
}

export function getCachedMangadexPreferences(): MangadexUserPreferences {
  return cachedUserPreferences ?? {
    dataSaver: true,
    filteredLanguages: [],
  }
}

export async function resolveMangadexImageQuality(context?: Record<string, unknown>): Promise<'data' | 'data-saver'> {
  const configuredImageQuality = getContextConfiguredMangadexImageQuality(context)
    ?? await resolveConfiguredMangadexImageQuality()
  const contextPrefs = getContextMangadexPreferences(context)
  const cachedPrefs = getCachedMangadexPreferences()

  if (configuredImageQuality) {
    return configuredImageQuality
  }

  const prefs = contextPrefs ?? cachedPrefs
  return prefs.dataSaver ? 'data-saver' : 'data'
}

export function readMangadexUserPreferences(): MangadexUserPreferences {
  const defaults: MangadexUserPreferences = {
    dataSaver: true,
    filteredLanguages: [],
  }

  try {
    if (typeof localStorage === 'undefined') {
      logger.debug('[mangadex] localStorage not available (not in content script context)')
      return defaults
    }

    const mdData = localStorage.getItem('md')
    if (!mdData) {
      logger.debug('[mangadex] No MangaDex preferences found in localStorage')
      return defaults
    }

    const parsed: unknown = JSON.parse(mdData)
    const userPrefs = selectMangadexUserPreferencesSource(parsed)
    const result = normalizeMangadexUserPreferences(userPrefs, defaults)

    logger.debug('[mangadex] Read user preferences from localStorage:', result)
    return result
  } catch (error) {
    logger.debug('[mangadex] Failed to parse MangaDex preferences:', error)
    return defaults
  }
}

const parseConfiguredMangadexLanguageFilter = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined
  }

  return value.filter((language): language is string => typeof language === 'string')
}

const resolveMangadexContentRatings = (preferences?: MangadexUserPreferences): string[] | undefined => {
  if (!preferences) {
    return undefined
  }

  const hasContentRatingPreference = [
    preferences.showSafe,
    preferences.showSuggestive,
    preferences.showErotic,
    preferences.showHentai,
  ].some((value) => typeof value === 'boolean')

  if (!hasContentRatingPreference) {
    return undefined
  }

  const ratings: string[] = []
  if (preferences.showSafe) {
    ratings.push('safe')
  }
  if (preferences.showSuggestive) {
    ratings.push('suggestive')
  }
  if (preferences.showErotic) {
    ratings.push('erotica')
  }
  if (preferences.showHentai) {
    ratings.push('pornographic')
  }

  return ratings
}

export async function resolveMangadexChapterFeedOptions(language?: string): Promise<{
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
  const configuredLanguages = parseConfiguredMangadexLanguageFilter(storedSettings.chapterLanguageFilter)
  const cachedPreferences = cachedUserPreferences ?? undefined

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
    contentRatings: contentRatings && contentRatings.length > 0 ? contentRatings : undefined,
  }
}
