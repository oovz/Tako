import type { Chapter } from '@/src/types/chapter'
import type { OffscreenDownloadChapterPayload } from '@/src/runtime/message-schemas'
import type { SeriesMetadataSnapshot } from '@/src/types/state-snapshots'
import type {
  ProcessChapterStreamingOptions,
  ProcessDownloadChapterSettingsSnapshot,
} from './chapter-processing'
import type { CoverImageAsset } from './download-runtime-helpers'

export function readProcessDownloadChapterSettingsSnapshot(
  settingsSnapshot: OffscreenDownloadChapterPayload['settingsSnapshot']
): ProcessDownloadChapterSettingsSnapshot {
  return settingsSnapshot as ProcessDownloadChapterSettingsSnapshot
}

export function createChapterForProcessing(
  chapter: OffscreenDownloadChapterPayload['chapter']
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
  onProgress: ProcessChapterStreamingOptions['onProgress']
  onArchiveProgress: ProcessChapterStreamingOptions['onArchiveProgress']
  coverImage?: CoverImageAsset
}): ProcessChapterStreamingOptions {
  const { request, snapshot, chapter, abortSignal, onProgress, onArchiveProgress, coverImage } = input

  return {
    taskId: request.taskId,
    chapter,
    seriesTitle: request.book.seriesTitle,
    format: snapshot.archiveFormat ?? 'cbz',
    includeComicInfo: snapshot.includeComicInfo ?? true,
    downloadMode: request.saveMode === 'fsa' ? 'custom' : 'browser',
    overwriteExisting: snapshot.overwriteExisting ?? false,
    comicInfoVersion: '2.0',
    abortSignal,
    onProgress,
    onArchiveProgress,
    coverImage,
    integrationContext: request.integrationContext,
    // Narrow from wire format (Record<string, unknown>, Zod-validated) to
    // consumer types. The Zod schema confirms the shape is a record; the
    // snapshot is already narrowed via readProcessDownloadChapterSettingsSnapshot.
    seriesMetadata: request.book.metadata as SeriesMetadataSnapshot | undefined,
    settingsSnapshot: snapshot,
  }
}
