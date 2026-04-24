/**
 * @file api-fixtures.ts
 * @description Shonen Jump+ pagination API response builders.
 *
 * The content script calls two endpoints to resolve the chapter list:
 *   - `/api/viewer/readable_product_pagination_information` → counts
 *   - `/api/viewer/pagination_readable_products` → paginated products
 *
 * These builders produce responses consistent with the types declared in
 * `@/src/site-integrations/shonenjumpplus/index.ts`.
 */

import { BASIC_CHAPTERS, SMALL_SERIES } from './chapter-data';
import { BASIC_SERIES, MINIMAL_SERIES, SERIES_AGGREGATE_IDS } from './series-data';

function resolveChaptersByAggregateId(aggregateId: string) {
  if (aggregateId === SERIES_AGGREGATE_IDS[BASIC_SERIES.series.seriesId]) {
    return BASIC_CHAPTERS.chapters;
  }
  if (aggregateId === SERIES_AGGREGATE_IDS[MINIMAL_SERIES.series.seriesId]) {
    return SMALL_SERIES.chapters;
  }
  return [];
}

/**
 * `/api/viewer/readable_product_pagination_information` response.
 */
export function buildReadableProductPaginationInfoResponse(
  aggregateId: string,
): Record<string, unknown> {
  const chapters = resolveChaptersByAggregateId(aggregateId);
  const perPage = 50;
  return {
    per_page: perPage,
    readable_products_count: chapters.length,
  };
}

/**
 * `/api/viewer/pagination_readable_products` response.
 * The real endpoint returns descending order; honor that so the content
 * script's de-dup logic is exercised identically.
 */
export function buildPaginationReadableProductsResponse(
  aggregateId: string,
  offset: number,
  limit: number,
): Array<Record<string, unknown>> {
  const chapters = resolveChaptersByAggregateId(aggregateId);
  const reversed = [...chapters].reverse();
  const slice = reversed.slice(offset, offset + limit);

  return slice.map((chapter) => ({
    readable_product_id: chapter.id,
    viewer_uri: `/episode/${chapter.id}`,
    title: chapter.title,
    status: { label: 'Free', rental_price: null, buy_price: null },
  }));
}
