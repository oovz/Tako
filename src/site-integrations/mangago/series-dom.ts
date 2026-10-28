import type { Chapter } from "@/src/types/chapter"
import type { SeriesDataResolutionResult } from "@/src/types/site-integrations"
import { sanitizeLabel } from "@/src/shared/site-integration-utils"
import { ProviderContractError } from "../provider-contract-error"
import { assertMangagoImageUrl, parseMangagoUrl } from "./shared"

export function parseMangagoSeries(
  document: Document,
  seriesUrl: string
): SeriesDataResolutionResult {
  const { seriesId, url } = parseMangagoUrl(seriesUrl)
  const title = sanitizeLabel(document.querySelector("h1")?.textContent ?? "")
  if (!title) throw new ProviderContractError("Mangago series title is missing")
  const cover = document.querySelector(".cover img")
  const coverUrl =
    cover?.getAttribute("data-src") || cover?.getAttribute("src") || undefined
  if (coverUrl) assertMangagoImageUrl(coverUrl)
  const seen = new Set<string>()
  const chapters: Chapter[] = []
  for (const link of [
    ...document.querySelectorAll("#chapter_table a.chico"),
  ].reverse()) {
    const chapterUrl = new URL(link.getAttribute("href") ?? "", url).href
    const parsed = parseMangagoUrl(chapterUrl)
    const chapterTitle = sanitizeLabel(link.textContent ?? "")
    if (
      !parsed.chapterId ||
      parsed.seriesId !== seriesId ||
      !chapterTitle ||
      seen.has(parsed.chapterId)
    )
      throw new ProviderContractError(
        "Mangago chapter catalog contains invalid or duplicate chapters"
      )
    seen.add(parsed.chapterId)
    chapters.push({
      id: parsed.chapterId,
      url: chapterUrl,
      title: chapterTitle,
      chapterLabel: chapterTitle.match(/Ch\.?\s*([\d.]+)/i)?.[1],
      chapterNumber: chapterTitle.match(/Ch\.?\s*([\d.]+)/i)
        ? Number(chapterTitle.match(/Ch\.?\s*([\d.]+)/i)![1])
        : undefined,
      volumeNumber: chapterTitle.match(/Vol\.?\s*(\d+)/i)
        ? Number(chapterTitle.match(/Vol\.?\s*(\d+)/i)![1])
        : undefined,
      language: "en",
      comicInfo: { Title: chapterTitle, LanguageISO: "en" },
    })
    if (chapters.length > 10000)
      throw new ProviderContractError(
        "Mangago chapter catalog exceeds its limit"
      )
  }
  if (!chapters.length)
    throw new ProviderContractError("Mangago chapter catalog is unavailable")
  return {
    seriesId,
    seriesMetadata: {
      title,
      coverUrl,
      description:
        sanitizeLabel(
          document.querySelector(".manga_summary")?.textContent ?? ""
        ) || undefined,
      language: "en",
    },
    chapterList: { chapters },
  }
}
