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

export function resolveSeriesDocument(
  site: SignedReaderSite,
  document: Document,
  seriesUrl: string
): SeriesDataResolutionResult {
  assertSeriesUrl(site, seriesUrl)
  const dm5 = site.id === "animemangahouse"
  const title = directText(
    document.querySelector(
      dm5 ? ".banner_detail_form .info > .title" : ".detail-info-title"
    )
  )
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
  const links = Array.from(
    document.querySelectorAll<HTMLAnchorElement>(
      dm5
        ? '#chapterlistload a[href^="/m"]'
        : "#chapterlistload a.detail-list-form-item"
    )
  )
  if (links.length > 20_000)
    throw new ProviderContractError(
      `${site.name} chapter catalog exceeds the supported size`
    )
  const chapters: Chapter[] = []
  const seen = new Set<string>()
  for (const anchor of links) {
    const url = new URL(anchor.getAttribute("href") ?? "", site.origin)
    const id = url.pathname.match(/^\/m(\d+)\/$/)?.[1]
    if (url.origin !== site.origin || !id || seen.has(id)) continue
    seen.add(id)
    const label =
      directText(dm5 ? anchor.querySelector(".info .title, .title") : anchor) ||
      sanitizeLabel(anchor.getAttribute("title") ?? "")
    if (!label)
      throw new ProviderContractError(`${site.name} chapter title is missing`)
    chapters.push({
      id,
      url: url.href,
      title: label,
      chapterLabel: label,
      chapterNumber: parseChapterNumber(label),
      locked: !!anchor.querySelector(".detail-lock"),
      comicInfo: { Title: label, LanguageISO: "zh" },
    })
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
  const cover = document
    .querySelector(
      dm5 ? ".banner_detail_form .cover img" : ".detail-info-cover"
    )
    ?.getAttribute("src")
  return {
    seriesId,
    seriesMetadata: {
      title,
      author:
        sanitizeLabel(
          document.querySelector(
            dm5 ? ".banner_detail_form .subtitle a" : ".detail-info-tip a"
          )?.textContent ?? ""
        ) || undefined,
      description:
        sanitizeLabel(
          document.querySelector(
            dm5 ? ".banner_detail_form .content" : ".detail-info-content"
          )?.textContent ?? ""
        ) || undefined,
      coverUrl: cover || undefined,
      language: "zh",
    },
    chapterList: chapters,
  }
}
