import type { SiteIntegrationSettingsReader } from "@/src/types/site-integrations"
import {
  MANGADEX_PREFERENCES_BY_SERIES_SESSION_KEY,
  parseMangadexPreferencesBySeries,
} from "./preferences-schema"
import {
  MangadexDispatchContextSchema,
  type MangadexDispatchContext,
} from "./contracts/dispatch-context"

export const parseConfiguredMangadexImageQuality = (
  value: unknown
): "data" | "data-saver" | undefined => {
  return value === "data" || value === "data-saver" ? value : undefined
}

export async function prepareMangadexDispatchContext(input: {
  seriesKey: string
  siteIntegrationSettingsReader: SiteIntegrationSettingsReader
}): Promise<MangadexDispatchContext | undefined> {
  const siteSettings =
    await input.siteIntegrationSettingsReader.getForSite("mangadex")

  const context: MangadexDispatchContext = {}
  const configuredImageQuality = parseConfiguredMangadexImageQuality(
    siteSettings.imageQuality
  )
  if (configuredImageQuality) {
    context.mangadexConfiguredImageQuality = configuredImageQuality
  }

  if (siteSettings.autoReadMangaDexSettings !== false) {
    const session = await chrome.storage.session.get(
      MANGADEX_PREFERENCES_BY_SERIES_SESSION_KEY
    )
    const preferences = parseMangadexPreferencesBySeries(
      session[MANGADEX_PREFERENCES_BY_SERIES_SESSION_KEY]
    )[input.seriesKey]
    if (preferences) {
      context.mangadexUserPreferences = preferences
    }
  }

  return Object.keys(context).length > 0
    ? MangadexDispatchContextSchema.parse(context)
    : undefined
}
