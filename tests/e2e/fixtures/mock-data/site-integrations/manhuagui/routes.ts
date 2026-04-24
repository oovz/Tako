/**
 * @file routes.ts
 * @description Playwright route registrar for the Manhuagui integration.
 *
 * Mocked hosts:
 * - `www.manhuagui.com` — series HTML (normal + adult-gated) and chapter
 *   viewer HTML with a real packed-payload script.
 * - `cf.mhgui.com` — reader-config script (`/scripts/config_*.js`).
 * - `*.hamreus.com` — chapter image host (serves the shared 1x1 PNG for
 *   any signed `?e={expiry}&m={signature}` request).
 */

import type { Route } from '@playwright/test';
import type { RouteRegistrar } from '../../types';
import {
  MANHUAGUI_CONFIG_SCRIPT_DOMAIN,
  MANHUAGUI_TEST_DOMAIN,
} from '../../../test-domains-constants';
import { cloneSmallPngBytes, SMALL_PNG_MIME_TYPE } from '../../shared';
import {
  MANHUAGUI_CONFIG_SCRIPT_PATH,
  MANHUAGUI_MOCK_IMAGE_DOMAIN,
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

export const registerManhuaguiRoutes: RouteRegistrar = async (context, options) => {
  if (!options.useMocks) {
    return;
  }

  await context.route(`https://${MANHUAGUI_TEST_DOMAIN}/**`, async (route: Route) => {
    const url = new URL(route.request().url());

    const html = (body: string) => route.fulfill({
      status: 200,
      // Manhuagui serves gb2312/GBK pages in production. `decodeHtmlResponse`
      // normalizes the charset; for the mock we serve UTF-8 since every
      // fixture string here is already UTF-8 and the decoder respects the
      // declared `charset` parameter.
      contentType: 'text/html; charset=utf-8',
      body,
    });

    // HTML: /comic/{seriesId}/{chapterId}.html (chapter viewer page) —
    // per-(series,chapter) HTML so signed paths match the downloader's
    // expected layout.
    const chapterMatch = url.pathname.match(/^\/comic\/(\d+)\/(\d+)(?:_p\d+)?\.html$/);
    if (chapterMatch) {
      const [, seriesId, chapterId] = chapterMatch;
      return html(buildManhuaguiChapterPageHtml({ seriesId, chapterId }));
    }

    // HTML: /comic/{seriesId}/ or /comic/{seriesId}
    const seriesMatch = url.pathname.match(/^\/comic\/(\d+)\/?$/);
    if (seriesMatch) {
      const seriesId = seriesMatch[1];
      if (seriesId === BASIC_SERIES.series.seriesId) return html(BASIC_SERIES_PAGE_HTML);
      if (seriesId === ADULT_SERIES.series.seriesId) return html(ADULT_SERIES_PAGE_HTML);
      if (seriesId === MINIMAL_SERIES.series.seriesId) return html(MINIMAL_SERIES_PAGE_HTML);
      // Unknown series id: synthesize a bare series page so the content
      // script still resolves an id. Chapter list will be empty.
      return html(buildManhuaguiSeriesPageHtml({
        seriesId,
        seriesTitle: `Series ${seriesId}`,
        groups: [],
      }));
    }

    return html(HOME_PAGE_HTML);
  });

  // cf.mhgui.com — reader-config script. `fetchReaderConfig` parses the
  // response text to select an image host. We serve the same script for
  // every `/scripts/config_*.js` request; the path-regex match is enough
  // to satisfy the chapter-viewer extractor.
  await context.route(`https://${MANHUAGUI_CONFIG_SCRIPT_DOMAIN}/**`, async (route: Route) => {
    const url = new URL(route.request().url());
    if (url.pathname === MANHUAGUI_CONFIG_SCRIPT_PATH || /^\/scripts\/config_[^/]+\.js$/.test(url.pathname)) {
      return route.fulfill({
        status: 200,
        contentType: 'application/javascript; charset=utf-8',
        body: buildManhuaguiReaderConfigScript(),
      });
    }

    // Cover images live on the same host in production (`/cpic/b/...`).
    // Serve the shared PNG so any background cover fetch resolves cleanly.
    return route.fulfill({
      status: 200,
      contentType: SMALL_PNG_MIME_TYPE,
      body: cloneSmallPngBytes(),
    });
  });

  // Image host — serves the shared 1x1 PNG for every request. We route
  // just the single mock image host since `buildManhuaguiReaderConfigScript`
  // always steers the selector to it.
  await context.route(`https://${MANHUAGUI_MOCK_IMAGE_DOMAIN}/**`, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: SMALL_PNG_MIME_TYPE,
      body: cloneSmallPngBytes(),
    });
  });
};
