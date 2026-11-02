import type { DnrRedirectRule } from "../../../dnr-test-redirects"
import type {
  LocalMockServerHandle,
  MockRouteHandler,
  MockRouteResponse,
} from "../../../local-mock-server"
import { SMALL_PNG_MIME_TYPE } from "../../shared"
import {
  buildPixivEpisodesV2Response,
  buildPixivReadV4Response,
  buildPixivStoryPageResponse,
  buildPixivWorkV5Response,
} from "./api-fixtures"
import { BASIC_WORK_PAGE_HTML } from "./html-fixtures"
import { clonePixivPagePngBytes } from "./image-fixture"

export const PIXIV_COMIC_LOCAL_SITE_PREFIX = "/__pc/site"
export const PIXIV_COMIC_LOCAL_IMAGE_PREFIX = "/__pc/img"

function jsonResponse(body: object): MockRouteResponse {
  return {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
    body,
  }
}

const pixivComicSiteHandler: MockRouteHandler = (req) => {
  const pathname = req.pathnameAfterPrefix
  // Build discovery uses the captured work shell's real Next.js manifest marker.
  if (pathname === "/" || pathname === "" || pathname === "/works/9830") {
    return {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
      body: BASIC_WORK_PAGE_HTML,
    }
  }

  const saltMatch = pathname.match(
    /^\/_next\/data\/([^/]+)\/viewer\/stories\/(\d+)\.json$/
  )
  if (saltMatch) return jsonResponse(buildPixivStoryPageResponse(saltMatch[2]))

  const readV4Match = pathname.match(/^\/api\/app\/episodes\/(\d+)\/read_v4$/)
  if (readV4Match) return jsonResponse(buildPixivReadV4Response(readV4Match[1]))

  const workV5Match = pathname.match(/^\/api\/app\/works\/v5\/(\d+)$/)
  if (workV5Match) return jsonResponse(buildPixivWorkV5Response(workV5Match[1]))

  const episodesV2Match = pathname.match(
    /^\/api\/app\/works\/(\d+)\/episodes\/v2$/
  )
  if (episodesV2Match)
    return jsonResponse(buildPixivEpisodesV2Response(episodesV2Match[1]))

  return {
    status: 404,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: { error: "not_mocked", path: pathname },
  }
}

const pixivComicImageHandler: MockRouteHandler = () => ({
  status: 200,
  headers: { "content-type": SMALL_PNG_MIME_TYPE },
  body: clonePixivPagePngBytes(),
})

export function registerPixivComicLocalServerHandlers(
  server: LocalMockServerHandle
): DnrRedirectRule[] {
  server.addRoute(PIXIV_COMIC_LOCAL_SITE_PREFIX, pixivComicSiteHandler)
  server.addRoute(PIXIV_COMIC_LOCAL_IMAGE_PREFIX, pixivComicImageHandler)

  return [
    {
      id: 9300,
      regexFilter: "^https?://comic\\.pixiv\\.net/(.*)$",
      regexSubstitution: `${server.url}${PIXIV_COMIC_LOCAL_SITE_PREFIX}/\\1`,
    },
    {
      id: 9301,
      regexFilter: "^https?://(?:public-)?img-comic\\.pximg\\.net/(.*)$",
      regexSubstitution: `${server.url}${PIXIV_COMIC_LOCAL_IMAGE_PREFIX}/\\1`,
    },
  ]
}
