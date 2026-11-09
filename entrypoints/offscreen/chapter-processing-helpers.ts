import type { Chapter } from "@/src/types/chapter"
import { generateComicInfo } from "@/src/runtime/comicinfo-generator"
import { buildComicInfoMetadata, type SeriesMetadataInput } from "./helpers"

export function normalizeDownloadPath(path: string): string {
  let normalized = path.replace(/\\/g, "/").replace(/^[/.]+/, "")
  normalized = normalized.split("/").filter(Boolean).join("/")
  return normalized
}

function buildComicInfoXml(input: {
  chapter: Chapter
  seriesTitle: string
  seriesMetadata?: SeriesMetadataInput
  pageCount: number
  comicInfoVersion: "2.0"
  hasCoverImage: boolean
}): string | null {
  const {
    chapter,
    seriesTitle,
    seriesMetadata,
    pageCount,
    comicInfoVersion,
    hasCoverImage,
  } = input
  const metadata = buildComicInfoMetadata({
    chapter,
    seriesTitle,
    seriesMetadata,
    pageCount,
    hasCoverImage,
  })

  return generateComicInfo(metadata, pageCount, comicInfoVersion, hasCoverImage)
}

export function buildOptionalComicInfoXml(input: {
  includeComicInfo: boolean | undefined
  chapter: Chapter
  seriesTitle: string
  seriesMetadata?: SeriesMetadataInput
  pageCount: number
  comicInfoVersion: "2.0"
  hasCoverImage: boolean
}): string | null {
  const { includeComicInfo, ...comicInfoInput } = input
  if (!includeComicInfo) {
    return null
  }

  return buildComicInfoXml(comicInfoInput)
}
