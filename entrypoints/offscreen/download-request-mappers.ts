import type { Chapter } from "@/src/types/chapter"
import type { OffscreenDownloadChapterPayload } from "@/src/runtime/message-schemas"
import type {
  ProcessChapterStreamingOptions,
  ProcessDownloadChapterSettingsSnapshot,
} from "./chapter-processing"
import type { CoverImageAsset } from "./download-runtime-helpers"

export function readProcessDownloadChapterSettingsSnapshot(
  settingsSnapshot: OffscreenDownloadChapterPayload["settingsSnapshot"]
): ProcessDownloadChapterSettingsSnapshot {
  return settingsSnapshot
}

export function createChapterForProcessing(
  chapter: OffscreenDownloadChapterPayload["chapter"]
): Chapter {
  return {
    id: chapter.id,
    url: chapter.url,
    title: chapter.title,
    chapterLabel: chapter.chapterLabel,
    chapterNumber: chapter.chapterNumber,
    volumeId: chapter.volumeId,
    volumeNumber: chapter.volumeNumber,
    volumeLabel: chapter.volumeLabel,
    language: chapter.language,
    resolvedPath: chapter.resolvedPath,
    comicInfo: chapter.language ? { LanguageISO: chapter.language } : {},
  }
}

export function createProcessChapterStreamingOptions(input: {
  request: OffscreenDownloadChapterPayload
  snapshot: ProcessDownloadChapterSettingsSnapshot
  chapter: Chapter
  abortSignal: AbortSignal
  onProgress: ProcessChapterStreamingOptions["onProgress"]
  onArchiveProgress: ProcessChapterStreamingOptions["onArchiveProgress"]
  coverImage?: CoverImageAsset
}): ProcessChapterStreamingOptions {
  const {
    request,
    snapshot,
    chapter,
    abortSignal,
    onProgress,
    onArchiveProgress,
    coverImage,
  } = input

  return {
    taskId: request.taskId,
    jobId: request.jobId,
    attempt: request.attempt,
    chapter,
    seriesTitle: request.book.seriesTitle,
    format: snapshot.archiveFormat,
    includeComicInfo: snapshot.includeComicInfo,
    downloadMode: request.saveMode === "fsa" ? "custom" : "browser",
    comicInfoVersion: "2.0",
    abortSignal,
    onProgress,
    onArchiveProgress,
    coverImage,
    integrationContext: request.integrationContext,
    // Narrow from wire format (Record<string, unknown>, Zod-validated) to
    // consumer types. The Zod schema confirms the shape is a record; the
    // snapshot is already narrowed via readProcessDownloadChapterSettingsSnapshot.
    seriesMetadata: request.book.metadata,
    settingsSnapshot: snapshot,
  }
}
