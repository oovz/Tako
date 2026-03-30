import type { Chapter } from '@/src/types/chapter'
import type { OffscreenDownloadChapterMessage } from '@/src/types/offscreen-messages'
import type {
  ProcessChapterStreamingOptions,
  ProcessDownloadChapterSettingsSnapshot,
} from './chapter-processing'
import type { CoverImageAsset } from './download-runtime-helpers'

export function readProcessDownloadChapterSettingsSnapshot(
  settingsSnapshot: OffscreenDownloadChapterMessage['payload']['settingsSnapshot']
): ProcessDownloadChapterSettingsSnapshot {
  return settingsSnapshot as ProcessDownloadChapterSettingsSnapshot
}

export function createChapterForProcessing(
  chapter: OffscreenDownloadChapterMessage['payload']['chapter']
): Chapter {
  return {
    id: chapter.id,
    url: chapter.url,
    title: chapter.title,
    chapterLabel: chapter.chapterLabel,
    chapterNumber: chapter.chapterNumber,
    volumeNumber: chapter.volumeNumber,
    volumeLabel: chapter.volumeLabel,
    language: chapter.language,
    resolvedPath: chapter.resolvedPath,
    comicInfo: chapter.language ? { LanguageISO: chapter.language } : {},
  }
}

export function createProcessChapterStreamingOptions(input: {
  request: OffscreenDownloadChapterMessage['payload']
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
    seriesMetadata: request.book.metadata,
    settingsSnapshot: request.settingsSnapshot,
  }
}
