import type { DnrRedirectRule } from "../../../dnr-test-redirects"
import type {
  LocalMockServerHandle,
  MockRouteHandler,
  MockRouteResponse,
} from "../../../local-mock-server"
import {
  buildMangaMillionChapterListResponse,
  buildMangaMillionRegisterResponse,
  buildMangaMillionTitleDetailResponse,
  buildMangaMillionViewerResponse,
} from "./api-fixtures"
import { BASIC_SERIES_PAGE_HTML, HOME_PAGE_HTML } from "./html-fixtures"
import {
  MOCK_COVER_IMAGE_BUFFER,
  MOCK_ENCRYPTED_PAGE_BUFFER,
} from "./image-fixtures"

export const MANGAMILLION_LOCAL_SITE_PREFIX = "/__mangamillion/site"
export const MANGAMILLION_LOCAL_API_PREFIX = "/__mangamillion/api"
export const MANGAMILLION_LOCAL_CDN_PREFIX = "/__mangamillion/cdn"

export const MANGAMILLION_SITE_RULE_ID = 9700
export const MANGAMILLION_API_RULE_ID = 9701
export const MANGAMILLION_CDN_RULE_ID = 9702

function protoResponse(buffer: Buffer): MockRouteResponse {
  return {
    status: 200,
    headers: {
      "content-type": "application/octet-stream",
    },
    body: buffer,
  }
}

const mangaMillionSiteHandler: MockRouteHandler = (req) => {
  const pathname = req.pathnameAfterPrefix

  if (
    pathname === "/title/1" ||
    pathname === "/title/1/" ||
    pathname === "/en/title/1" ||
    pathname === "/en/title/1/" ||
    pathname.startsWith("/en/title/1/chapter/") ||
    pathname.startsWith("/title/1/chapter/")
  ) {
    return {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
      body: BASIC_SERIES_PAGE_HTML,
    }
  }

  if (pathname === "/" || pathname === "/en" || pathname === "/en/") {
    return {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
      body: HOME_PAGE_HTML,
    }
  }

  return {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
    body: BASIC_SERIES_PAGE_HTML,
  }
}

const mangaMillionApiHandler: MockRouteHandler = (req) => {
  const pathname = req.pathnameAfterPrefix

  if (pathname.startsWith("/api/register")) {
    return protoResponse(buildMangaMillionRegisterResponse())
  }

  if (pathname.startsWith("/api/title_detail")) {
    return protoResponse(buildMangaMillionTitleDetailResponse())
  }

  if (pathname.startsWith("/api/chapter_list")) {
    return protoResponse(buildMangaMillionChapterListResponse())
  }

  if (pathname.startsWith("/api/viewer")) {
    return protoResponse(buildMangaMillionViewerResponse())
  }

  return null
}

const mangaMillionCdnHandler: MockRouteHandler = (req) => {
  const pathname = req.pathnameAfterPrefix

  if (pathname.includes(".enc")) {
    return {
      status: 200,
      headers: {
        "content-type": "application/octet-stream",
      },
      body: MOCK_ENCRYPTED_PAGE_BUFFER,
    }
  }

  return {
    status: 200,
    headers: {
      "content-type": "image/webp",
    },
    body: MOCK_COVER_IMAGE_BUFFER,
  }
}

export function registerMangaMillionLocalServerHandlers(
  server: LocalMockServerHandle
): DnrRedirectRule[] {
  server.addRoute(MANGAMILLION_LOCAL_SITE_PREFIX, mangaMillionSiteHandler)
  server.addRoute(MANGAMILLION_LOCAL_API_PREFIX, mangaMillionApiHandler)
  server.addRoute(MANGAMILLION_LOCAL_CDN_PREFIX, mangaMillionCdnHandler)

  const base = server.url
  return [
    {
      id: MANGAMILLION_SITE_RULE_ID,
      regexFilter: "^https?://mangamillion\\.shueisha\\.co\\.jp/(.*)$",
      regexSubstitution: `${base}${MANGAMILLION_LOCAL_SITE_PREFIX}/\\1`,
    },
    {
      id: MANGAMILLION_API_RULE_ID,
      regexFilter: "^https?://api\\.mangamillion\\.shueisha\\.co\\.jp/(.*)$",
      regexSubstitution: `${base}${MANGAMILLION_LOCAL_API_PREFIX}/\\1`,
    },
    {
      id: MANGAMILLION_CDN_RULE_ID,
      regexFilter: "^https?://img\\.mangamillion\\.shueisha\\.co\\.jp/(.*)$",
      regexSubstitution: `${base}${MANGAMILLION_LOCAL_CDN_PREFIX}/\\1`,
    },
  ]
}
