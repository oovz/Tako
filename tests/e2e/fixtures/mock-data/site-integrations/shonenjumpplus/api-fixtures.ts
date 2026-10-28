import products from "@/tests/fixtures/site-integrations/shonenjumpplus/captured-products.json" with { type: "json" }
import pagination from "@/tests/fixtures/site-integrations/shonenjumpplus/captured-pagination.json" with { type: "json" }
import { SMALL_SERIES } from "./chapter-data"
import {
  BASIC_SERIES,
  MINIMAL_SERIES,
  SERIES_AGGREGATE_IDS,
} from "./series-data"

export function buildReadableProductPaginationInfoResponse(
  aggregateId: string
): Record<string, unknown> {
  if (aggregateId === SERIES_AGGREGATE_IDS[BASIC_SERIES.series.seriesId]) {
    return structuredClone(pagination)
  }
  return {
    per_page: 50,
    readable_products_count:
      aggregateId === SERIES_AGGREGATE_IDS[MINIMAL_SERIES.series.seriesId]
        ? 1
        : 0,
  }
}

export function buildPaginationReadableProductsResponse(
  aggregateId: string,
  offset: number,
  limit: number
): Array<Record<string, unknown>> {
  if (aggregateId === SERIES_AGGREGATE_IDS[BASIC_SERIES.series.seriesId]) {
    return structuredClone(products.slice(offset, offset + limit))
  }
  if (aggregateId === SERIES_AGGREGATE_IDS[MINIMAL_SERIES.series.seriesId]) {
    return SMALL_SERIES.chapters
      .slice(offset, offset + limit)
      .map((chapter) => ({
        readable_product_id: chapter.id,
        viewer_uri: chapter.url,
        title: chapter.title,
        status: { label: "is_free" },
      }))
  }
  return []
}
