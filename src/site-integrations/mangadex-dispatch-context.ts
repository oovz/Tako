import { siteIntegrationSettingsService } from "@/src/storage/site-integration-settings-service"
import {
  MANGADEX_PREFERENCES_BY_SERIES_SESSION_KEY,
  parseMangadexPreferencesBySeries,
} from "./mangadex/preferences-schema"

export const parseConfiguredMangadexImageQuality = (
  value: unknown
): "data" | "data-saver" | undefined => {
  return value === "data" || value === "data-saver" ? value : undefined
}

export async function prepareMangadexDispatchContext(input: {
  seriesKey: string
}): Promise<Record<string, unknown> | undefined> {
  let siteSettings: Record<string, unknown>
  try {
    siteSettings = await siteIntegrationSettingsService.getForSite("mangadex")
  } catch {
    siteSettings = {}
  }

  const context: Record<string, unknown> = {}
  const configuredImageQuality = parseConfiguredMangadexImageQuality(
    siteSettings.imageQuality
  )
  if (configuredImageQuality) {
    context.mangadexConfiguredImageQuality = configuredImageQuality
  }

  if (siteSettings.autoReadMangaDexSettings !== false) {
    try {
      const session = await chrome.storage.session.get(
        MANGADEX_PREFERENCES_BY_SERIES_SESSION_KEY
      )
      const preferences = parseMangadexPreferencesBySeries(
        session[MANGADEX_PREFERENCES_BY_SERIES_SESSION_KEY]
      )[input.seriesKey]
      if (preferences) {
        context.mangadexUserPreferences = preferences
      }
    } catch {
      // Per-series page preferences are optional; retain configured defaults.
    }
  }

  return Object.keys(context).length > 0 ? context : undefined
}
