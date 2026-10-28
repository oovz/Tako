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
  const detailCells = Array.from(document.querySelectorAll(".manga_right td"))
  const detail = (label: string) =>
    detailCells.find(
      (cell) =>
        sanitizeLabel(cell.querySelector("label")?.textContent ?? "").replace(
          /:\s*$/,
          ""
        ) === label
    )
  const authors = Array.from(detail("Author")?.querySelectorAll("a") ?? [])
    .map((node) => sanitizeLabel(node.textContent ?? ""))
    .filter(Boolean)
  const genres = Array.from(
    detail("Genre(s)")?.querySelectorAll('a[href*="/genre/"]') ?? []
  )
    .map((node) => sanitizeLabel(node.textContent ?? ""))
    .filter(Boolean)
  const year = detail("Author")?.textContent?.match(
    /\b(\d{4})\s+released\b/i
  )?.[1]
  return {
    seriesId,
    seriesMetadata: {
      title,
      coverUrl,
      author: [...new Set(authors)].join(", ") || undefined,
      genres: genres.length ? [...new Set(genres)] : undefined,
      year: year ? Number(year) : undefined,
      description:
        sanitizeLabel(
          document.querySelector(".manga_summary")?.textContent ?? ""
        ) || undefined,
      language: "en",
    },
    chapterList: { chapters },
  }
}
