/**
 * Redirect MangaDex API, telemetry, and image requests from extension contexts
 * to the local server. Page navigations keep their original host and use
 * Playwright routes.
 */

import type { DnrRedirectRule } from "../../../dnr-test-redirects"
import type {
  LocalMockServerHandle,
  MockRouteHandler,
  MockRouteResponse,
} from "../../../local-mock-server"
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

/**
 * Pathname prefixes the local server mounts MangaDex handlers under.
 * DNR redirect rules place the original path after these prefixes so
 * handlers can reuse the production-style path parsers.
 */
export const MANGADEX_LOCAL_API_PREFIX = "/__md/api"
export const MANGADEX_LOCAL_NETWORK_PREFIX = "/__md/network"
export const MANGADEX_LOCAL_UPLOADS_PREFIX = "/__md/uploads"

/**
 * Assigned DNR rule ids. Must remain in the 9000–9999 test range
 * (validated by `dnr-test-redirects.ts`).
 */
const MANGADEX_API_RULE_ID = 9200
const MANGADEX_NETWORK_RULE_ID = 9201
const MANGADEX_UPLOADS_RULE_ID = 9202
const MANGADEX_CAPTURED_NODE_RULE_ID = 9203

function json(body: object): MockRouteResponse {
  return {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
    body,
  }
}

/** Serve fixture API responses and provider-shaped errors for unmocked paths. */
const mangadexApiHandler: MockRouteHandler = (req) => {
  const pathname = req.pathnameAfterPrefix
  const parts = pathname.split("/").filter(Boolean)

  if (
    parts[0] === "at-home" &&
    parts[1] === "server" &&
    typeof parts[2] === "string"
  ) {
    return json(buildAtHomeServerResponse(parts[2]))
  }

  if (
    parts[0] === "statistics" &&
    parts[1] === "manga" &&
    typeof parts[2] === "string"
  ) {
    return json(buildMangadexStatisticsResponse(parts[2]))
  }

  if (parts[0] === "manga" && typeof parts[1] === "string") {
    const mangaId = parts[1]
    const isFeed = parts.length >= 3 && parts[2] === "feed"
    if (isFeed) {
      return json(buildMangadexSeriesFeedResponse(mangaId))
    }
    return json(buildMangadexSeriesResponse(mangaId))
  }

  return json({ result: "error", message: "not mocked" })
}

/**
 * api.mangadex.network handler — returns 204 for `/report` and any other
 * path. Production uses this endpoint best-effort; responding 204 keeps
 * the `reportToMangadexNetwork` fire-and-forget call short.
 */
const mangadexNetworkHandler: MockRouteHandler = () => ({
  status: 204,
  body: "",
})

/**
 * uploads.mangadex.org handler — returns the shared 1x1 PNG for every
 * request. Production paths look like `/data/{hash}/{file}`,
 * `/data-saver/{hash}/{file}`, and `/covers/{mangaId}/{file}`. The mock
 * ignores the path shape entirely.
 */
const mangadexUploadsHandler: MockRouteHandler = () => ({
  status: 200,
  headers: { "content-type": SMALL_PNG_MIME_TYPE },
  body: cloneSmallPngBytes(),
})

/**
 * Register the MangaDex handlers on the given local mock server and
 * return the DNR redirect rules that steer external URLs at them.
 */
export function registerMangadexLocalServerHandlers(
  server: LocalMockServerHandle
): DnrRedirectRule[] {
  server.addRoute(MANGADEX_LOCAL_API_PREFIX, mangadexApiHandler)
  server.addRoute(MANGADEX_LOCAL_NETWORK_PREFIX, mangadexNetworkHandler)
  server.addRoute(MANGADEX_LOCAL_UPLOADS_PREFIX, mangadexUploadsHandler)

  const base = server.url
  return [
    {
      id: MANGADEX_CAPTURED_NODE_RULE_ID,
      regexFilter: `^https://${MANGADEX_CAPTURED_IMAGE_DOMAIN.replaceAll(".", "\\.")}/(.*)$`,
      regexSubstitution: `${base}${MANGADEX_LOCAL_UPLOADS_PREFIX}/\\1`,
    },
    {
      id: MANGADEX_API_RULE_ID,
      regexFilter: "^https?://api\\.mangadex\\.org/(.*)$",
      regexSubstitution: `${base}${MANGADEX_LOCAL_API_PREFIX}/\\1`,
    },
    {
      id: MANGADEX_NETWORK_RULE_ID,
      regexFilter: "^https?://api\\.mangadex\\.network/(.*)$",
      regexSubstitution: `${base}${MANGADEX_LOCAL_NETWORK_PREFIX}/\\1`,
    },
    {
      id: MANGADEX_UPLOADS_RULE_ID,
      regexFilter: "^https?://uploads\\.mangadex\\.org/(.*)$",
      regexSubstitution: `${base}${MANGADEX_LOCAL_UPLOADS_PREFIX}/\\1`,
    },
  ]
}
