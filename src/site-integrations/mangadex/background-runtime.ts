import type {
  BackgroundSiteAdapter,
  ServiceWorkerIntegration,
} from '@/src/types/site-integrations'
import { prepareMangadexDispatchContext } from '../mangadex-dispatch-context'
import { fetchMangadexChapterList, fetchMangadexSeriesMetadata } from './series-api'

const background: ServiceWorkerIntegration = {
  name: 'MangaDex API Background',
  series: {
    fetchSeriesMetadata: fetchMangadexSeriesMetadata,
    fetchChapterList: fetchMangadexChapterList,
  },
  async prepareDispatchContext(input): Promise<Record<string, unknown> | undefined> {
    return prepareMangadexDispatchContext({ seriesKey: input.seriesKey })
  },
}

export const backgroundSiteAdapter: BackgroundSiteAdapter = {
  id: 'mangadex',
  background,
}
