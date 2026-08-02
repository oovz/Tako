import {
  parseChapterNumber,
  sanitizeLabel,
} from "@/src/shared/site-integration-utils"
import type { Chapter } from "@/src/types/chapter"
import type { SeriesMetadata } from "@/src/types/series-metadata"
import type { SeriesChapterListResult } from "@/src/types/site-integrations"
import {
  COMICNETTAI_CDN_HOST,
  COMICNETTAI_ORIGIN,
  extractComicNettaiBookContentId,
  normalizeComicNettaiChapterUrl,
  parseComicNettaiSeriesIdFromPath,
  parseComicNettaiViewerCid,
} from "./shared"
import {
  assertIntegrationRequestUrl,
  assertIntegrationResponseUrl,
} from "../request-policy"
import { rateLimitedFetchForIntegration } from "@/src/runtime/rate-limit"
import { readResponseText } from "@/src/shared/html-response-decoder"

function buildLockedComicNettaiChapterUrl(
  thumbnailUrl: string,
  contentId: string
): string | null {
  try {
    const thumbnail = new URL(thumbnailUrl, COMICNETTAI_ORIGIN)
    if (
      thumbnail.protocol !== "https:" ||
      thumbnail.hostname !== COMICNETTAI_CDN_HOST
    ) {
      return null
    }
    const seriesId = thumbnail.pathname.match(
      /^\/(\d+)(?:_[^/]*)?\/book_contents\/\d+\//
    )?.[1]
    if (!seriesId) {
      return null
    }
    const lockedUrl = new URL(`/book/${seriesId}`, COMICNETTAI_ORIGIN)
    lockedUrl.hash = `book-content-${contentId}`
    return lockedUrl.toString()
  } catch {
    return null
  }
}

function readText(document: Document, selector: string): string | undefined {
  const text = sanitizeLabel(
    document.querySelector(selector)?.textContent ?? ""
  )
  return text || undefined
}

function readMeta(document: Document, selector: string): string | undefined {
  const content = sanitizeLabel(
    document.querySelector(selector)?.getAttribute("content") ?? ""
  )
  return content || undefined
}

function readSeriesTitleFromOpenGraph(document: Document): string | undefined {
  const title = readMeta(document, 'meta[property="og:title"]')
  return title?.split(" - ")[0]?.trim() || title
}

export function extractComicNettaiSeriesMetadataFromDocument(
  document: Document
): SeriesMetadata {
  const title =
    readText(document, ".detail--title") ??
    readSeriesTitleFromOpenGraph(document)
  if (!title) {
    throw new Error("Comic Nettai series title not found in page DOM")
  }

  return {
    title,
    author: readText(document, ".detail__author__item"),
    description:
      readText(document, ".detail--discription") ??
      readMeta(document, 'meta[name="description"]') ??
      readMeta(document, 'meta[property="og:description"]'),
    coverUrl:
      readMeta(document, 'meta[property="og:image"]') ??
      document.querySelector<HTMLImageElement>(".detail-catch__img")?.src,
    language: "ja",
    readingDirection: "rtl",
  }
}

export function extractComicNettaiChapterListFromDocument(
  document: Document
): SeriesChapterListResult {
  const chapters: Chapter[] = []
  const seen = new Set<string>()

  for (const item of document.querySelectorAll<HTMLElement>(
    ".detail--product__item"
  )) {
    const rawHref = item.getAttribute("href")
    const chapterUrl = rawHref ? normalizeComicNettaiChapterUrl(rawHref) : null
    const isClosed = item.classList.contains("is-close")
    const cid = chapterUrl ? parseComicNettaiViewerCid(chapterUrl) : null
    if ((!chapterUrl || !cid) && !isClosed) {
      throw new Error("Comic Nettai open chapter is missing a valid viewer URL")
    }

    const thumbnail = item.querySelector<HTMLImageElement>(
      ".detail--product__thum"
    )
    const thumbnailUrl =
      thumbnail?.getAttribute("data-src") || thumbnail?.src || ""
    const id = extractComicNettaiBookContentId(thumbnailUrl) ?? cid
    if (!id) {
      throw new Error("Comic Nettai chapter identity is missing")
    }
    if (seen.has(id)) continue

    const url =
      chapterUrl && cid
        ? new URL(chapterUrl, COMICNETTAI_ORIGIN).toString()
        : buildLockedComicNettaiChapterUrl(thumbnailUrl, id)
    if (!url) {
      throw new Error("Comic Nettai chapter URL could not be reconstructed")
    }

    const title =
      sanitizeLabel(
        item.querySelector(".detail--product__item__title")?.textContent ?? ""
      ) ||
      sanitizeLabel(thumbnail?.alt ?? "") ||
      `Chapter ${id}`
    const chapterNumber = parseChapterNumber(title)
    seen.add(id)
    chapters.push({
      id,
      url,
      title,
      locked: isClosed || !item.classList.contains("is-open"),
      chapterLabel: title,
      chapterNumber,
      language: "ja",
      comicInfo: {
        Title: title,
        Number:
          typeof chapterNumber === "number" ? String(chapterNumber) : undefined,
        LanguageISO: "ja",
        Manga: "YesAndRightToLeft",
      },
    })
  }

  return { chapters, volumes: [] }
}

const MAX_COMICNETTAI_PAGINATION_PAGES = 100
const COMICNETTAI_PAGINATION_CONCURRENCY = 4
const COMICNETTAI_PAGINATION_TIMEOUT_MS = 10_000

type ComicNettaiDocumentLoader = (url: string) => Promise<Document>

function getPaginationPageNumber(url: URL): number {
  const rawPage = url.searchParams.get("page")
  if (rawPage === null) {
    return 1
  }

  const page = Number(rawPage)
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new Error(`Invalid Comic Nettai pagination page: ${rawPage}`)
  }
  if (page > MAX_COMICNETTAI_PAGINATION_PAGES) {
    throw new Error(
      `Comic Nettai pagination exceeds the ${MAX_COMICNETTAI_PAGINATION_PAGES}-page safety limit`
    )
  }
  return page
}

function getListingVariant(url: URL): string {
  const variant = new URLSearchParams(url.searchParams)
  variant.delete("page")
  variant.sort()
  return variant.toString()
}

function discoverPaginationUrls(
  document: Document,
  listingUrl: URL
): Map<number, string> {
  const discovered = new Map<number, string>()
  const listingVariant = getListingVariant(listingUrl)

  for (const anchor of document.querySelectorAll<HTMLAnchorElement>(
    'a[href*="page="]'
  )) {
    const href = anchor.getAttribute("href")
    if (!href) {
      continue
    }

    let pageUrl: URL
    try {
      pageUrl = new URL(href, listingUrl)
    } catch {
      continue
    }
    if (
      pageUrl.origin !== listingUrl.origin ||
      pageUrl.pathname !== listingUrl.pathname ||
      getListingVariant(pageUrl) !== listingVariant
    ) {
      continue
    }

    let page: number
    try {
      page = getPaginationPageNumber(pageUrl)
    } catch {
      // The provider renders disabled previous/next controls as page=0 or
      // otherwise non-page links. They are not pagination data.
      continue
    }
    discovered.set(page, pageUrl.toString())
  }

  return discovered
}

export async function loadComicNettaiPaginationDocument(
  url: string
): Promise<Document> {
  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => {
    controller.abort(
      new Error(
        `Comic Nettai pagination request timed out after ${COMICNETTAI_PAGINATION_TIMEOUT_MS}ms`
      )
    )
  }, COMICNETTAI_PAGINATION_TIMEOUT_MS)

  try {
    assertIntegrationRequestUrl("comicnettai", url)
    const response = await rateLimitedFetchForIntegration(
      "comicnettai",
      url,
      "chapter",
      {
        credentials: "include",
        redirect: "error",
        signal: controller.signal,
      }
    )
    assertIntegrationResponseUrl("comicnettai", url, response.url)
    if (!response.ok) {
      throw new Error(
        `Comic Nettai pagination request failed (HTTP ${response.status})`
      )
    }
    const html = await readResponseText(response)
    return new DOMParser().parseFromString(html, "text/html")
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("Comic Nettai pagination request timed out", {
        cause: error,
      })
    }
    throw error
  } finally {
    globalThis.clearTimeout(timeout)
  }
}

export async function extractComicNettaiChapterListWithPagination(
  currentDocument: Document,
  currentUrl: string,
  loadDocument: ComicNettaiDocumentLoader = loadComicNettaiPaginationDocument
): Promise<SeriesChapterListResult> {
  const listingUrl = new URL(currentUrl)
  if (
    listingUrl.origin !== COMICNETTAI_ORIGIN ||
    !parseComicNettaiSeriesIdFromPath(listingUrl.pathname)
  ) {
    throw new Error(`Invalid Comic Nettai series URL: ${currentUrl}`)
  }

  const currentPage = getPaginationPageNumber(listingUrl)
  const documents = new Map<number, Document>([[currentPage, currentDocument]])
  const queuedUrls = discoverPaginationUrls(currentDocument, listingUrl)

  if (currentPage > 1 && !queuedUrls.has(1)) {
    const firstPageUrl = new URL(listingUrl)
    firstPageUrl.searchParams.delete("page")
    queuedUrls.set(1, firstPageUrl.toString())
  }
  queuedUrls.delete(currentPage)

  while (queuedUrls.size > 0) {
    const batch = [...queuedUrls.entries()]
      .sort(([left], [right]) => left - right)
      .slice(0, COMICNETTAI_PAGINATION_CONCURRENCY)
    for (const [page] of batch) {
      queuedUrls.delete(page)
    }

    const loadedDocuments = await Promise.all(
      batch
        .filter(([page]) => !documents.has(page))
        .map(async ([page, url]) => ({
          page,
          url,
          document: await loadDocument(url),
        }))
    )
    for (const loaded of loadedDocuments) {
      documents.set(loaded.page, loaded.document)
      for (const [page, url] of discoverPaginationUrls(
        loaded.document,
        new URL(loaded.url)
      )) {
        if (!documents.has(page) && !queuedUrls.has(page)) {
          queuedUrls.set(page, url)
        }
      }
    }
  }

  const chapters: Chapter[] = []
  const seen = new Set<string>()
  for (const [, pageDocument] of [...documents].sort(
    ([left], [right]) => left - right
  )) {
    const pageResult = extractComicNettaiChapterListFromDocument(pageDocument)
    const pageChapters = Array.isArray(pageResult)
      ? pageResult
      : pageResult.chapters
    for (const chapter of pageChapters) {
      if (!seen.has(chapter.id)) {
        seen.add(chapter.id)
        chapters.push(chapter)
      }
    }
  }

  return { chapters, volumes: [] }
}
