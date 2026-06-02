import type { SiteIntegrationSeriesDataset } from '../../types'
import { BASIC_CHAPTERS } from './chapter-data'

export const BASIC_SERIES: SiteIntegrationSeriesDataset = {
  id: 'COMICNETTAI_BASIC_SERIES',
  description: 'Comic Nettai reference series for mocked e2e coverage',
  series: {
    siteId: 'comicnettai',
    seriesId: '9',
    seriesTitle: '煙たい話',
    author: '林史也',
    description: '友人とも、恋人とも、家族とも違う。',
    coverUrl: 'https://cdn.comicnettai.com/9_hash/books/9/content_banner_Kemutai_Hanashi_Ver2.jpg',
  },
  chapterDatasetId: BASIC_CHAPTERS.id,
}
