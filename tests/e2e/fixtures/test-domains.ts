/**
 * @file test-domains.ts
 * @description Backwards-compatible facade for e2e URL/domain constants and
 * helpers. All constants live in `test-domains-constants.ts`; all route
 * registration lives in `routes.ts` and each integration's
 * `mock-data/site-integrations/{id}/routes.ts`.
 *
 * Callers should migrate to importing constants from
 * `./test-domains-constants` and `registerTestRoutes` from `./routes`. This
 * file exists so the ~10 existing specs that import from
 * `./fixtures/test-domains` keep working.
 */

export {
  EXAMPLE_TEST_DOMAIN,
  EXAMPLE_BASE_URL,
  MANGADEX_TEST_DOMAIN,
  MANGADEX_BASE_URL,
  MANGADEX_DEFAULT_SERIES_PATH,
  MANGADEX_TEST_SERIES_URL,
  MANGADEX_GENERIC_SERIES_URL,
  MANGADEX_ORDER_TEST_SERIES_ID,
  MANGADEX_VIEW_TOGGLE_SERIES_ID,
  MANGADEX_STRESS_TOGGLE_SERIES_ID,
  MANGADEX_GROUPED_COLLAPSE_SERIES_ID,
  MANGADEX_LOCKED_SELECTION_SERIES_ID,
  LIVE_MANGADEX_REFERENCE_URL,
  PIXIV_COMIC_TEST_DOMAIN,
  PIXIV_COMIC_BASE_URL,
  LIVE_PIXIV_COMIC_REFERENCE_URL,
  LIVE_PIXIV_COMIC_DUPLICATE_TITLE_URL,
  LIVE_PIXIV_COMIC_DUAL_TITLE_URL,
  SHONENJUMPPLUS_TEST_DOMAIN,
  SHONENJUMPPLUS_BASE_URL,
  LIVE_SHONENJUMPPLUS_REFERENCE_URL,
  MANHUAGUI_TEST_DOMAIN,
  MANHUAGUI_BASE_URL,
  MANHUAGUI_CONFIG_SCRIPT_DOMAIN,
  MANHUAGUI_IMAGE_HOSTS,
  buildMangadexUrl,
  buildExampleUrl,
  buildPixivComicUrl,
  buildShonenJumpPlusUrl,
  buildManhuaguiUrl,
} from './test-domains-constants';

export { registerTestRoutes } from './routes';

// `MANGADEX_API_DOMAIN` historically lived in this file. Re-export from the
// mock-data module where it now resides to preserve the public import path.
export { MANGADEX_API_DOMAIN } from './mock-data/site-integrations/mangadex';
