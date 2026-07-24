export const COMICNETTAI_ORIGIN = "https://www.comicnettai.com"
export const COMICNETTAI_CDN_HOST = "cdn.comicnettai.com"

function isTrustedComicNettaiCdnUrl(url: URL): boolean {
  return (
    url.protocol === "https:" &&
    url.hostname === COMICNETTAI_CDN_HOST &&
    url.username.length === 0 &&
    url.password.length === 0
  )
}

export function parseTrustedComicNettaiCdnUrl(
  rawUrl: string,
  purpose: string
): URL {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error(`${purpose} is not a valid URL`)
  }

  if (!isTrustedComicNettaiCdnUrl(url)) {
    throw new Error(
      `${purpose} must use the trusted Comic Nettai CDN (${COMICNETTAI_CDN_HOST})`
    )
  }

  return url
}

export function parseComicNettaiSeriesIdFromPath(
  pathname: string
): string | null {
  const match = pathname.match(/^\/book\/(\d+)\/?$/)
  return match?.[1] ?? null
}

export function parseComicNettaiViewerCid(chapterUrl: string): string | null {
  try {
    const url = new URL(chapterUrl, COMICNETTAI_ORIGIN)
    if (
      url.origin !== COMICNETTAI_ORIGIN ||
      url.pathname !== "/publus/viewer.html"
    ) {
      return null
    }

    const cid = url.searchParams.get("cid")
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

  const endpoint = new URL("/api/viewer/c", COMICNETTAI_ORIGIN)
  endpoint.searchParams.set("cid", cid)
  return endpoint.toString()
}

export function extractComicNettaiBookContentId(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl, COMICNETTAI_ORIGIN)
    if (!isTrustedComicNettaiCdnUrl(url)) {
      return null
    }
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
