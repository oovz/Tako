import { siteIntegrationSettingsService } from '@/src/storage/site-integration-settings-service'

const MANGADEX_PREFS_SESSION_KEY = 'mangadexUserPreferencesBySeries'

type MangadexUserPreferences = {
  dataSaver: boolean
  filteredLanguages: string[]
}

type MangadexPreferencesBySeries = Record<string, MangadexUserPreferences>

const isMangadexUserPreferences = (value: unknown): value is MangadexUserPreferences => {
  if (!value || typeof value !== 'object') {
    return false
  }

  const record = value as Record<string, unknown>
  return typeof record.dataSaver === 'boolean'
    && Array.isArray(record.filteredLanguages)
    && record.filteredLanguages.every((lang) => typeof lang === 'string')
}

const parseMangadexPreferencesBySeries = (value: unknown): MangadexPreferencesBySeries => {
  if (!value || typeof value !== 'object') {
    return {}
  }

  const record = value as Record<string, unknown>
  const parsed: MangadexPreferencesBySeries = {}
  for (const [seriesKey, prefs] of Object.entries(record)) {
    if (isMangadexUserPreferences(prefs)) {
      parsed[seriesKey] = prefs
    }
  }

  return parsed
}

export const parseConfiguredMangadexImageQuality = (value: unknown): 'data' | 'data-saver' | undefined => {
  return value === 'data' || value === 'data-saver'
    ? value
    : undefined
}

export async function prepareMangadexDispatchContext(input: { seriesKey: string }): Promise<Record<string, unknown> | undefined> {
  let siteSettings: Record<string, unknown> = {}
  let mergedSiteSettings: Record<string, unknown> = {}
  try {
    const allSettings = await siteIntegrationSettingsService.getAll() as Record<string, unknown>
    const rawSiteSettings = allSettings.mangadex
    if (rawSiteSettings && typeof rawSiteSettings === 'object' && !Array.isArray(rawSiteSettings)) {
      siteSettings = rawSiteSettings as Record<string, unknown>
    }
  } catch {
    siteSettings = {}
  }

  try {
    mergedSiteSettings = await siteIntegrationSettingsService.getForSite('mangadex') as Record<string, unknown>
  } catch {
    mergedSiteSettings = {}
  }

  const configuredImageQuality = parseConfiguredMangadexImageQuality(siteSettings.imageQuality)
  const autoReadEnabled = mergedSiteSettings.autoReadMangaDexSettings !== false

  if (!autoReadEnabled && !configuredImageQuality) {
    return undefined
  }

  let prefs: MangadexUserPreferences | undefined
  if (autoReadEnabled && typeof chrome !== 'undefined' && chrome.storage?.session) {
    const session = await chrome.storage.session.get(MANGADEX_PREFS_SESSION_KEY) as Record<string, unknown>
    const bySeries = parseMangadexPreferencesBySeries(session[MANGADEX_PREFS_SESSION_KEY])
    prefs = bySeries[input.seriesKey]
  }

  if (!prefs && !configuredImageQuality) {
    return undefined
  }

  return {
    ...(configuredImageQuality ? { mangadexConfiguredImageQuality: configuredImageQuality } : {}),
    ...(prefs ? { mangadexUserPreferences: prefs } : {}),
  }
}
