export const COMICNETTAI_ORIGIN = 'https://www.comicnettai.com'
export const COMICNETTAI_CDN_HOST = 'cdn.comicnettai.com'

export function parseComicNettaiSeriesIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/book\/(\d+)\/?$/)
  return match?.[1] ?? null
}

export function parseComicNettaiViewerCid(chapterUrl: string): string | null {
  try {
    const url = new URL(chapterUrl, COMICNETTAI_ORIGIN)
    if (url.hostname !== 'www.comicnettai.com' || url.pathname !== '/publus/viewer.html') {
      return null
    }

    const cid = url.searchParams.get('cid')
    return cid && cid.length > 0 ? cid : null
  } catch {
    return null
  }
}

export function buildComicNettaiViewerApiUrl(chapterUrl: string): string {
  const cid = parseComicNettaiViewerCid(chapterUrl)
  if (!cid) {
    throw new Error(`Invalid Comic Nettai viewer URL: ${chapterUrl}`)
  }

  const endpoint = new URL('/api/viewer/c', COMICNETTAI_ORIGIN)
  endpoint.searchParams.set('cid', cid)
  return endpoint.toString()
}

export function extractComicNettaiBookContentId(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl, COMICNETTAI_ORIGIN)
    const match = url.pathname.match(/\/book_contents\/(\d+)\//)
    return match?.[1] ?? null
  } catch {
    return null
  }
}

export function normalizeComicNettaiChapterUrl(rawUrl: string): string | null {
  try {
    return new URL(rawUrl, COMICNETTAI_ORIGIN).toString()
  } catch {
    return null
  }
}
