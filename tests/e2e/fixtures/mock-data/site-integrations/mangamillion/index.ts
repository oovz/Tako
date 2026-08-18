export { BASIC_SERIES } from "./series-data"
export { BASIC_CHAPTERS } from "./chapter-data"
export { BASIC_SERIES_PAGE_HTML, HOME_PAGE_HTML } from "./html-fixtures"
export {
  buildMangaMillionRegisterResponse,
  buildMangaMillionTitleDetailResponse,
  buildMangaMillionChapterListResponse,
  buildMangaMillionViewerResponse,
} from "./api-fixtures"
export {
  MOCK_AES_KEY,
  MOCK_AES_IV,
  MOCK_PLAIN_WEBP_BUFFER,
  MOCK_COVER_IMAGE_BUFFER,
  MOCK_ENCRYPTED_PAGE_BUFFER,
  createEncryptedPageBuffer,
} from "./image-fixtures"
export { registerMangaMillionRoutes } from "./routes"
export {
  registerMangaMillionLocalServerHandlers,
  MANGAMILLION_LOCAL_SITE_PREFIX,
  MANGAMILLION_LOCAL_API_PREFIX,
  MANGAMILLION_LOCAL_CDN_PREFIX,
  MANGAMILLION_SITE_RULE_ID,
  MANGAMILLION_API_RULE_ID,
  MANGAMILLION_CDN_RULE_ID,
} from "./local-server"

export type {
  SiteIntegrationChapterData,
  SiteIntegrationSeriesData,
} from "../../types"
