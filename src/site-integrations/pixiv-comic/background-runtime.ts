import type {
  BackgroundSiteAdapter,
  ServiceWorkerIntegration,
} from '@/src/types/site-integrations'
import { preparePixivDispatchContext } from './background-context'
import { fetchPixivChapterList, fetchPixivSeriesMetadata } from './series-api'

const background: ServiceWorkerIntegration = {
  name: 'Pixiv Comic Background',
  series: {
    fetchSeriesMetadata: fetchPixivSeriesMetadata,
    fetchChapterList: fetchPixivChapterList,
  },
  prepareDispatchContext: async () => {
    return preparePixivDispatchContext()
  },
}

export const backgroundSiteAdapter: BackgroundSiteAdapter = {
  id: 'pixiv-comic',
  background,
}
