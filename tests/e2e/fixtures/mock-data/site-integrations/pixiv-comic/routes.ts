/**
 * @file routes.ts
 * @description Playwright route registrar for the Pixiv Comic integration.
 *
 * Layer-1 coverage: the page host (`comic.pixiv.net`) serves HTML, work
 * metadata, and episode lists. Image hosts (`img-comic.pximg.net`) and the
 * Next.js `_next/data/*` reader endpoints are NOT mocked here — Phase 3
 * adds them alongside download-workflow specs.
 */

import type { Route } from '@playwright/test';
import type { RouteRegistrar } from '../../types';
import { PIXIV_COMIC_TEST_DOMAIN } from '../../../test-domains-constants';
import {
  BASIC_WORK_PAGE_HTML,
  HOME_PAGE_HTML,
  MINIMAL_WORK_PAGE_HTML,
  VIEWER_PAGE_HTML,
  buildPixivComicWorkPageHtml,
} from './html-fixtures';
import {
  buildPixivEpisodesV2Response,
  buildPixivWorkV5Response,
} from './api-fixtures';
import { BASIC_SERIES, MINIMAL_SERIES } from './series-data';

export const registerPixivComicRoutes: RouteRegistrar = async (context, options) => {
  if (!options.useMocks) {
    return;
  }

  await context.route(`https://${PIXIV_COMIC_TEST_DOMAIN}/**`, async (route: Route) => {
    const url = new URL(route.request().url());

    const json = (body: unknown) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });

    const html = (body: string) => route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body,
    });

    // API: /api/app/works/v5/{workId}
    const workV5Match = url.pathname.match(/^\/api\/app\/works\/v5\/(\d+)$/);
    if (workV5Match) {
      return json(buildPixivWorkV5Response(workV5Match[1]));
    }

    // API: /api/app/works/{workId}/episodes/v2
    const episodesV2Match = url.pathname.match(/^\/api\/app\/works\/(\d+)\/episodes\/v2$/);
    if (episodesV2Match) {
      return json(buildPixivEpisodesV2Response(episodesV2Match[1]));
    }

    // HTML: /works/{workId}
    const worksMatch = url.pathname.match(/^\/works\/(\d+)\/?$/);
    if (worksMatch) {
      const workId = worksMatch[1];
      if (workId === BASIC_SERIES.series.seriesId) return html(BASIC_WORK_PAGE_HTML);
      if (workId === MINIMAL_SERIES.series.seriesId) return html(MINIMAL_WORK_PAGE_HTML);
      return html(buildPixivComicWorkPageHtml(workId, `Work ${workId}`));
    }

    // HTML: /viewer/stories/{id}
    if (url.pathname.startsWith('/viewer/stories/')) {
      return html(VIEWER_PAGE_HTML);
    }

    // Unmatched API paths return a structured error so the background
    // integration fails fast instead of hanging on unmocked requests.
    if (url.pathname.startsWith('/api/')) {
      return route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'not_mocked', path: url.pathname }),
      });
    }

    return html(HOME_PAGE_HTML);
  });
};
