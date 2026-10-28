import type { Route } from "@playwright/test"
import type { RouteRegistrar } from "../../types"
import { SHONENJUMPPLUS_TEST_DOMAIN } from "../../../test-domains-constants"
import {
  BASIC_EPISODE_PAGE_HTML,
  HOME_PAGE_HTML,
  MINIMAL_EPISODE_PAGE_HTML,
} from "./html-fixtures"
import {
  buildPaginationReadableProductsResponse,
  buildReadableProductPaginationInfoResponse,
} from "./api-fixtures"
import { BASIC_SERIES, MINIMAL_SERIES } from "./series-data"
import { cloneSmallPngBytes, SMALL_PNG_MIME_TYPE } from "../../shared"

export const registerShonenJumpPlusRoutes: RouteRegistrar = async (
  context,
  options
) => {
  if (!options.useMocks) return

  await context.route(
    `https://${SHONENJUMPPLUS_TEST_DOMAIN}/**`,
    async (route: Route) => {
      const url = new URL(route.request().url())
      const aggregateId = url.searchParams.get("aggregate_id") ?? ""
      if (
        url.pathname === "/api/viewer/readable_product_pagination_information"
      ) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(
            buildReadableProductPaginationInfoResponse(aggregateId)
          ),
        })
      }
      if (url.pathname === "/api/viewer/pagination_readable_products") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(
            buildPaginationReadableProductsResponse(
              aggregateId,
              Number(url.searchParams.get("offset") ?? 0),
              Number(url.searchParams.get("limit") ?? 50)
            )
          ),
        })
      }
      const episodeId = url.pathname.match(/^\/episode\/(\d+)\/?$/)?.[1]
      const body =
        episodeId === BASIC_SERIES.series.seriesId
          ? BASIC_EPISODE_PAGE_HTML
          : episodeId === MINIMAL_SERIES.series.seriesId
            ? MINIMAL_EPISODE_PAGE_HTML
            : HOME_PAGE_HTML
      return route.fulfill({
        status: episodeId && body === HOME_PAGE_HTML ? 404 : 200,
        contentType: "text/html; charset=utf-8",
        body,
      })
    }
  )

  for (const host of [
    "cdn-ak-img.shonenjumpplus.com",
    "cdn-scissors.gigaviewer.com",
  ]) {
    await context.route(`https://${host}/**`, async (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: SMALL_PNG_MIME_TYPE,
        body: cloneSmallPngBytes(),
      })
    )
  }
}
