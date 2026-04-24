/**
 * @file index.ts
 * @description Central export for mangadex mock data
 */

// Chapter data
export {
  BASIC_CHAPTERS,
  SMALL_SERIES,
  createMangadexChapter,
  createMangadexChapters,
} from './chapter-data';

// Series data
export {
  BASIC_SERIES,
  MINIMAL_SERIES,
  createMangadexSeries,
} from './series-data';

// HTML fixtures
export {
  SERIES_PAGE_HTML,
  MINIMAL_SERIES_PAGE_HTML,
  CHAPTER_PAGE_HTML,
  MANGADEX_HTML,
  MANGADEX_MINIMAL_HTML,
} from './html-fixtures';

// API response builders + custom fixtures
export {
  MANGADEX_API_DOMAIN,
  CUSTOM_MANGADEX_SERIES_FIXTURES,
  buildMangadexFeedResponse,
  buildMangadexSeriesResponse,
  resolveMangadexChapterDataset,
} from './api-fixtures';

// Image fixtures
export {
  MANGADEX_UPLOADS_DOMAIN,
  MANGADEX_UPLOADS_BASE_URL,
  MOCK_IMAGES_PER_CHAPTER,
  buildMangadexChapterHash,
  buildMangadexChapterImageFilenames,
  buildAtHomeServerResponse,
  resolveMangadexDownloadableChapterIds,
} from './image-fixtures';

// Route registrar
export { registerMangadexRoutes } from './routes';

// Re-export types for convenience
export type { SiteIntegrationChapterData, SiteIntegrationSeriesData } from '../../types';
