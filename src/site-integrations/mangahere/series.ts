import type { Chapter } from "@/src/types/chapter"
import type { SeriesDataResolutionResult } from "@/src/types/site-integrations"
import {
  parseChapterNumber,
  sanitizeLabel,
} from "@/src/shared/site-integration-utils"
import { ProviderContractError } from "../provider-contract-error"
import { mangaHereUrl, mangaHereImage } from "./reader"

function readChapterRoute(link: Element, seriesUrl: string, seriesId: string) {
  const url = mangaHereUrl(new URL(link.getAttribute("href")!, seriesUrl).href)
  const match = url.pathname.match(
    /^\/manga\/([^/]+)\/(?:(v[0-9]+)\/)?(c[^/]+)\/(?:1\.html)?$/
  )
  if (!match || match[1] !== seriesId)
    throw new ProviderContractError(
      "MangaHere chapter link leaves the selected series"
    )
  const volume = match[2]
  const chapter = match[3]
  const chapterPath = `${volume ? `${volume}/` : ""}${chapter}`
  const id = `${seriesId}/${chapterPath}`
  return { url, volume, chapter, id }
}

function readChapter(
  link: Element,
  url: URL,
  volume: string | undefined,
  chapter: string,
  id: string
): Chapter {
  const label = sanitizeLabel(link.textContent ?? "")
  const number = parseChapterNumber(chapter.slice(1))
  return {
    id,
    url: `${url.origin}${url.pathname}`,
    title: label,
    chapterNumber: number,
    ...(volume
      ? {
          volumeNumber: Number(volume.slice(1)),
          volumeLabel: `Vol.${volume.slice(1)}`,
        }
      : {}),
    comicInfo: {},
  }
}

function readChapters(
  document: Document,
  seriesUrl: string,
  seriesId: string
): Chapter[] {
  const links = [...document.querySelectorAll(".detail-chapters-list a[href]")]
  if (!links.length || links.length > 20_000)
    throw new ProviderContractError(
      "MangaHere chapter list is missing or exceeds its limit"
    )
  const seen = new Set<string>()
  const chapters: Chapter[] = []
  for (const link of links) {
    const { url, volume, chapter, id } = readChapterRoute(
      link,
      seriesUrl,
      seriesId
    )
    if (seen.has(id)) continue
    seen.add(id)
    chapters.push(readChapter(link, url, volume, chapter, id))
  }
  return chapters
}

function readDescription(document: Document): string | undefined {
  return (
    sanitizeLabel(
      document.querySelector(".detail-text-bar .fullcontent")?.textContent ??
        document.querySelector(".detail-text-bar p")?.textContent ??
        ""
    ) || undefined
  )
}

function readMetadata(document: Document, title: string) {
  const cover = document
    .querySelector('meta[name="og:image"], meta[property="og:image"]')
    ?.getAttribute("content")
  return {
    title,
    language: "en",
    author:
      sanitizeLabel(
        document
          .querySelector(".detail-author-bar")
          ?.textContent?.replace(/^\s*Author[：:]\s*/, "") ?? ""
      ) || undefined,
    description: readDescription(document),
    coverUrl: cover ? mangaHereImage(cover) : undefined,
  }
}

export function resolveMangaHereSeries(
  document: Document,
  seriesUrl: string
): SeriesDataResolutionResult {
  const seriesId = mangaHereUrl(seriesUrl).pathname.match(
    /^\/manga\/([^/]+)\/?$/
  )?.[1]
  const title = sanitizeLabel(
    document.querySelector(".detail-top-bar-info-title")?.textContent ?? ""
  )
  if (!seriesId || !title)
    throw new ProviderContractError("MangaHere series metadata is missing")
  const chapters = readChapters(document, seriesUrl, seriesId)
  return {
    seriesId,
    seriesMetadata: readMetadata(document, title),
    chapterList: chapters,
  }
}
