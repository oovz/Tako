/**
 * @file routes.ts
 * @description Playwright route registrar for the Shonen Jump+ integration.
 *
 * Mocks the single host `shonenjumpplus.com` for:
 * - `/episode/{id}` page HTML (with embedded episode-json script)
 * - `/api/viewer/readable_product_pagination_information`
 * - `/api/viewer/pagination_readable_products`
 *
 * Image hosts (`cdn-ak-img.shonenjumpplus.com` and the gigaviewer CDN) are
 * NOT mocked here — Phase 3 covers them with pre-scrambled fixtures.
 */

import type { Route } from '@playwright/test';
import type { RouteRegistrar } from '../../types';
import { SHONENJUMPPLUS_TEST_DOMAIN } from '../../../test-domains-constants';
import {
  BASIC_EPISODE_PAGE_HTML,
  HOME_PAGE_HTML,
  MINIMAL_EPISODE_PAGE_HTML,
  buildShonenJumpPlusEpisodePageHtml,
} from './html-fixtures';
import {
  buildPaginationReadableProductsResponse,
  buildReadableProductPaginationInfoResponse,
} from './api-fixtures';
import { BASIC_SERIES, MINIMAL_SERIES, SERIES_AGGREGATE_IDS } from './series-data';

export const registerShonenJumpPlusRoutes: RouteRegistrar = async (context, options) => {
  if (!options.useMocks) {
    return;
  }

  await context.route(`https://${SHONENJUMPPLUS_TEST_DOMAIN}/**`, async (route: Route) => {
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

    // API: /api/viewer/readable_product_pagination_information
    if (url.pathname === '/api/viewer/readable_product_pagination_information') {
      const aggregateId = url.searchParams.get('aggregate_id') ?? '';
      return json(buildReadableProductPaginationInfoResponse(aggregateId));
    }

    // API: /api/viewer/pagination_readable_products
    if (url.pathname === '/api/viewer/pagination_readable_products') {
      const aggregateId = url.searchParams.get('aggregate_id') ?? '';
      const offset = Number(url.searchParams.get('offset') ?? '0') || 0;
      const limit = Number(url.searchParams.get('limit') ?? '50') || 50;
      return json(buildPaginationReadableProductsResponse(aggregateId, offset, limit));
    }

    // HTML: /episode/{id}
    const episodeMatch = url.pathname.match(/^\/episode\/(\d+)\/?$/);
    if (episodeMatch) {
      const episodeId = episodeMatch[1];
      if (episodeId === BASIC_SERIES.series.seriesId) return html(BASIC_EPISODE_PAGE_HTML);
      if (episodeId === MINIMAL_SERIES.series.seriesId) return html(MINIMAL_EPISODE_PAGE_HTML);
      // Synthesize a page for unknown episode ids so the content script
      // still resolves a series id; chapter-list fetches will return empty.
      const synthesizedAggregateId = SERIES_AGGREGATE_IDS[episodeId] ?? `agg-${episodeId}`;
      return html(buildShonenJumpPlusEpisodePageHtml({
        episodeId,
        seriesTitle: `Series ${episodeId}`,
        aggregateId: synthesizedAggregateId,
      }));
    }

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
