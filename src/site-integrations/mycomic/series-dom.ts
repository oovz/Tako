import { MyComicChapterGroupSchema } from "./contracts/catalog"
import type { Chapter } from "@/src/types/chapter"
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

export function parseMyComicSeries(
  document: Document,
  seriesUrl: string
): SeriesDataResolutionResult {
  const { id, prefix } = parseMyComicUrl(seriesUrl, "comics")
  const title = sanitizeLabel(
    document.querySelector("[data-flux-heading]")?.textContent ||
      document
        .querySelector('meta[property="og:title"]')
        ?.getAttribute("content")
        ?.replace(/ - MYCOMIC - .+$/, "") ||
      ""
  )
  if (!title) throw new ProviderContractError("MyComic series title is missing")
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
  const categories = [
    { id: "mycomic:chapters", title: "单话", match: /^(?:单话|單話)$/ },
    { id: "mycomic:volumes", title: "单行本", match: /^(?:单行本|單行本)$/ },
    { id: "mycomic:extras", title: "番外篇", match: /^番外篇$/ },
  ]
  const volumes: VolumeState[] = categories.map(({ id, title }) => ({
    id,
    title,
    label: title,
  }))
  const chapters: Chapter[] = []
  const seen = new Set<string>()
  for (const group of document.querySelectorAll("[x-data]")) {
    const expression = group.getAttribute("x-data") ?? ""
    const data = expression.match(
      /(?:["']?chapters["']?)\s*:\s*(\[[\s\S]*?\])\s*,\s*["']?decending["']?\s*:/
    )?.[1]
    if (!data) continue
    const entries = MyComicChapterGroupSchema.parse(JSON.parse(data))
    const groupTitle = sanitizeLabel(
      group.querySelector("[data-flux-subheading] > div")?.textContent ?? ""
    )
    if (!groupTitle)
      throw new ProviderContractError("MyComic catalog category is missing")
    const category = categories.find((category) =>
      category.match.test(groupTitle)
    )
    const volumeId = category?.id ?? `mycomic:${groupTitle}`
    const existingVolume = volumes.find((volume) => volume.id === volumeId)
    if (existingVolume) {
      existingVolume.title = groupTitle
      existingVolume.label = groupTitle
    } else {
      volumes.push({ id: volumeId, title: groupTitle, label: groupTitle })
    }
    const ordered = [...entries].reverse()
    for (const entry of ordered) {
      const chapterId = String(entry.id)
      if (seen.has(chapterId))
        throw new ProviderContractError(
          "MyComic returned duplicate chapter identities"
        )
      seen.add(chapterId)
      const chapterNumber =
        category?.id === "mycomic:chapters"
          ? parseChapterNumber(entry.title)
          : undefined
      const volumeMatch =
        category?.id === "mycomic:volumes"
          ? normalizeNumericText(entry.title).match(/^第\s*(\d+)\s*卷$/)
          : null
      const volumeNumber = volumeMatch
        ? parseChapterNumber(volumeMatch[1])
        : undefined
      chapters.push({
        id: chapterId,
        url: `${MYCOMIC_ORIGIN}${prefix}/chapters/${chapterId}`,
        title: entry.title,
        chapterLabel:
          category?.id === "mycomic:volumes" ? undefined : entry.title,
        chapterNumber,
        volumeId,
        volumeLabel: groupTitle,
        volumeNumber,
        language: "zh",
        comicInfo: {
          Title: entry.title,
          LanguageISO: "zh",
          Volume: volumeNumber,
        },
      })
      if (chapters.length > 10000)
        throw new ProviderContractError(
          "MyComic chapter catalog exceeds its limit"
        )
    }
  }
  if (chapters.length === 0)
    throw new ProviderContractError("MyComic chapter catalog is unavailable")
  return {
    seriesId: id,
    seriesMetadata: { title, coverUrl, description, language: "zh" },
    chapterList: { chapters, volumes },
  }
}
