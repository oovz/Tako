/**
 * @file index.ts
 * @description Central export for Pixiv Comic mock data.
 */

export { BASIC_CHAPTERS, SMALL_SERIES } from "./chapter-data"

export {
  BASIC_SERIES,
  MINIMAL_SERIES,
  createPixivComicSeries,
} from "./series-data"

export {
  BASIC_WORK_PAGE_HTML,
  MINIMAL_WORK_PAGE_HTML,
  HOME_PAGE_HTML,
  VIEWER_PAGE_HTML,
  buildPixivComicWorkPageHtml,
} from "./html-fixtures"

export {
  PIXIV_COMIC_API_DOMAIN,
  PIXIV_COMIC_CAPTURED_STORY_ID,
  PIXIV_COMIC_CAPTURED_PAGE_COUNT,
  PIXIV_COMIC_BUILD_ID,
  buildPixivWorkV5Response,
  buildPixivEpisodesV2Response,
  buildPixivStoryPageResponse,
  buildPixivReadV4Response,
} from "./api-fixtures"

export { registerPixivComicRoutes } from "./routes"

export type {
  SiteIntegrationChapterData,
  SiteIntegrationSeriesData,
} from "../../types"
