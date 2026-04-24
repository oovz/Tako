/**
 * @file local-server.ts
 * @description Local-mock-server handlers + DNR redirect rules for the
 * Shonen Jump+ integration.
 *
 * The download pipeline touches two hosts:
 *
 *   1. `shonenjumpplus.com/episode/{id}` — episode HTML. The background
 *      integration fetches this via `rateLimitedFetchByUrlScope(chapter.url)`
 *      in offscreen and reads `<script id="episode-json">` to discover
 *      image URLs. The content-script-level chapter-list API endpoints
 *      (`/api/viewer/...`) also live on this host and are served here.
 *   2. The image CDN (`cdn-ak-img.shonenjumpplus.com`) + the fallback
 *      host we use for mock images. Served as the shared 1x1 PNG.
 *
 * Main-frame navigations to `shonenjumpplus.com/episode/{id}` bypass DNR
 * (we exclude `main_frame`) and are still handled by the Playwright
 * route registrar in `./routes.ts`.
 */

import type { DnrRedirectRule } from '../../../dnr-test-redirects';
import type { LocalMockServerHandle, MockRouteHandler } from '../../../local-mock-server';
import { cloneSmallPngBytes, SMALL_PNG_MIME_TYPE } from '../../shared';
import {
  buildPaginationReadableProductsResponse,
  buildReadableProductPaginationInfoResponse,
} from './api-fixtures';
import { BASIC_CHAPTERS, SMALL_SERIES } from './chapter-data';
import { BASIC_SERIES, MINIMAL_SERIES, SERIES_AGGREGATE_IDS } from './series-data';

export const SHONENJUMPPLUS_LOCAL_SITE_PREFIX = '/__sjp/site';
export const SHONENJUMPPLUS_LOCAL_IMAGE_PREFIX = '/__sjp/img';

/** Assigned DNR rule ids within the reserved 9000–9999 test range. */
const SHONENJUMPPLUS_SITE_RULE_ID = 9400;
const SHONENJUMPPLUS_IMAGE_RULE_ID = 9401;

/**
 * Mock page image URL. Points at `cdn-ak-img.shonenjumpplus.com` so the
 * host-level DNR rule catches it. Using the production hostname in the
 * mock fixture also lets us exercise the
 * `isShonenJumpPlusPageImageUrl` branch of the descrambler even though
 * the 1x1 PNG path returns the buffer unchanged (tile width floors to
 * zero under `GIGAVIEWER_MULTIPLE`).
 */
function buildMockPageImageUrl(episodeId: string, pageIndex: number): string {
  return `https://cdn-ak-img.shonenjumpplus.com/public/page/${episodeId}/${pageIndex}.png`;
}

function encodeDataValueAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Build a Shonen Jump+ episode page HTML that embeds a non-empty
 * `pageStructure.pages` array so the background integration's
 * `extractImageUrlsFromEpisodeJsonScript` returns real mock URLs.
 *
 * No `contentStart` / `contentEnd` seed tokens are emitted — the
 * descrambler still runs because the image URL matches
 * `cdn-ak-img.shonenjumpplus.com/public/page/...`, but the 1x1 PNG
 * makes it a no-op in practice (see `GIGAVIEWER_MULTIPLE` branch).
 */
function buildEpisodeHtmlWithMockPages(options: {
  episodeId: string;
  seriesTitle: string;
  aggregateId: string;
  pageCount: number;
}): string {
  const pages = Array.from({ length: options.pageCount }, (_, index) => ({
    type: 'main',
    src: buildMockPageImageUrl(options.episodeId, index + 1),
  }));

  const episodeJson = JSON.stringify({
    readableProduct: {
      series: {
        id: options.aggregateId,
        title: options.seriesTitle,
        thumbnailUri: '',
      },
      pageStructure: { pages },
    },
  });

  const encoded = encodeDataValueAttribute(episodeJson);

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <title>${options.seriesTitle} | 少年ジャンプ+</title>
</head>
<body>
  <header class="series-header">
    <h1 class="series-header-title">${options.seriesTitle}</h1>
  </header>
  <div
    class="js-readable-products-pagination"
    data-aggregate-id="${options.aggregateId}"
  ></div>
  <script id="episode-json" type="application/json" data-value="${encoded}"></script>
</body>
</html>`;
}

/**
 * Resolve the series title + aggregate id for a given episode id.
 * Unknown episode ids fall back to a synthesized aggregate so the
 * download path still produces a consistent HTML shape.
 */
function resolveSeriesContextForEpisode(episodeId: string): {
  seriesTitle: string;
  aggregateId: string;
} {
  const basic = BASIC_CHAPTERS.chapters.find((chapter) => chapter.id === episodeId);
  if (basic) {
    return {
      seriesTitle: BASIC_SERIES.series.seriesTitle,
      aggregateId: SERIES_AGGREGATE_IDS[BASIC_SERIES.series.seriesId]!,
    };
  }
  const small = SMALL_SERIES.chapters.find((chapter) => chapter.id === episodeId);
  if (small) {
    return {
      seriesTitle: MINIMAL_SERIES.series.seriesTitle,
      aggregateId: SERIES_AGGREGATE_IDS[MINIMAL_SERIES.series.seriesId]!,
    };
  }
  // Mirror the existing `routes.ts` fallback so unknown ids still
  // produce a syntactically valid episode page.
  return {
    seriesTitle: `Series ${episodeId}`,
    aggregateId: `agg-${episodeId}`,
  };
}

/**
 * shonenjumpplus.com handler — dispatches subresource fetches the
 * extension performs into HTML and JSON responses. Main-frame
 * navigations to `/episode/{id}` are not redirected here.
 */
const shonenJumpPlusSiteHandler: MockRouteHandler = (req) => {
  const pathname = req.pathnameAfterPrefix;

  // `/api/viewer/readable_product_pagination_information`
  if (pathname === '/api/viewer/readable_product_pagination_information') {
    const aggregateId = req.url.searchParams.get('aggregate_id') ?? '';
    return {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: buildReadableProductPaginationInfoResponse(aggregateId),
    };
  }

  // `/api/viewer/pagination_readable_products`
  if (pathname === '/api/viewer/pagination_readable_products') {
    const aggregateId = req.url.searchParams.get('aggregate_id') ?? '';
    const offset = Number(req.url.searchParams.get('offset') ?? '0') || 0;
    const limit = Number(req.url.searchParams.get('limit') ?? '50') || 50;
    return {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: buildPaginationReadableProductsResponse(aggregateId, offset, limit),
    };
  }

  // `/episode/{id}` or `/episode/{id}/...` — return HTML with
  // embedded episode-json containing mock pages so
  // `resolveImageUrls` finds downloadable URLs.
  const episodeMatch = pathname.match(/^\/episode\/(\d+)\/?$/);
  if (episodeMatch) {
    const episodeId = episodeMatch[1];
    const { seriesTitle, aggregateId } = resolveSeriesContextForEpisode(episodeId);
    return {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: buildEpisodeHtmlWithMockPages({
        episodeId,
        seriesTitle,
        aggregateId,
        pageCount: 1,
      }),
    };
  }

  // Unknown `/api/*` → JSON 404 so the integration fails fast.
  if (pathname.startsWith('/api/')) {
    return {
      status: 404,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: { error: 'not_mocked', path: pathname },
    };
  }

  // Everything else: a minimal placeholder HTML.
  return {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Shonen Jump+</title></head><body></body></html>',
  };
};

/** cdn-ak-img.shonenjumpplus.com handler — returns the shared 1x1 PNG. */
const shonenJumpPlusImageHandler: MockRouteHandler = () => ({
  status: 200,
  headers: { 'content-type': SMALL_PNG_MIME_TYPE },
  body: cloneSmallPngBytes(),
});

/**
 * Register the Shonen Jump+ handlers on the given local mock server
 * and return the DNR redirect rules.
 */
export function registerShonenJumpPlusLocalServerHandlers(
  server: LocalMockServerHandle,
): DnrRedirectRule[] {
  server.addRoute(SHONENJUMPPLUS_LOCAL_SITE_PREFIX, shonenJumpPlusSiteHandler);
  server.addRoute(SHONENJUMPPLUS_LOCAL_IMAGE_PREFIX, shonenJumpPlusImageHandler);

  const base = server.url;
  return [
    {
      id: SHONENJUMPPLUS_SITE_RULE_ID,
      regexFilter: '^https?://(?:www\\.)?shonenjumpplus\\.com/(.*)$',
      regexSubstitution: `${base}${SHONENJUMPPLUS_LOCAL_SITE_PREFIX}/\\1`,
    },
    {
      id: SHONENJUMPPLUS_IMAGE_RULE_ID,
      // Match the production image hosts (cdn-ak-img and any similar
      // subdomain on shonenjumpplus.com).
      regexFilter: '^https?://[a-z0-9-]+\\.shonenjumpplus\\.com/(.*)$',
      regexSubstitution: `${base}${SHONENJUMPPLUS_LOCAL_IMAGE_PREFIX}/\\1`,
    },
  ];
}
