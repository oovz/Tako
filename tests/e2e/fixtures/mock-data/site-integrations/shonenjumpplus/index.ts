/**
 * @file index.ts
 * @description Central export for Shonen Jump+ mock data.
 */

export {
  BASIC_CHAPTERS,
  SMALL_SERIES,
} from './chapter-data';

export {
  BASIC_SERIES,
  MINIMAL_SERIES,
  SERIES_AGGREGATE_IDS,
  createShonenJumpPlusSeries,
} from './series-data';

export {
  BASIC_EPISODE_PAGE_HTML,
  MINIMAL_EPISODE_PAGE_HTML,
  HOME_PAGE_HTML,
  buildShonenJumpPlusEpisodePageHtml,
} from './html-fixtures';

export {
  buildReadableProductPaginationInfoResponse,
  buildPaginationReadableProductsResponse,
} from './api-fixtures';

export { registerShonenJumpPlusRoutes } from './routes';

export type { SiteIntegrationChapterData, SiteIntegrationSeriesData } from '../../types';
