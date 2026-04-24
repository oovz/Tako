/**
 * @file index.ts
 * @description Central export for Manhuagui mock data
 */

// Chapter data
export {
  BASIC_CHAPTERS,
  ADULT_CHAPTERS,
  SMALL_SERIES,
} from './chapter-data';

// Series data
export {
  BASIC_SERIES,
  ADULT_SERIES,
  MINIMAL_SERIES,
  createManhuaguiSeries,
} from './series-data';

// HTML fixtures
export {
  BASIC_SERIES_PAGE_HTML,
  ADULT_SERIES_PAGE_HTML,
  MINIMAL_SERIES_PAGE_HTML,
  HOME_PAGE_HTML,
  CHAPTER_PAGE_PLACEHOLDER_HTML,
  buildManhuaguiChapterPageHtml,
  buildManhuaguiSeriesPageHtml,
  buildManhuaguiAdultSeriesPageHtml,
} from './html-fixtures';

// API fixtures (reader config + packed payload builders)
export {
  MANHUAGUI_CONFIG_SCRIPT_PATH,
  MANHUAGUI_CONFIG_SCRIPT_URL,
  MANHUAGUI_MOCK_IMAGE_HOST,
  MANHUAGUI_MOCK_IMAGE_DOMAIN,
  buildManhuaguiReaderConfigScript,
  buildManhuaguiPackedPayloadScript,
  buildManhuaguiChapterSlMetadata,
  buildManhuaguiChapterPathSegment,
} from './api-fixtures';
export type { ManhuaguiPackedImageData } from './api-fixtures';

// Image fixtures
export {
  MOCK_IMAGES_PER_CHAPTER,
  buildManhuaguiImageFilenames,
} from './image-fixtures';

// Route registrar
export { registerManhuaguiRoutes } from './routes';

export type { SiteIntegrationChapterData, SiteIntegrationSeriesData } from '../../types';
