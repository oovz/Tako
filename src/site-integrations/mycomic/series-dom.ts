import { MyComicChapterGroupSchema } from "./contracts/catalog"
import type { Chapter } from "@/src/types/chapter"
import type { SeriesDataResolutionResult } from "@/src/types/site-integrations"
import {
  parseChapterNumber,
  sanitizeLabel,
} from "@/src/shared/site-integration-utils"
import { ProviderContractError } from "../provider-contract-error"
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
    const ordered = [...entries].reverse()
    for (const entry of ordered) {
      const chapterId = String(entry.id)
      if (seen.has(chapterId))
        throw new ProviderContractError(
          "MyComic returned duplicate chapter identities"
        )
      seen.add(chapterId)
      const chapterNumber = parseChapterNumber(entry.title)
      chapters.push({
        id: chapterId,
        url: `${MYCOMIC_ORIGIN}${prefix}/chapters/${chapterId}`,
        title: entry.title,
        chapterLabel: entry.title,
        chapterNumber,
        volumeId: groupTitle || undefined,
        volumeLabel: groupTitle || undefined,
        language: "zh",
        comicInfo: { Title: entry.title, LanguageISO: "zh" },
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
    seriesMetadata: { title, coverUrl, language: "zh" },
    chapterList: { chapters },
  }
}
