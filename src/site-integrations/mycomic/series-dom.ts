import { MyComicChapterGroupSchema } from "./contracts/catalog"
import type { Chapter } from "@/src/types/chapter"
import type { SeriesMetadata } from "@/src/types/series-metadata"
import type { SeriesDataResolutionResult } from "@/src/types/site-integrations"
import {
  parseChapterNumber,
  normalizeNumericText,
  sanitizeLabel,
} from "@/src/shared/site-integration-utils"
import { ProviderContractError } from "../provider-contract-error"
import type { VolumeState } from "@/src/types/tab-state"
import {
  MYCOMIC_ORIGIN,
  assertMyComicImageUrl,
  parseMyComicUrl,
} from "./shared"

const categories = [
  { id: "mycomic:chapters", title: "单话", match: /^(?:单话|單話)$/ },
  { id: "mycomic:volumes", title: "单行本", match: /^(?:单行本|單行本)$/ },
  { id: "mycomic:extras", title: "番外篇", match: /^番外篇$/ },
]
type ChapterEntry = ReturnType<typeof MyComicChapterGroupSchema.parse>[number]

function readSeriesTitle(document: Document): string {
  const title = sanitizeLabel(
    document.querySelector("[data-flux-heading]")?.textContent ||
      document
        .querySelector('meta[property="og:title"]')
        ?.getAttribute("content")
        ?.replace(/ - MYCOMIC - .+$/, "") ||
      ""
  )
  if (!title) throw new ProviderContractError("MyComic series title is missing")
  return title
}

function readSeriesMetadata(document: Document): SeriesMetadata {
  const title = readSeriesTitle(document)
  const coverUrl =
    document
      .querySelector('meta[property="og:image"]')
      ?.getAttribute("content") ?? undefined
  if (coverUrl) assertMyComicImageUrl(coverUrl)
  const description =
    sanitizeLabel(
      document
        .querySelector('meta[property="og:description"]')
        ?.getAttribute("content") ?? ""
    ) || undefined
  return { title, coverUrl, description, language: "zh" }
}

function readChapterGroup(
  group: Element
): { entries: ChapterEntry[]; title: string } | null {
  const expression = group.getAttribute("x-data") ?? ""
  const data = expression.match(
    /(?:["']?chapters["']?)\s*:\s*(\[[\s\S]*?\])\s*,\s*["']?decending["']?\s*:/
  )?.[1]
  if (!data) return null
  const entries = MyComicChapterGroupSchema.parse(JSON.parse(data))
  const title = sanitizeLabel(
    group.querySelector("[data-flux-subheading] > div")?.textContent ?? ""
  )
  if (!title)
    throw new ProviderContractError("MyComic catalog category is missing")
  return { entries, title }
}

function registerVolume(
  volumes: VolumeState[],
  title: string
): { id: string; categoryId?: string } {
  const category = categories.find((category) => category.match.test(title))
  const id = category?.id ?? `mycomic:${title}`
  const existing = volumes.find((volume) => volume.id === id)
  if (existing) {
    existing.title = title
    existing.label = title
  } else {
    volumes.push({ id, title, label: title })
  }
  return { id, categoryId: category?.id }
}

function mapChapter(
  entry: ChapterEntry,
  prefix: string,
  volumeId: string,
  volumeLabel: string,
  categoryId: string | undefined
): Chapter {
  const chapterNumber =
    categoryId === "mycomic:chapters"
      ? parseChapterNumber(entry.title)
      : undefined
  const volumeMatch =
    categoryId === "mycomic:volumes"
      ? normalizeNumericText(entry.title).match(/^第\s*(\d+)\s*卷$/)
      : null
  const volumeNumber = volumeMatch
    ? parseChapterNumber(volumeMatch[1])
    : undefined
  return {
    id: String(entry.id),
    url: `${MYCOMIC_ORIGIN}${prefix}/chapters/${entry.id}`,
    title: entry.title,
    chapterLabel: categoryId === "mycomic:volumes" ? undefined : entry.title,
    chapterNumber,
    volumeId,
    volumeLabel,
    volumeNumber,
    language: "zh",
    comicInfo: { Title: entry.title, LanguageISO: "zh", Volume: volumeNumber },
  }
}

function readChapterCatalog(
  document: Document,
  prefix: string
): { chapters: Chapter[]; volumes: VolumeState[] } {
  const volumes: VolumeState[] = categories.map(({ id, title }) => ({
    id,
    title,
    label: title,
  }))
  const chapters: Chapter[] = []
  const seen = new Set<string>()
  for (const group of document.querySelectorAll("[x-data]")) {
    const parsed = readChapterGroup(group)
    if (!parsed) continue
    const volume = registerVolume(volumes, parsed.title)
    for (const entry of [...parsed.entries].reverse()) {
      const chapterId = String(entry.id)
      if (seen.has(chapterId))
        throw new ProviderContractError(
          "MyComic returned duplicate chapter identities"
        )
      seen.add(chapterId)
      chapters.push(
        mapChapter(entry, prefix, volume.id, parsed.title, volume.categoryId)
      )
      if (chapters.length > 10000)
        throw new ProviderContractError(
          "MyComic chapter catalog exceeds its limit"
        )
    }
  }
  if (chapters.length === 0)
    throw new ProviderContractError("MyComic chapter catalog is unavailable")
  return { chapters, volumes }
}

export function parseMyComicSeries(
  document: Document,
  seriesUrl: string
): SeriesDataResolutionResult {
  const { id, prefix } = parseMyComicUrl(seriesUrl, "comics")
  const seriesMetadata = readSeriesMetadata(document)
  return {
    seriesId: id,
    seriesMetadata,
    chapterList: readChapterCatalog(document, prefix),
  }
}
