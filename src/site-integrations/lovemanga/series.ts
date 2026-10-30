import type { Chapter } from "@/src/types/chapter"
import type { SeriesDataResolutionResult } from "@/src/types/site-integrations"
import {
  parseChapterNumber,
  sanitizeLabel,
} from "@/src/shared/site-integration-utils"
import { ProviderContractError } from "../provider-contract-error"
import { aimanhuaPage, aimanhuaImage } from "./reader"
function readChapters(
  document: Document,
  seriesUrl: string,
  seriesId: string
): Chapter[] {
  const links = [
    ...document.querySelectorAll(".detail-list-select a.chapteritem[href]"),
  ]
  if (!links.length || links.length > 20_000)
    throw new ProviderContractError(
      "Aimanhua chapter list is missing or exceeds its limit"
    )
  const seen = new Set<string>()
  const chapters: Chapter[] = []
  for (const link of links) {
    const url = aimanhuaPage(
      new URL(link.getAttribute("href")!, seriesUrl).href
    )
    const match = url.pathname.match(/^\/chapter\/(\d+)\/(\d+)$/)
    if (!match || match[1] !== seriesId)
      throw new ProviderContractError(
        "Aimanhua chapter link leaves the selected series"
      )
    if (seen.has(match[2])) continue
    seen.add(match[2])
    const label = sanitizeLabel(link.textContent ?? "")
    chapters.push({
      id: match[2],
      url: url.href,
      title: label,
      chapterNumber: parseChapterNumber(label),
      comicInfo: {},
    })
  }
  return chapters
}

function readAuthor(document: Document): string | undefined {
  return Array.from(document.querySelectorAll(".detail-main-info-author"))
    .map((node) => sanitizeLabel(node.textContent ?? ""))
    .find((text) => /^作者[：:]/.test(text))
    ?.replace(/^作者[：:]\s*/, "")
}

function readMetadata(document: Document, title: string) {
  const cover = document
    .querySelector(".detail-main-cover img")
    ?.getAttribute("src")
  const author = readAuthor(document)
  const genres = Array.from(
    document.querySelectorAll(".detail-main-info-class a")
  )
    .map((node) => sanitizeLabel(node.textContent ?? ""))
    .filter(Boolean)
  return {
    title,
    language: "zh",
    author: author || undefined,
    genres: genres.length ? [...new Set(genres)] : undefined,
    description:
      sanitizeLabel(
        document.querySelector(".detail-desc")?.textContent ?? ""
      ) || undefined,
    coverUrl: cover ? aimanhuaImage(cover) : undefined,
  }
}

export function resolveAimanhuaSeries(
  document: Document,
  seriesUrl: string
): SeriesDataResolutionResult {
  const seriesId =
    aimanhuaPage(seriesUrl).pathname.match(/^\/comic\/(\d+)\/?$/)?.[1]
  const title = sanitizeLabel(
    document.querySelector(".detail-main-info-title")?.textContent ?? ""
  )
  if (!seriesId || !title)
    throw new ProviderContractError("Aimanhua series is missing or unavailable")
  const chapters = readChapters(document, seriesUrl, seriesId)
  return {
    seriesId,
    seriesMetadata: readMetadata(document, title),
    chapterList: chapters,
  }
}
