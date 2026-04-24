/**
 * @file routes.ts
 * @description Playwright route registrar for the MangaDex integration.
 *
 * Two overlapping concerns are handled here:
 *
 * 1. **Main-frame HTML navigations** to `mangadex.org/title/{id}` and
 *    `mangadex.org/chapter/{id}` — served inline so Playwright keeps the
 *    real hostname in the address bar (important for the content-script
 *    URL matcher).
 *
 * 2. **Content-script API/uploads fetches** issued from the
 *    `mangadex.org` page origin. These go through Playwright's
 *    `context.route` (which intercepts renderer-initiated requests) and
 *    return the same mock data the local HTTP server serves for
 *    extension-context fetches. Keeping both layers in sync lets the
 *    content script succeed identically to how the download pipeline
 *    does, while deliberately leaving content-script fetches unscoped
 *    from the DNR rules (those use `initiatorDomains: [extensionId]`
 *    so they apply only to SW/offscreen/popup/options fetches — see
 *    `dnr-test-redirects.ts` for the rationale).
 *
 * The same JSON responses are used by the local mock server; the
 * builders live in `./api-fixtures.ts` / `./image-fixtures.ts`.
 */

import type { Route } from '@playwright/test';
import type { RouteRegistrar } from '../../types';
import {
  MANGADEX_TEST_DOMAIN,
} from '../../../test-domains-constants';
import { cloneSmallPngBytes, SMALL_PNG_MIME_TYPE } from '../../shared';
import {
  buildMangadexFeedResponse,
  buildMangadexSeriesResponse,
  resolveMangadexChapterDataset,
} from './api-fixtures';
import { buildAtHomeServerResponse } from './image-fixtures';
import { CHAPTER_PAGE_HTML, SERIES_PAGE_HTML } from './html-fixtures';

const MANGADEX_API_DOMAIN = 'api.mangadex.org';
const MANGADEX_NETWORK_DOMAIN = 'api.mangadex.network';
const MANGADEX_UPLOADS_DOMAIN = 'uploads.mangadex.org';
const MANGADEX_HOME_HTML = '<!doctype html><html><head><meta charset="utf-8"><title>MangaDex</title></head><body>MangaDex Home</body></html>';

async function fulfillJson(route: Route, body: object): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(body),
  });
}

async function handleMangadexApiFetch(route: Route): Promise<void> {
  const url = new URL(route.request().url());
  const parts = url.pathname.split('/').filter(Boolean);

  if (parts[0] === 'at-home' && parts[1] === 'server' && typeof parts[2] === 'string') {
    await fulfillJson(route, buildAtHomeServerResponse(parts[2]));
    return;
  }

  if (parts[0] === 'statistics' && parts[1] === 'manga' && typeof parts[2] === 'string') {
    await fulfillJson(route, { result: 'ok', statistics: {} });
    return;
  }

  if (parts[0] === 'manga' && typeof parts[1] === 'string') {
    const mangaId = parts[1];
    const isFeed = parts.length >= 3 && parts[2] === 'feed';
    if (isFeed) {
      await fulfillJson(route, buildMangadexFeedResponse(resolveMangadexChapterDataset(mangaId)));
      return;
    }
    await fulfillJson(route, buildMangadexSeriesResponse(mangaId));
    return;
  }

  await fulfillJson(route, { result: 'error', message: 'not mocked' });
}

export const registerMangadexRoutes: RouteRegistrar = async (context, options) => {
  if (!options.useMocks) {
    return;
  }

  await context.route(`https://${MANGADEX_TEST_DOMAIN}/**`, async (route: Route) => {
    const url = new URL(route.request().url());

    if (url.pathname.startsWith('/title/')) {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: SERIES_PAGE_HTML,
      });
      return;
    }

    if (url.pathname.startsWith('/chapter/')) {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: CHAPTER_PAGE_HTML,
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: MANGADEX_HOME_HTML,
    });
  });

  // Content-script fetches from mangadex.org pages reach the API hosts
  // as standard cross-origin requests. Playwright intercepts those at
  // the renderer level; DNR-backed mocks only cover extension-context
  // fetches (see `dnr-test-redirects.ts`'s initiator scoping).
  await context.route(`https://${MANGADEX_API_DOMAIN}/**`, handleMangadexApiFetch);

  await context.route(`https://${MANGADEX_NETWORK_DOMAIN}/**`, async (route: Route) => {
    await route.fulfill({ status: 204, body: '' });
  });

  await context.route(`https://${MANGADEX_UPLOADS_DOMAIN}/**`, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: SMALL_PNG_MIME_TYPE,
      body: Buffer.from(cloneSmallPngBytes()),
    });
  });
};
