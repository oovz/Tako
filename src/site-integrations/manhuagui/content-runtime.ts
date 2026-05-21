import type { ContentSiteAdapter } from '@/src/types/site-integrations'
import { manhuaguiContentIntegration as content } from './index'

export const contentSiteAdapter: ContentSiteAdapter = {
  id: 'manhuagui',
  content,
}
