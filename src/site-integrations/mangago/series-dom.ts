import type { Chapter } from "@/src/types/chapter"
import type { SeriesMetadata } from "@/src/types/series-metadata"
import type { SeriesDataResolutionResult } from "@/src/types/site-integrations"
import { sanitizeLabel } from "@/src/shared/site-integration-utils"
import { ProviderContractError } from "../provider-contract-error"
import { assertMangagoImageUrl, parseMangagoUrl } from "./shared"

function readCoverUrl(document: Document): string | undefined {
  const cover = document.querySelector(".cover img")
  const url =
    cover?.getAttribute("data-src") || cover?.getAttribute("src") || undefined
  if (url) assertMangagoImageUrl(url)
  return url
}

function findDetailCell(cells: Element[], label: string): Element | undefined {
  return cells.find(
    (cell) =>
      sanitizeLabel(cell.querySelector("label")?.textContent ?? "").replace(
        /:\s*$/,
        ""
      ) === label
  )
}

function readDetailLinks(
  cell: Element | undefined,
  selector: string
): string[] {
  const labels = Array.from(cell?.querySelectorAll(selector) ?? [])
    .map((node) => sanitizeLabel(node.textContent ?? ""))
    .filter(Boolean)
  return [...new Set(labels)]
}

function readSeriesDetails(document: Document): Partial<SeriesMetadata> {
  const cells = Array.from(document.querySelectorAll(".manga_right td"))
  const authorCell = findDetailCell(cells, "Author")
  const authors = readDetailLinks(authorCell, "a")
  const genres = readDetailLinks(
    findDetailCell(cells, "Genre(s)"),
    'a[href*="/genre/"]'
  )
  const year = authorCell?.textContent?.match(/\b(\d{4})\s+released\b/i)?.[1]
  return {
    author: authors.join(", ") || undefined,
    genres: genres.length ? genres : undefined,
    year: year ? Number(year) : undefined,
  }
}

function chapterLabels(
  title: string
): Pick<Chapter, "chapterLabel" | "chapterNumber" | "volumeNumber"> {
  const chapter = title.match(/Ch\.?\s*([\d.]+)/i)
  const volume = title.match(/Vol\.?\s*(\d+)/i)
  return {
    chapterLabel: chapter?.[1],
    chapterNumber: chapter ? Number(chapter[1]) : undefined,
    volumeNumber: volume ? Number(volume[1]) : undefined,
  }
}

function parseChapterLink(
  link: Element,
  baseUrl: URL,
  seriesId: string
): Chapter {
  const url = new URL(link.getAttribute("href") ?? "", baseUrl).href
  const parsed = parseMangagoUrl(url)
  const title = sanitizeLabel(link.textContent ?? "")
  if (!parsed.chapterId || parsed.seriesId !== seriesId || !title)
    throw new ProviderContractError(
      "Mangago chapter catalog contains invalid or duplicate chapters"
    )
  return {
    id: parsed.chapterId,
    url,
    title,
    ...chapterLabels(title),
    language: "en",
    comicInfo: { Title: title, LanguageISO: "en" },
  }
}

function readChapterCatalog(
  document: Document,
  url: URL,
  seriesId: string
): Chapter[] {
  const seen = new Set<string>()
  const chapters: Chapter[] = []
  for (const link of [
    ...document.querySelectorAll("#chapter_table a.chico"),
  ].reverse()) {
    const chapter = parseChapterLink(link, url, seriesId)
    if (seen.has(chapter.id))
      throw new ProviderContractError(
        "Mangago chapter catalog contains invalid or duplicate chapters"
      )
    seen.add(chapter.id)
    chapters.push(chapter)
    if (chapters.length > 10000)
      throw new ProviderContractError(
        "Mangago chapter catalog exceeds its limit"
      )
  }
  if (!chapters.length)
    throw new ProviderContractError("Mangago chapter catalog is unavailable")
  return chapters
}

export function parseMangagoSeries(
  document: Document,
  seriesUrl: string
): SeriesDataResolutionResult {
  const { seriesId, url } = parseMangagoUrl(seriesUrl)
  const title = sanitizeLabel(document.querySelector("h1")?.textContent ?? "")
  if (!title) throw new ProviderContractError("Mangago series title is missing")
  const coverUrl = readCoverUrl(document)
  const chapters = readChapterCatalog(document, url, seriesId)
  return {
    seriesId,
    seriesMetadata: {
      title,
      coverUrl,
      ...readSeriesDetails(document),
      description:
        sanitizeLabel(
          document.querySelector(".manga_summary")?.textContent ?? ""
        ) || undefined,
      language: "en",
    },
    chapterList: { chapters },
  }
}
