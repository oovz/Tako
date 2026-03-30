import { siteIntegrationSettingsService } from '@/src/storage/site-integration-settings-service'
import {
  MANGADEX_PREFS_SESSION_KEY,
  parseMangadexPreferencesBySeries,
  type MangadexUserPreferences,
} from './mangadex/preferences-schema'

export const parseConfiguredMangadexImageQuality = (value: unknown): 'data' | 'data-saver' | undefined => {
  return value === 'data' || value === 'data-saver'
    ? value
    : undefined
}

export async function prepareMangadexDispatchContext(input: { seriesKey: string }): Promise<Record<string, unknown> | undefined> {
  let siteSettings: Record<string, unknown> = {}
  let mergedSiteSettings: Record<string, unknown> = {}
  try {
    siteSettings = await siteIntegrationSettingsService.getAll().then((allSettings) => allSettings.mangadex ?? {})
  } catch {
    siteSettings = {}
  }

  try {
    mergedSiteSettings = await siteIntegrationSettingsService.getForSite('mangadex')
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
