import type { Chapter } from "@/src/types/chapter"
import logger from "@/src/runtime/logger"
import { sanitizeFilename } from "@/src/shared/filename-sanitizer"
import { MAX_ARCHIVE_BYTES, MAX_CHAPTER_IMAGES } from "@/src/constants/timeouts"
import type {
  OffscreenLiveResourceLedger,
  OffscreenLiveResourceLease,
} from "@/src/runtime/offscreen-live-resource-ledger"
import { ArchiveWorkerSession } from "./archive-worker-session"
import {
  buildCoverOutputFilename,
  buildOptionalComicInfoXml,
} from "./chapter-processing-helpers"
import { ChapterResourceLimitError } from "./chapter-image-downloads"
import type { ArchiveNormalizationSettings } from "./chapter-processing-types"
import type { SeriesMetadataInput } from "./helpers"

export function assertChapterImageCount(imageCount: number): void {
  if (imageCount > MAX_CHAPTER_IMAGES) {
    throw new ChapterResourceLimitError(
      `Chapter image count exceeds ${MAX_CHAPTER_IMAGES} image limit (got ${imageCount})`
    )
  }
}

export function initializeArchiveWorker(input: {
  session: ArchiveWorkerSession
  chapter: Chapter
  format: "cbz" | "zip"
  normalizeSettings: ArchiveNormalizationSettings
  totalImages: number
}): void {
  const { session, chapter, format, normalizeSettings, totalImages } = input
  session.post({
    type: "init",
    chapterTitle: sanitizeFilename(chapter.title),
    extension: format,
    normalizeImageFilenames: normalizeSettings.normalizeImageFilenames,
    imagePaddingDigits: normalizeSettings.imagePaddingDigits,
    totalImages,
    maxArchiveBytes: MAX_ARCHIVE_BYTES,
  })
}

export function addComicInfoToArchiveWorker(input: {
  session: ArchiveWorkerSession
  includeComicInfo: boolean | undefined
  chapter: Chapter
  seriesTitle: string
  seriesMetadata?: SeriesMetadataInput
  pageCount: number
  comicInfoVersion: "2.0"
  hasCoverImage: boolean
}): void {
  const {
    session,
    includeComicInfo,
    chapter,
    seriesTitle,
    seriesMetadata,
    pageCount,
    comicInfoVersion,
    hasCoverImage,
  } = input
  const xml = buildOptionalComicInfoXml({
    includeComicInfo,
    chapter,
    seriesTitle,
    seriesMetadata,
    pageCount,
    comicInfoVersion,
    hasCoverImage,
  })
  if (!xml) {
    return
  }

  session.post({ type: "addComicInfo", xml })
  logger.debug(
    `📋 Added ComicInfo.xml as first entry (${pageCount} pages estimated)`
  )
}

export function addCoverToArchiveWorker(
  session: ArchiveWorkerSession,
  liveResourceLedger: OffscreenLiveResourceLedger,
  inputId: string,
  coverImage?: {
    data: ArrayBuffer
    mimeType: string
    liveResourceLease?: OffscreenLiveResourceLease
  }
): void {
  if (!coverImage) {
    return
  }

  const coverBuffer = coverImage.data
  const inputLease =
    coverImage.liveResourceLease ??
    liveResourceLedger.reserve(
      coverBuffer.byteLength,
      "untracked archive cover input"
    )
  session.post(
    {
      type: "addImage",
      inputId,
      filename: buildCoverOutputFilename(coverImage.mimeType),
      buffer: coverBuffer,
      index: 0,
      mimeType: coverImage.mimeType,
    },
    [coverBuffer],
    inputLease
  )
}
