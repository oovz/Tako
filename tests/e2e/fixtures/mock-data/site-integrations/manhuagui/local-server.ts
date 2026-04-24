/**
 * @file local-server.ts
 * @description Local-mock-server handlers + DNR redirect rules for the
 * Manhuagui integration.
 *
 * Offscreen-initiated fetches for Manhuagui cover three hosts:
 *
 *   1. `www.manhuagui.com/comic/{seriesId}/{chapterId}.html` — chapter
 *      viewer HTML. Offscreen's `resolveImageUrls` reads the packed
 *      payload from this page.
 *   2. `cf.mhgui.com/scripts/config_*.js` — reader-config script that
 *      selects an image host for the chapter. Offscreen fetches it
 *      while decoding the packed payload.
 *   3. `*.hamreus.com/...` — the image host where chapter pages are
 *      actually downloaded from (the only relevant host here is
 *      `i.hamreus.com` because `buildManhuaguiReaderConfigScript` only
 *      resolves to that one).
 *
 * We also redirect the series-page URL so a direct `page.goto` to a
 * series URL resolves even if Playwright's context.route racing ever
 * misses it. Playwright routes for www.manhuagui.com continue to exist
 * and will still take precedence for page-context fetches — DNR only
 * kicks in for fetches Playwright didn't answer (which, empirically,
 * is offscreen).
 */

import type { DnrRedirectRule } from '../../../dnr-test-redirects';
import type { LocalMockServerHandle, MockRouteHandler } from '../../../local-mock-server';
import { cloneSmallPngBytes, SMALL_PNG_MIME_TYPE } from '../../shared';
import {
  MANHUAGUI_CONFIG_SCRIPT_PATH,
  buildManhuaguiReaderConfigScript,
} from './api-fixtures';
import {
  ADULT_SERIES_PAGE_HTML,
  BASIC_SERIES_PAGE_HTML,
  HOME_PAGE_HTML,
  MINIMAL_SERIES_PAGE_HTML,
  buildManhuaguiChapterPageHtml,
  buildManhuaguiSeriesPageHtml,
} from './html-fixtures';
import { ADULT_SERIES, BASIC_SERIES, MINIMAL_SERIES } from './series-data';

/**
 * Pathname prefixes under which the local server mounts Manhuagui
 * handlers. DNR redirect rules place captured paths directly after these
 * prefixes so handlers can reuse the production-style path patterns.
 */
export const MANHUAGUI_LOCAL_PREFIX = '/__mh/manhuagui';
export const MANHUAGUI_CONFIG_LOCAL_PREFIX = '/__mh/mhgui-config';
export const MANHUAGUI_IMAGE_LOCAL_PREFIX = '/__mh/hamreus';

/**
 * Assigned DNR rule ids. Must remain in the 9000–9999 test range
 * (validated by `dnr-test-redirects.ts`). Distinct ids per pattern so
 * individual rules can be toggled without disturbing the others.
 */
const MANHUAGUI_MAIN_RULE_ID = 9100;
const MANHUAGUI_CONFIG_RULE_ID = 9101;
const MANHUAGUI_IMAGE_RULE_ID = 9102;

function html(body: string): { status: number; headers: Record<string, string>; body: string } {
  return {
    status: 200,
    // Manhuagui serves gb2312/GBK pages in production; the extension's
    // decoder handles the declared charset. Our fixtures are UTF-8 so
    // we advertise UTF-8 explicitly.
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body,
  };
}

/**
 * www.manhuagui.com handler — dispatches by pathname suffix:
 * - `/comic/{id}/{chapter}.html` → chapter viewer with packed payload
 * - `/comic/{id}/` or `/comic/{id}` → series page HTML (known series
 *   use the fixed fixtures; unknown ids fall back to a synthesized
 *   minimal series page so content-script extraction still runs)
 * - anything else → the home-page placeholder
 */
const manhuaguiMainHandler: MockRouteHandler = (req) => {
  const pathname = req.pathnameAfterPrefix;

  const chapterMatch = pathname.match(/^\/comic\/(\d+)\/(\d+)(?:_p\d+)?\.html$/);
  if (chapterMatch) {
    const [, seriesId, chapterId] = chapterMatch;
    return html(buildManhuaguiChapterPageHtml({ seriesId, chapterId }));
  }

  const seriesMatch = pathname.match(/^\/comic\/(\d+)\/?$/);
  if (seriesMatch) {
    const seriesId = seriesMatch[1];
    if (seriesId === BASIC_SERIES.series.seriesId) return html(BASIC_SERIES_PAGE_HTML);
    if (seriesId === ADULT_SERIES.series.seriesId) return html(ADULT_SERIES_PAGE_HTML);
    if (seriesId === MINIMAL_SERIES.series.seriesId) return html(MINIMAL_SERIES_PAGE_HTML);
    return html(
      buildManhuaguiSeriesPageHtml({ seriesId, seriesTitle: `Series ${seriesId}`, groups: [] }),
    );
  }

  return html(HOME_PAGE_HTML);
};

/**
 * cf.mhgui.com handler — serves the reader-config script for any
 * `/scripts/config_*.js` request. Cover images on the same host fall
 * back to the shared 1x1 PNG so cover-fetches don't spurious-fail.
 */
const manhuaguiConfigHandler: MockRouteHandler = (req) => {
  const pathname = req.pathnameAfterPrefix;

  if (pathname === MANHUAGUI_CONFIG_SCRIPT_PATH || /^\/scripts\/config_[^/]+\.js$/.test(pathname)) {
    return {
      status: 200,
      headers: { 'content-type': 'application/javascript; charset=utf-8' },
      body: buildManhuaguiReaderConfigScript(),
    };
  }

  return {
    status: 200,
    headers: { 'content-type': SMALL_PNG_MIME_TYPE },
    body: cloneSmallPngBytes(),
  };
};

/** i.hamreus.com handler — returns the shared 1x1 PNG for every path. */
const manhuaguiImageHandler: MockRouteHandler = () => ({
  status: 200,
  headers: { 'content-type': SMALL_PNG_MIME_TYPE },
  body: cloneSmallPngBytes(),
});

/**
 * Register the Manhuagui handlers on the given local mock server and
 * return the DNR redirect rules that steer external URLs to them.
 *
 * Callers are responsible for invoking
 * `installDnrRedirectRules(swWorker, [...rules])` after the service
 * worker is available.
 */
export function registerManhuaguiLocalServerHandlers(
  server: LocalMockServerHandle,
): DnrRedirectRule[] {
  server.addRoute(MANHUAGUI_LOCAL_PREFIX, manhuaguiMainHandler);
  server.addRoute(MANHUAGUI_CONFIG_LOCAL_PREFIX, manhuaguiConfigHandler);
  server.addRoute(MANHUAGUI_IMAGE_LOCAL_PREFIX, manhuaguiImageHandler);

  const base = server.url;
  return [
    {
      id: MANHUAGUI_MAIN_RULE_ID,
      // `^https?://(?:www\.)?manhuagui\.com/(.*)$` captures the full path
      // (including query) into \1. We prepend our prefix and let the
      // handler parse the tail against the original pathname shape.
      regexFilter: '^https?://(?:www\\.)?manhuagui\\.com/(.*)$',
      regexSubstitution: `${base}${MANHUAGUI_LOCAL_PREFIX}/\\1`,
    },
    {
      id: MANHUAGUI_CONFIG_RULE_ID,
      regexFilter: '^https?://cf\\.mhgui\\.com/(.*)$',
      regexSubstitution: `${base}${MANHUAGUI_CONFIG_LOCAL_PREFIX}/\\1`,
    },
    {
      id: MANHUAGUI_IMAGE_RULE_ID,
      regexFilter: '^https?://[a-z0-9-]+\\.hamreus\\.com/(.*)$',
      regexSubstitution: `${base}${MANHUAGUI_IMAGE_LOCAL_PREFIX}/\\1`,
    },
  ];
}
