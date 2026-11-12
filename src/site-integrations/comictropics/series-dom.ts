import { cancelResponseBody } from "@/src/shared/response-body"
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
import { integrationHttpClient } from "../http-client"
import { assertIntegrationEndpointRequestUrl } from "../request-policy"
import { ProviderContractError } from "../provider-contract-error"
import { readResponseText } from "@/src/shared/html-response-decoder"
import type { RateLimitService } from "@/src/runtime/rate-limit"
import { ChapterReleaseDateSchema } from "@/src/runtime/series-data-schemas"

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

function normalizeComicNettaiCoverUrl(
  rawUrl: string | undefined
): string | undefined {
  if (!rawUrl) return undefined

  let absoluteUrl: string
  try {
    absoluteUrl = new URL(rawUrl, COMICNETTAI_ORIGIN).href
  } catch {
    throw new ProviderContractError("Comic Nettai cover URL is malformed")
  }

  return assertIntegrationEndpointRequestUrl(
    "comictropics",
    "comictropics-cdn-image",
    absoluteUrl
  ).href
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

  const coverUrl =
    readMeta(document, 'meta[property="og:image"]') ??
    document.querySelector<HTMLImageElement>(".detail-catch__img")?.src

  return {
    title,
    author: readText(document, ".detail__author__item"),
    description:
      readText(document, ".detail--discription") ??
      readMeta(document, 'meta[name="description"]') ??
      readMeta(document, 'meta[property="og:description"]'),
    coverUrl: normalizeComicNettaiCoverUrl(coverUrl),
    language: "ja",
    readingDirection: "rtl",
    publisher: "Kobunsha",
    imprint: "COMIC熱帯",
  }
}

function readComicNettaiChapterAccess(item: HTMLElement): {
  chapterUrl: string | null
  cid: string | null
  isClosed: boolean
} {
  const rawHref = item.getAttribute("href")
  const chapterUrl = rawHref ? normalizeComicNettaiChapterUrl(rawHref) : null
  const cid = chapterUrl ? parseComicNettaiViewerCid(chapterUrl) : null
  const isClosed = item.classList.contains("is-close")
  if ((!chapterUrl || !cid) && !isClosed) {
    throw new Error("Comic Nettai open chapter is missing a valid viewer URL")
  }
  return { chapterUrl, cid, isClosed }
}

function readComicNettaiChapterIdentity(item: HTMLElement) {
  const access = readComicNettaiChapterAccess(item)
  const thumbnail = item.querySelector<HTMLImageElement>(
    ".detail--product__thum"
  )
  const thumbnailUrl =
    thumbnail?.getAttribute("data-src") || thumbnail?.src || ""
  const id = extractComicNettaiBookContentId(thumbnailUrl) ?? access.cid
  if (!id) throw new Error("Comic Nettai chapter identity is missing")
  return { ...access, thumbnail, thumbnailUrl, id }
}

function readComicNettaiChapterTitle(
  item: HTMLElement,
  thumbnail: HTMLImageElement | null,
  id: string
): string {
  return (
    sanitizeLabel(
      item.querySelector(".detail--product__item__title")?.textContent ?? ""
    ) ||
    sanitizeLabel(thumbnail?.alt ?? "") ||
    `Chapter ${id}`
  )
}

function buildComicNettaiChapter(
  item: HTMLElement,
  identity: ReturnType<typeof readComicNettaiChapterIdentity>
): Chapter {
  const { id, chapterUrl, cid, isClosed, thumbnail, thumbnailUrl } = identity
  const url =
    chapterUrl && cid
      ? new URL(chapterUrl, COMICNETTAI_ORIGIN).toString()
      : buildLockedComicNettaiChapterUrl(thumbnailUrl, id)
  if (!url)
    throw new Error("Comic Nettai chapter URL could not be reconstructed")
  const title = readComicNettaiChapterTitle(item, thumbnail, id)
  const chapterNumber = parseChapterNumber(title)
  const date = item
    .querySelector(".detail--product__item__sdate")
    ?.textContent?.trim()
  const releaseDate = ChapterReleaseDateSchema.safeParse(
    date?.replaceAll(".", "-")
  ).data
  return {
    id,
    url,
    title,
    locked: isClosed || !item.classList.contains("is-open"),
    chapterLabel: title,
    chapterNumber,
    releaseDate,
    language: "ja",
    comicInfo: {
      Title: title,
      Number:
        typeof chapterNumber === "number" ? String(chapterNumber) : undefined,
      LanguageISO: "ja",
      Manga: "YesAndRightToLeft",
    },
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
    const identity = readComicNettaiChapterIdentity(item)
    if (seen.has(identity.id)) continue
    chapters.push(buildComicNettaiChapter(item, identity))
    seen.add(identity.id)
  }
  return { chapters, volumes: [] }
}

const MAX_COMICNETTAI_PAGINATION_PAGES = 100
const COMICNETTAI_PAGINATION_CONCURRENCY = 4
const COMICNETTAI_PAGINATION_TIMEOUT_MS = 10_000

type ComicNettaiDocumentLoader = (
  url: string,
  rateLimitService: RateLimitService,
  signal?: AbortSignal
) => Promise<Document>

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
    if (anchor.closest(".is-hidde")) {
      continue
    }
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

function getPaginationRequestError(
  error: unknown,
  requestSignal: AbortSignal,
  externalSignal?: AbortSignal
): unknown {
  if (!requestSignal.aborted) return error
  if (externalSignal?.aborted) {
    return externalSignal.reason instanceof Error
      ? externalSignal.reason
      : new Error("Comic Nettai series resolution was canceled", {
          cause: error,
        })
  }
  return new Error("Comic Nettai pagination request timed out", {
    cause: error,
  })
}

function assertComicNettaiResolutionActive(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error("Comic Nettai series resolution was canceled")
  }
}

export async function loadComicNettaiPaginationDocument(
  url: string,
  rateLimitService: RateLimitService,
  signal?: AbortSignal
): Promise<Document> {
  const controller = new AbortController()
  const timeoutError = new Error(
    `Comic Nettai pagination request timed out after ${COMICNETTAI_PAGINATION_TIMEOUT_MS}ms`
  )
  const abortExternal = () => controller.abort(signal?.reason)
  signal?.addEventListener("abort", abortExternal, { once: true })
  if (signal?.aborted) abortExternal()
  const timeout = globalThis.setTimeout(() => {
    controller.abort(timeoutError)
  }, COMICNETTAI_PAGINATION_TIMEOUT_MS)

  try {
    const response = await integrationHttpClient.request({
      integrationId: "comictropics",
      endpointId: "comictropics-viewer-page",
      url,
      scope: "chapter",
      init: {
        credentials: "include",
        signal: controller.signal,
      },
      rateLimitService,
    })
    if (!response.ok) {
      cancelResponseBody(response)
      throw Object.assign(
        new Error(
          `Comic Nettai pagination request failed (HTTP ${response.status})`
        ),
        { status: response.status }
      )
    }
    const html = await readResponseText(response)
    return new DOMParser().parseFromString(html, "text/html")
  } catch (error) {
    throw getPaginationRequestError(error, controller.signal, signal)
  } finally {
    globalThis.clearTimeout(timeout)
    signal?.removeEventListener("abort", abortExternal)
  }
}

type ComicNettaiPaginationState = {
  documents: Map<number, Document>
  queuedUrls: Map<number, string>
}
type ComicNettaiLoadedPage = { page: number; url: string; document: Document }

function createComicNettaiPaginationState(
  currentDocument: Document,
  currentUrl: string
): ComicNettaiPaginationState {
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
  return { documents, queuedUrls }
}

async function loadComicNettaiPaginationBatch(
  state: ComicNettaiPaginationState,
  loadDocument: ComicNettaiDocumentLoader,
  rateLimitService: RateLimitService,
  signal?: AbortSignal
): Promise<ComicNettaiLoadedPage[]> {
  const batch = [...state.queuedUrls.entries()]
    .sort(([left], [right]) => left - right)
    .slice(0, COMICNETTAI_PAGINATION_CONCURRENCY)
  for (const [page] of batch) state.queuedUrls.delete(page)
  return Promise.all(
    batch
      .filter(([page]) => !state.documents.has(page))
      .map(async ([page, url]) => ({
        page,
        url,
        document: await loadDocument(url, rateLimitService, signal),
      }))
  )
}

function acceptComicNettaiPaginationPages(
  state: ComicNettaiPaginationState,
  loadedPages: ComicNettaiLoadedPage[],
  signal?: AbortSignal
): void {
  for (const loaded of loadedPages) {
    assertComicNettaiResolutionActive(signal)
    state.documents.set(loaded.page, loaded.document)
    for (const [page, url] of discoverPaginationUrls(
      loaded.document,
      new URL(loaded.url)
    )) {
      if (!state.documents.has(page) && !state.queuedUrls.has(page)) {
        state.queuedUrls.set(page, url)
      }
    }
  }
}

function mergeComicNettaiPaginationChapters(
  documents: Map<number, Document>
): Chapter[] {
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
  return chapters
}

export async function extractComicNettaiChapterListWithPagination(
  currentDocument: Document,
  currentUrl: string,
  rateLimitService: RateLimitService,
  loadDocument: ComicNettaiDocumentLoader = loadComicNettaiPaginationDocument,
  signal?: AbortSignal
): Promise<SeriesChapterListResult> {
  const state = createComicNettaiPaginationState(currentDocument, currentUrl)
  while (state.queuedUrls.size > 0) {
    assertComicNettaiResolutionActive(signal)
    const loaded = await loadComicNettaiPaginationBatch(
      state,
      loadDocument,
      rateLimitService,
      signal
    )
    acceptComicNettaiPaginationPages(state, loaded, signal)
  }
  return {
    chapters: mergeComicNettaiPaginationChapters(state.documents),
    volumes: [],
  }
}
