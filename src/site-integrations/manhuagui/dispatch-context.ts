import logger from '@/src/runtime/logger';
import { MANHUAGUI_BASE_URL } from './shared';

/**
 * Manhuagui gates adult-rated chapters behind a client-side age-warning
 * screen. Clicking the "进入成年频道" button on the site sets the
 * `isAdult=1` cookie on `.manhuagui.com`, after which all subsequent pages
 * return the real content.
 *
 * Because the background service worker fetches chapter HTML directly (no
 * user gesture to click through the warning), we proactively set the cookie
 * at dispatch time. Once set, `credentials: 'include'` requests from
 * `rateLimitedFetchByUrlScope` automatically carry it.
 *
 * Cookie values below are derived from the site's own `setCookie("isAdult",
 * "1", ...)` invocation in the warning JavaScript.
 */
const MANHUAGUI_ADULT_COOKIE_NAME = 'isAdult';
const MANHUAGUI_ADULT_COOKIE_VALUE = '1';
const MANHUAGUI_ADULT_COOKIE_DOMAIN = '.manhuagui.com';
const MANHUAGUI_ADULT_COOKIE_PATH = '/';
/** One year in seconds. Matches what the site itself sets. */
const MANHUAGUI_ADULT_COOKIE_TTL_SECONDS = 365 * 24 * 60 * 60;

/**
 * Idempotently ensure the Manhuagui `isAdult=1` cookie is set for
 * `.manhuagui.com`.
 *
 * Silently no-ops when `chrome.cookies` is unavailable (test environments,
 * permission-stripped contexts) so callers never throw. Failures are logged
 * at `warn` because an age-gated chapter fetch will then produce a more
 * specific error further down the pipeline.
 */
export async function ensureManhuaguiAdultCookie(): Promise<void> {
  if (!chrome.cookies?.set) {
    logger.debug('[manhuagui] chrome.cookies.set unavailable; skipping adult-cookie priming');
    return;
  }

  try {
    await chrome.cookies.set({
      url: MANHUAGUI_BASE_URL,
      name: MANHUAGUI_ADULT_COOKIE_NAME,
      value: MANHUAGUI_ADULT_COOKIE_VALUE,
      domain: MANHUAGUI_ADULT_COOKIE_DOMAIN,
      path: MANHUAGUI_ADULT_COOKIE_PATH,
      expirationDate: Math.floor(Date.now() / 1000) + MANHUAGUI_ADULT_COOKIE_TTL_SECONDS,
    });
  } catch (error) {
    logger.warn('[manhuagui] Failed to set isAdult cookie; adult-gated chapters may fail to fetch', error);
  }
}

/**
 * `prepareDispatchContext` hook for the Manhuagui integration. Currently only
 * primes the adult-gate cookie; returns `undefined` because the integration
 * does not forward any per-dispatch data to offscreen.
 */
export async function prepareManhuaguiDispatchContext(): Promise<Record<string, unknown> | undefined> {
  await ensureManhuaguiAdultCookie();
  return undefined;
}
