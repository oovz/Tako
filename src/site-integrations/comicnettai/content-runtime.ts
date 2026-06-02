import type { ContentSiteAdapter } from '@/src/types/site-integrations'
import { comicNettaiContentIntegration as content } from './index'

export const contentSiteAdapter: ContentSiteAdapter = {
  id: 'comicnettai',
  content,
}
