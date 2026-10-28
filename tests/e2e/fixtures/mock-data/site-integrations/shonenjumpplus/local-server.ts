import type { DnrRedirectRule } from "../../../dnr-test-redirects"
import type {
  LocalMockServerHandle,
  MockRouteHandler,
} from "../../../local-mock-server"
import { cloneSmallPngBytes, SMALL_PNG_MIME_TYPE } from "../../shared"
import {
  buildPaginationReadableProductsResponse,
  buildReadableProductPaginationInfoResponse,
} from "./api-fixtures"
import {
  BASIC_EPISODE_PAGE_HTML,
  MINIMAL_EPISODE_PAGE_HTML,
  HOME_PAGE_HTML,
} from "./html-fixtures"
import { BASIC_SERIES, MINIMAL_SERIES } from "./series-data"
import {
  cloneShonenJumpPlusScrambledPng,
  SHONEN_JUMP_PLUS_SCRAMBLED_PNG_MIME_TYPE,
} from "./scrambled-image-fixture"

export const SHONENJUMPPLUS_LOCAL_SITE_PREFIX = "/__sjp/site"
export const SHONENJUMPPLUS_LOCAL_IMAGE_PREFIX = "/__sjp/img"
const SHONENJUMPPLUS_LOCAL_COVER_PREFIX = "/__sjp/cover"

const shonenJumpPlusSiteHandler: MockRouteHandler = (req) => {
  const pathname = req.pathnameAfterPrefix
  const aggregateId = req.url.searchParams.get("aggregate_id") ?? ""
  if (pathname === "/api/viewer/readable_product_pagination_information") {
    return {
      status: 200,
      headers: { "content-type": "application/json" },
      body: buildReadableProductPaginationInfoResponse(aggregateId),
    }
  }
  if (pathname === "/api/viewer/pagination_readable_products") {
    return {
      status: 200,
      headers: { "content-type": "application/json" },
      body: buildPaginationReadableProductsResponse(
        aggregateId,
        Number(req.url.searchParams.get("offset") ?? 0),
        Number(req.url.searchParams.get("limit") ?? 50)
      ),
    }
  }
  const episodeId = pathname.match(/^\/episode\/(\d+)\/?$/)?.[1]
  const body =
    episodeId === BASIC_SERIES.series.seriesId
      ? BASIC_EPISODE_PAGE_HTML
      : episodeId === MINIMAL_SERIES.series.seriesId
        ? MINIMAL_EPISODE_PAGE_HTML
        : HOME_PAGE_HTML
  return {
    status: episodeId && body === HOME_PAGE_HTML ? 404 : 200,
    headers: { "content-type": "text/html; charset=utf-8" },
    body,
  }
}

const shonenJumpPlusImageHandler: MockRouteHandler = () => ({
  status: 200,
  headers: { "content-type": SHONEN_JUMP_PLUS_SCRAMBLED_PNG_MIME_TYPE },
  body: cloneShonenJumpPlusScrambledPng(),
})

export function registerShonenJumpPlusLocalServerHandlers(
  server: LocalMockServerHandle
): DnrRedirectRule[] {
  server.addRoute(SHONENJUMPPLUS_LOCAL_SITE_PREFIX, shonenJumpPlusSiteHandler)
  server.addRoute(SHONENJUMPPLUS_LOCAL_IMAGE_PREFIX, shonenJumpPlusImageHandler)
  server.addRoute(SHONENJUMPPLUS_LOCAL_COVER_PREFIX, () => ({
    status: 200,
    headers: { "content-type": SMALL_PNG_MIME_TYPE },
    body: cloneSmallPngBytes(),
  }))
  const base = server.url
  return [
    {
      id: 9400,
      regexFilter: "^https?://shonenjumpplus\\.com/(.*)$",
      regexSubstitution: `${base}${SHONENJUMPPLUS_LOCAL_SITE_PREFIX}/\\1`,
    },
    {
      id: 9401,
      regexFilter: "^https?://cdn-ak-img\\.shonenjumpplus\\.com/(.*)$",
      regexSubstitution: `${base}${SHONENJUMPPLUS_LOCAL_IMAGE_PREFIX}/\\1`,
    },
    {
      id: 9402,
      regexFilter: "^https?://cdn-scissors\\.gigaviewer\\.com/(.*)$",
      regexSubstitution: `${base}${SHONENJUMPPLUS_LOCAL_COVER_PREFIX}/\\1`,
    },
  ]
}
