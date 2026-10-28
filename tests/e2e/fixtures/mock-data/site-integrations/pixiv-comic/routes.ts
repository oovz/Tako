/**
 * @file routes.ts
 * @description Playwright route registrar for the Pixiv Comic integration.
 *
 * Context-resolution coverage: the page host (`comic.pixiv.net`) serves HTML, work
 * metadata, and episode lists. Extension fetches use the local-server DNR routes.
 */

import type { Route } from "@playwright/test"
import type { RouteRegistrar } from "../../types"
import { PIXIV_COMIC_TEST_DOMAIN } from "../../../test-domains-constants"
import {
  BASIC_WORK_PAGE_HTML,
  HOME_PAGE_HTML,
  MINIMAL_WORK_PAGE_HTML,
  VIEWER_PAGE_HTML,
  buildPixivComicWorkPageHtml,
} from "./html-fixtures"
import {
  buildPixivEpisodesV2Response,
  buildPixivReadV4Response,
  buildPixivStoryPageResponse,
  buildPixivWorkV5Response,
} from "./api-fixtures"
import { BASIC_SERIES, MINIMAL_SERIES } from "./series-data"
import { cloneSmallPngBytes, SMALL_PNG_MIME_TYPE } from "../../shared"
import { clonePixivPagePngBytes } from "./image-fixture"

export const registerPixivComicRoutes: RouteRegistrar = async (
  context,
  options
) => {
  if (!options.useMocks) {
    return
  }

  await context.route(
    `https://${PIXIV_COMIC_TEST_DOMAIN}/**`,
    async (route: Route) => {
      const url = new URL(route.request().url())

      const json = (body: unknown) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(body),
        })

      const html = (body: string) =>
        route.fulfill({
          status: 200,
          contentType: "text/html; charset=utf-8",
          body,
        })

      // API: /api/app/works/v5/{workId}
      const workV5Match = url.pathname.match(/^\/api\/app\/works\/v5\/(\d+)$/)
      if (workV5Match) {
        return json(buildPixivWorkV5Response(workV5Match[1]))
      }

      // API: /api/app/works/{workId}/episodes/v2
      const episodesV2Match = url.pathname.match(
        /^\/api\/app\/works\/(\d+)\/episodes\/v2$/
      )
      if (episodesV2Match) {
        return json(buildPixivEpisodesV2Response(episodesV2Match[1]))
      }

      // HTML: /works/{workId}
      const worksMatch = url.pathname.match(/^\/works\/(\d+)\/?$/)
      if (worksMatch) {
        const workId = worksMatch[1]
        if (workId === BASIC_SERIES.series.seriesId)
          return html(BASIC_WORK_PAGE_HTML)
        if (workId === MINIMAL_SERIES.series.seriesId)
          return html(MINIMAL_WORK_PAGE_HTML)
        return html(buildPixivComicWorkPageHtml(workId, `Work ${workId}`))
      }

      const storyPageMatch = url.pathname.match(
        /^\/_next\/data\/[^/]+\/viewer\/stories\/(\d+)\.json$/
      )
      if (storyPageMatch)
        return json(buildPixivStoryPageResponse(storyPageMatch[1]))

      const readV4Match = url.pathname.match(
        /^\/api\/app\/episodes\/(\d+)\/read_v4$/
      )
      if (readV4Match) return json(buildPixivReadV4Response(readV4Match[1]))

      // HTML: /viewer/stories/{id}
      if (url.pathname.startsWith("/viewer/stories/")) {
        return html(VIEWER_PAGE_HTML)
      }

      // Unmatched API paths return a structured error so the background
      // integration fails fast instead of hanging on unmocked requests.
      if (url.pathname.startsWith("/api/")) {
        return route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ error: "not_mocked", path: url.pathname }),
        })
      }

      return html(HOME_PAGE_HTML)
    }
  )

  // Keep fixture cover URLs on Pixiv's real allowed asset hostname. The
  // deterministic byte response prevents the generic external-request guard
  // from turning the Side Panel's cover request into a network dependency.
  await context.route("https://img-comic.pximg.net/**", async (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: SMALL_PNG_MIME_TYPE,
      body: clonePixivPagePngBytes(),
    })
  )
  await context.route(
    "https://public-img-comic.pximg.net/**",
    async (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: SMALL_PNG_MIME_TYPE,
        body: cloneSmallPngBytes(),
      })
  )
}
