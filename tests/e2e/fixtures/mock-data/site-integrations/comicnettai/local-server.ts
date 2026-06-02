import type { DnrRedirectRule } from '../../../dnr-test-redirects'
import type { LocalMockServerHandle, MockRouteHandler } from '../../../local-mock-server'
import { cloneSmallPngBytes, SMALL_PNG_MIME_TYPE } from '../../shared'
import { MOCK_PUBLUS_CONFIG, MOCK_PUBLUS_IMAGE_PATHS } from './config-fixtures'

export const COMICNETTAI_LOCAL_SITE_PREFIX = '/__comicnettai/site'
export const COMICNETTAI_LOCAL_CDN_PREFIX = '/__comicnettai/cdn'

const COMICNETTAI_SITE_RULE_ID = 9600
const COMICNETTAI_CDN_RULE_ID = 9601

const cidToContentId: Record<string, string> = {
  'mock-cid-958': '958',
  'mock-cid-938': '938',
  'mock-cid-925': '925',
}

const comicNettaiSiteHandler: MockRouteHandler = (req) => {
  const pathname = req.pathnameAfterPrefix
  if (pathname === '/api/viewer/c') {
    const cid = req.url.searchParams.get('cid') ?? ''
    const contentId = cidToContentId[cid]
    if (!contentId) {
      return {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: { status: '404' },
      }
    }

    return {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: {
        status: '200',
        url: `https://cdn.comicnettai.com/9_hash/epub/book_contents/c${contentId}/`,
        cti: `Mock ${contentId}`,
        cty: 1,
      },
    }
  }

  return {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>',
  }
}

const comicNettaiCdnHandler: MockRouteHandler = (req) => {
  const pathname = req.pathnameAfterPrefix
  if (pathname.endsWith('/configuration_pack.json')) {
    return {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: MOCK_PUBLUS_CONFIG,
    }
  }

  if (MOCK_PUBLUS_IMAGE_PATHS.some((path) => pathname.endsWith(path.replace('/9_hash', '')) || pathname === path)) {
    return {
      status: 200,
      headers: { 'content-type': SMALL_PNG_MIME_TYPE },
      body: cloneSmallPngBytes(),
    }
  }

  if (pathname.includes('/book_contents/') || pathname.includes('/books/')) {
    return {
      status: 200,
      headers: { 'content-type': SMALL_PNG_MIME_TYPE },
      body: cloneSmallPngBytes(),
    }
  }

  return null
}

export function registerComicNettaiLocalServerHandlers(server: LocalMockServerHandle): DnrRedirectRule[] {
  server.addRoute(COMICNETTAI_LOCAL_SITE_PREFIX, comicNettaiSiteHandler)
  server.addRoute(COMICNETTAI_LOCAL_CDN_PREFIX, comicNettaiCdnHandler)

  const base = server.url
  return [
    {
      id: COMICNETTAI_SITE_RULE_ID,
      regexFilter: '^https?://www\\.comicnettai\\.com/(.*)$',
      regexSubstitution: `${base}${COMICNETTAI_LOCAL_SITE_PREFIX}/\\1`,
    },
    {
      id: COMICNETTAI_CDN_RULE_ID,
      regexFilter: '^https?://cdn\\.comicnettai\\.com/(.*)$',
      regexSubstitution: `${base}${COMICNETTAI_LOCAL_CDN_PREFIX}/\\1`,
    },
  ]
}
