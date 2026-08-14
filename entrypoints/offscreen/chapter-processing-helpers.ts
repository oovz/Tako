import type { Chapter } from "@/src/types/chapter"
import { generateComicInfo } from "@/src/runtime/comicinfo-generator"
import {
  getExtensionFromMimeType,
  normalizeImageFilename,
} from "@/src/shared/filename-sanitizer"
import { normalizeAllowedImageMimeType } from "@/src/shared/site-integration-utils"
import { buildComicInfoMetadata, type SeriesMetadataInput } from "./helpers"

export function buildImageOutputFilename(input: {
  index: number
  totalImages: number
  originalFilename: string
  mimeType: string
  normalizeImageFilenames: boolean
  imagePaddingDigits: "auto" | 2 | 3 | 4 | 5
}): string {
  const {
    index,
    totalImages,
    originalFilename,
    mimeType,
    normalizeImageFilenames,
    imagePaddingDigits,
  } = input
  const canonicalMimeType = normalizeAllowedImageMimeType(mimeType)
  if (normalizeImageFilenames) {
    return normalizeImageFilename(
      index,
      totalImages,
      canonicalMimeType,
      imagePaddingDigits
    )
  }

  const baseFilename = originalFilename.replace(
    /\.(?:jpe?g|png|webp|gif)$/i,
    ""
  )
  return `${String(index + 1).padStart(3, "0")}-${baseFilename}.${getExtensionFromMimeType(canonicalMimeType)}`
}

export function buildCoverOutputFilename(mimeType: string): string {
  const extension = getExtensionFromMimeType(
    normalizeAllowedImageMimeType(mimeType)
  )
  return `000-cover.${extension}`
}

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
