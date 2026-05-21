import type { ContentSiteAdapter } from '@/src/types/site-integrations'
import { shonenJumpPlusContentIntegration as content } from './index'

export const contentSiteAdapter: ContentSiteAdapter = {
  id: 'shonenjumpplus',
  content,
}
