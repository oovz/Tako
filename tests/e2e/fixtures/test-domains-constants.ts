/**
 * @file test-domains-constants.ts
 * @description Pure URL/domain constants used by e2e mock fixtures and specs.
 *
 * This file MUST NOT import from `mock-data/` (or any module that imports
 * from it). Every integration's `routes.ts` / `api-fixtures.ts` reads from
 * here so the fixture graph stays acyclic. Import these values directly from
 * this module; route registration belongs to `routes.ts` and integration
 * mock-data modules own their integration-specific exports.
 */

import {
  MANHUAGUI_BASE_URL as MANHUAGUI_POLICY_BASE_URL,
  MANHUAGUI_CONFIG_HOST,
  MANHUAGUI_IMAGE_HOST_NAMES,
  MANHUAGUI_PAGE_HOST_NAMES,
} from "../../../src/site-integrations/manhuagui/policy"

export const EXAMPLE_TEST_DOMAIN = "example.com"
export const EXAMPLE_BASE_URL = `https://${EXAMPLE_TEST_DOMAIN}`

export const MANGADEX_TEST_DOMAIN = "mangadex.org"
export const MANGADEX_BASE_URL = `https://${MANGADEX_TEST_DOMAIN}`
export const MANGADEX_DEFAULT_SERIES_PATH =
  "/title/db692d58-4b13-4174-ae8c-30c515c0689c/hunter-x-hunter"
export const MANGADEX_TEST_SERIES_URL = new URL(
  MANGADEX_DEFAULT_SERIES_PATH,
  MANGADEX_BASE_URL
).toString()
export const MANGADEX_GENERIC_SERIES_URL = new URL(
  MANGADEX_DEFAULT_SERIES_PATH,
  MANGADEX_BASE_URL
).toString()
export const MANGADEX_ORDER_TEST_SERIES_ID =
  "11111111-1111-4111-8111-111111111111"
export const MANGADEX_VIEW_TOGGLE_SERIES_ID =
  "22222222-2222-4222-8222-222222222222"
export const MANGADEX_STRESS_TOGGLE_SERIES_ID =
  "33333333-3333-4333-8333-333333333333"
export const MANGADEX_GROUPED_COLLAPSE_SERIES_ID =
  "44444444-4444-4444-8444-444444444444"
export const MANGADEX_LOCKED_SELECTION_SERIES_ID =
  "55555555-5555-4555-8555-555555555555"
export const LIVE_MANGADEX_REFERENCE_URL =
  "https://mangadex.org/title/db692d58-4b13-4174-ae8c-30c515c0689c/hunter-x-hunter"

export const PIXIV_COMIC_TEST_DOMAIN = "comic.pixiv.net"
export const PIXIV_COMIC_BASE_URL = `https://${PIXIV_COMIC_TEST_DOMAIN}`
export const LIVE_PIXIV_COMIC_REFERENCE_URL =
  "https://comic.pixiv.net/works/9012"
export const LIVE_PIXIV_COMIC_DUPLICATE_TITLE_URL =
  "https://comic.pixiv.net/works/6842"
export const LIVE_PIXIV_COMIC_DUAL_TITLE_URL =
  "https://comic.pixiv.net/works/6289"

export const SHONENJUMPPLUS_TEST_DOMAIN = "shonenjumpplus.com"
export const SHONENJUMPPLUS_BASE_URL = `https://${SHONENJUMPPLUS_TEST_DOMAIN}`
export const LIVE_SHONENJUMPPLUS_REFERENCE_URL =
  "https://shonenjumpplus.com/episode/10834108156648240735"

export const MANHUAGUI_TEST_DOMAIN = MANHUAGUI_PAGE_HOST_NAMES[0]
export const MANHUAGUI_BASE_URL = MANHUAGUI_POLICY_BASE_URL
export const LIVE_MANHUAGUI_REFERENCE_URL =
  "https://www.manhuagui.com/comic/19430/"
export const LIVE_MANHUAGUI_ADULT_REFERENCE_URL =
  "https://www.manhuagui.com/comic/21243/"
export const MANHUAGUI_CONFIG_SCRIPT_DOMAIN = MANHUAGUI_CONFIG_HOST
export const MANHUAGUI_IMAGE_HOSTS = MANHUAGUI_IMAGE_HOST_NAMES

export const COMICNETTAI_TEST_DOMAIN = "www.comicnettai.com"
export const COMICNETTAI_BASE_URL = `https://${COMICNETTAI_TEST_DOMAIN}`
export const LIVE_COMICNETTAI_REFERENCE_URL =
  "https://www.comicnettai.com/book/9"

export const MANGAMILLION_TEST_DOMAIN = "mangamillion.shueisha.co.jp"
export const MANGAMILLION_BASE_URL = `https://${MANGAMILLION_TEST_DOMAIN}`
export const LIVE_MANGAMILLION_REFERENCE_URL =
  "https://mangamillion.shueisha.co.jp/en/title/1"
export const LIVE_MANGAMILLION_CHAPTER_URL =
  "https://mangamillion.shueisha.co.jp/en/title/1/chapter/6736"

export function buildMangadexUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`
  return new URL(normalized, MANGADEX_BASE_URL).toString()
}

export function buildExampleUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`
  return new URL(normalized, EXAMPLE_BASE_URL).toString()
}

export function buildPixivComicUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`
  return new URL(normalized, PIXIV_COMIC_BASE_URL).toString()
}

export function buildShonenJumpPlusUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`
  return new URL(normalized, SHONENJUMPPLUS_BASE_URL).toString()
}

export function buildManhuaguiUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`
  return new URL(normalized, MANHUAGUI_BASE_URL).toString()
}

export function buildComicNettaiUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`
  return new URL(normalized, COMICNETTAI_BASE_URL).toString()
}

export function buildMangaMillionTestUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`
  return new URL(normalized, MANGAMILLION_BASE_URL).toString()
}
