/**
 * Mock MangaDex page navigations and page-origin requests. Extension-origin
 * requests use DNR redirects to the local server with the same response builders.
 */

import type { Route } from "@playwright/test"
import type { RouteRegistrar } from "../../types"
import { MANGADEX_TEST_DOMAIN } from "../../../test-domains-constants"
import { cloneSmallPngBytes, SMALL_PNG_MIME_TYPE } from "../../shared"
import {
  buildMangadexSeriesFeedResponse,
  buildMangadexStatisticsResponse,
  buildMangadexSeriesResponse,
} from "./api-fixtures"
import {
  buildAtHomeServerResponse,
  MANGADEX_CAPTURED_IMAGE_DOMAIN,
} from "./image-fixtures"
import { CHAPTER_PAGE_HTML, SERIES_PAGE_HTML } from "./html-fixtures"

const MANGADEX_API_DOMAIN = "api.mangadex.org"
const MANGADEX_NETWORK_DOMAIN = "api.mangadex.network"
const MANGADEX_UPLOADS_DOMAIN = "uploads.mangadex.org"
const MANGADEX_HOME_HTML =
  '<!doctype html><html><head><meta charset="utf-8"><title>MangaDex</title></head><body>MangaDex Home</body></html>'

async function fulfillJson(route: Route, body: object): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: "application/json; charset=utf-8",
    body: JSON.stringify(body),
  })
}

async function handleMangadexApiFetch(route: Route): Promise<void> {
  const url = new URL(route.request().url())
  const parts = url.pathname.split("/").filter(Boolean)

  if (
    parts[0] === "at-home" &&
    parts[1] === "server" &&
    typeof parts[2] === "string"
  ) {
    await fulfillJson(route, buildAtHomeServerResponse(parts[2]))
    return
  }

  if (
    parts[0] === "statistics" &&
    parts[1] === "manga" &&
    typeof parts[2] === "string"
  ) {
    await fulfillJson(route, buildMangadexStatisticsResponse(parts[2]))
    return
  }

  if (parts[0] === "manga" && typeof parts[1] === "string") {
    const mangaId = parts[1]
    const isFeed = parts.length >= 3 && parts[2] === "feed"
    if (isFeed) {
      await fulfillJson(route, buildMangadexSeriesFeedResponse(mangaId))
      return
    }
    await fulfillJson(route, buildMangadexSeriesResponse(mangaId))
    return
  }

  await fulfillJson(route, { result: "error", message: "not mocked" })
}

export const registerMangadexRoutes: RouteRegistrar = async (
  context,
  options
) => {
  if (!options.useMocks) {
    return
  }

  await context.route(
    `https://${MANGADEX_TEST_DOMAIN}/**`,
    async (route: Route) => {
      const url = new URL(route.request().url())

      if (url.pathname.startsWith("/title/")) {
        await route.fulfill({
          status: 200,
          contentType: "text/html",
          body: SERIES_PAGE_HTML,
        })
        return
      }

      if (url.pathname.startsWith("/chapter/")) {
        await route.fulfill({
          status: 200,
          contentType: "text/html",
          body: CHAPTER_PAGE_HTML,
        })
        return
      }

      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: MANGADEX_HOME_HTML,
      })
    }
  )

  // DNR redirects cover extension-origin requests; page requests are mocked here.
  await context.route(
    `https://${MANGADEX_API_DOMAIN}/**`,
    handleMangadexApiFetch
  )

  await context.route(
    `https://${MANGADEX_NETWORK_DOMAIN}/**`,
    async (route: Route) => {
      await route.fulfill({ status: 204, body: "" })
    }
  )

  for (const imageDomain of [
    MANGADEX_UPLOADS_DOMAIN,
    MANGADEX_CAPTURED_IMAGE_DOMAIN,
  ]) {
    await context.route(`https://${imageDomain}/**`, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: SMALL_PNG_MIME_TYPE,
        body: Buffer.from(cloneSmallPngBytes()),
      })
    })
  }
}
