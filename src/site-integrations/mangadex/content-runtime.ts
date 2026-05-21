import type { ContentSiteAdapter, ContentScriptIntegration } from '@/src/types/site-integrations'
import logger from '@/src/runtime/logger'
import { cacheMangadexPreferencesForSeries } from './preferences'
import { parseUuidFromPath } from './api'

const content: ContentScriptIntegration = {
  name: 'MangaDex API Content',
  series: {
    getSeriesId(): string {
      const id = parseUuidFromPath(window.location.pathname, 'title')
      if (!id) {
        throw new Error(`Failed to extract series ID from URL: ${window.location.pathname}`)
      }

      void cacheMangadexPreferencesForSeries(id).catch((error) => {
        logger.debug('[mangadex] Failed to cache localStorage preferences for series', error)
      })
      return id
    },
  },
}

export const contentSiteAdapter: ContentSiteAdapter = {
  id: 'mangadex',
  content,
}
