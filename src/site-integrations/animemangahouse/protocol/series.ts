import type { Chapter } from "@/src/types/chapter"
import type { SeriesDataResolutionResult } from "@/src/types/site-integrations"
import {
  parseChapterNumber,
  sanitizeLabel,
} from "@/src/shared/site-integration-utils"
import { ProviderContractError } from "../../provider-contract-error"

/**
 * The related DM5 and Mangabz viewers use the same signed request fields and
 * packed image-list layout. Their endpoints, prefixes, routes and image hosts
 * remain site-specific.
 */
export type SignedReaderSite = {
  id: "animemangahouse" | "mangabz"
  name: string
  origin: string
  prefix: "DM5" | "MANGABZ"
  chapterEndpoint: "chapterfun.ashx" | "chapterimage.ashx"
  seriesPath: RegExp
  imageHosts: string[]
}

export function assertSeriesUrl(site: SignedReaderSite, value: string): URL {
  const url = new URL(value)
  if (
    url.origin !== site.origin ||
    !site.seriesPath.test(url.pathname) ||
    url.username ||
    url.password
  ) {
    throw new ProviderContractError(`${site.name} series URL is not supported`)
  }
  return url
}

function directText(element: Element | null): string {
  return sanitizeLabel(
    Array.from(element?.childNodes ?? [])
      .filter((node) => node.nodeType === 3)
      .map((node) => node.textContent)
      .join(" ")
  )
}

function seriesSelectors(site: SignedReaderSite) {
  return site.id === "animemangahouse"
    ? {
        title: ".banner_detail_form .info > .title",
        chapters: '#chapterlistload a[href^="/m"]',
        chapterTitle: ".info .title, .title",
        cover: ".banner_detail_form .cover img",
        synopsis: ".banner_detail_form .content",
        authors: ".banner_detail_form .subtitle a",
        genres: ".banner_detail_form .tip a",
      }
    : {
        title: ".detail-info-title",
        chapters: "#chapterlistload a.detail-list-form-item",
        chapterTitle: null,
        cover: ".detail-info-cover",
        synopsis: ".detail-info-content",
        authors: ".detail-info-tip > span:first-child a, .detail-info-tip > a",
        genres: ".detail-info-tip .item",
      }
}

type SeriesSelectors = ReturnType<typeof seriesSelectors>

function readChapterLabel(
  site: SignedReaderSite,
  anchor: HTMLAnchorElement,
  titleSelector: string | null
): string {
  const label =
    directText(titleSelector ? anchor.querySelector(titleSelector) : anchor) ||
    sanitizeLabel(anchor.getAttribute("title") ?? "")
  if (!label)
    throw new ProviderContractError(`${site.name} chapter title is missing`)
  return label
}

function readChapter(
  site: SignedReaderSite,
  anchor: HTMLAnchorElement,
  titleSelector: string | null,
  seen: Set<string>
): Chapter | undefined {
  const url = new URL(anchor.getAttribute("href") ?? "", site.origin)
  const id = url.pathname.match(/^\/m(\d+)\/$/)?.[1]
  if (url.origin !== site.origin || !id || seen.has(id)) return
  seen.add(id)
  const label = readChapterLabel(site, anchor, titleSelector)
  return {
    id,
    url: url.href,
    title: label,
    chapterLabel: label,
    chapterNumber: parseChapterNumber(label),
    locked: !!anchor.querySelector(".detail-lock"),
    comicInfo: { Title: label, LanguageISO: "zh" },
  }
}

function readChapters(
  site: SignedReaderSite,
  document: Document,
  selectors: SeriesSelectors,
  script: string
): Chapter[] {
  const links = Array.from(
    document.querySelectorAll<HTMLAnchorElement>(selectors.chapters)
  )
  if (links.length > 20_000)
    throw new ProviderContractError(
      `${site.name} chapter catalog exceeds the supported size`
    )
  const chapters: Chapter[] = []
  const seen = new Set<string>()
  for (const anchor of links) {
    const chapter = readChapter(site, anchor, selectors.chapterTitle, seen)
    if (chapter) chapters.push(chapter)
  }
  if (chapters.length === 0)
    throw new ProviderContractError(
      `${site.name} chapter catalog is unavailable`
    )
  const sort = script.match(
    new RegExp(`\\b${site.prefix}_COMIC_SORT\\s*=\\s*(\\d+)`)
  )?.[1]
  if (sort !== "1" && sort !== "2")
    throw new ProviderContractError(
      `${site.name} chapter ordering is unavailable`
    )
  if (sort === "2") chapters.reverse()
  return chapters
}

function readLabels(document: Document, selector: string): string[] {
  return Array.from(document.querySelectorAll(selector))
    .map((node) => sanitizeLabel(node.textContent ?? ""))
    .filter(Boolean)
}

function readSynopsis(
  document: Document,
  selector: string
): string | undefined {
  const synopsis = document.querySelector(selector)?.cloneNode(true) as
    Element | undefined
  synopsis
    ?.querySelectorAll(".fold_open, .fold_close")
    .forEach((control) => control.remove())
  return sanitizeLabel(synopsis?.textContent ?? "") || undefined
}

function readMetadata(
  document: Document,
  selectors: SeriesSelectors,
  title: string
) {
  const authors = readLabels(document, selectors.authors)
  const genres = readLabels(document, selectors.genres)
  return {
    title,
    author: [...new Set(authors)].join(", ") || undefined,
    genres: genres.length ? [...new Set(genres)] : undefined,
    description: readSynopsis(document, selectors.synopsis),
    coverUrl:
      document.querySelector(selectors.cover)?.getAttribute("src") || undefined,
    language: "zh",
  }
}

export function resolveSeriesDocument(
  site: SignedReaderSite,
  document: Document,
  seriesUrl: string
): SeriesDataResolutionResult {
  assertSeriesUrl(site, seriesUrl)
  const selectors = seriesSelectors(site)
  const title = directText(document.querySelector(selectors.title))
  if (!title)
    throw new ProviderContractError(`${site.name} series title is missing`)
  const script = Array.from(document.scripts)
    .map((node) => node.textContent ?? "")
    .join("\n")
  const seriesId = script.match(
    new RegExp(`\\b${site.prefix}_COMIC_MID\\s*=\\s*(\\d+)`)
  )?.[1]
  if (!seriesId)
    throw new ProviderContractError(`${site.name} series identity is missing`)
  const chapters = readChapters(site, document, selectors, script)
  return {
    seriesId,
    seriesMetadata: readMetadata(document, selectors, title),
    chapterList: chapters,
  }
}
