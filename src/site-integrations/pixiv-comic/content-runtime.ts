import type { ContentSiteAdapter, ContentScriptIntegration } from '@/src/types/site-integrations'
import { resolvePixivWorkIdFromPage, waitForPixivWorkPageReady } from './page-context'

const content: ContentScriptIntegration = {
  name: 'Pixiv Comic Content',
  series: {
    waitForPageReady: waitForPixivWorkPageReady,
    getSeriesId(): string {
      const workId = resolvePixivWorkIdFromPage()
      if (!workId) {
        throw new Error('Failed to resolve Pixiv Comic work id from page context')
      }
      return workId
    },
  },
}

export const contentSiteAdapter: ContentSiteAdapter = {
  id: 'pixiv-comic',
  content,
}
