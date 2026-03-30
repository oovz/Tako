import type { Chapter } from '@/src/types/chapter'
import type { TaskSettingsSnapshot } from '@/src/types/state-snapshots'
import type { SeriesMetadataInput } from './helpers'

export type ChapterOutcomeStatus = 'completed' | 'partial_success' | 'failed'

export type ErrorCategory = 'network' | 'download' | 'other'

export type ChapterOutcome = {
  status: ChapterOutcomeStatus
  errorMessage?: string
  errorCategory?: ErrorCategory
  imagesFailed?: number
}

export type ArchiveNormalizationSettings = {
  normalizeImageFilenames: boolean
  imagePaddingDigits: 'auto' | 2 | 3 | 4 | 5
}

export type WorkerZipResult = {
  success: boolean
  buffer?: ArrayBuffer
  filename?: string
  size?: number
  imageCount?: number
  format?: string
  error?: string
}

export type ProcessChapterStreamingOptions = {
  taskId: string
  chapter: Chapter
  seriesTitle: string
  format: 'cbz' | 'zip' | 'none'
  includeComicInfo: boolean | undefined
  downloadMode: 'browser' | 'custom'
  overwriteExisting: boolean
  comicInfoVersion: '2.0'
  onProgress: (pct: number, label?: string, imageProgress?: { current: number; total: number }) => Promise<void>
  onArchiveProgress: (pct: number, label?: string) => Promise<void>
  abortSignal?: AbortSignal
  normalizeImageFilenames?: boolean
  imagePaddingDigits?: 'auto' | 2 | 3 | 4 | 5
  coverImage?: { data: ArrayBuffer; mimeType: string }
  onImageDownloaded?: () => void
  integrationContext?: Record<string, unknown>
  seriesMetadata?: SeriesMetadataInput
  settingsSnapshot?: TaskSettingsSnapshot
}

export type ProcessDownloadChapterSettingsSnapshot = Partial<{
  archiveFormat: 'cbz' | 'zip' | 'none'
  overwriteExisting: boolean
  includeComicInfo: boolean
  includeCoverImage: boolean
}>

export type ChapterDownloadImageResult = {
  filename: string
  data: ArrayBuffer
  mimeType: string
}

export type ChapterDownloadImageFn = (
  url: string,
  options: { signal?: AbortSignal; context?: Record<string, unknown> },
) => Promise<ChapterDownloadImageResult>

export type BrowserBlobDownloadResponse = {
  success: boolean
  error?: string
} | undefined

export interface ChapterProcessingRuntime {
  withImageRetries: <T>(fn: () => Promise<T>) => Promise<T>
  resolveWritableDownloadRoot: (input: {
    taskId: string
    chapter: Chapter
    totalImages: number
  }) => Promise<FileSystemDirectoryHandle | null>
  emitFsaFallbackProgress: (taskId: string, chapter: Chapter, totalImages: number) => Promise<void>
  requestBrowserBlobDownload: (input: {
    taskId: string
    chapterId: string
    blob: Blob
    filename: string
  }) => Promise<BrowserBlobDownloadResponse>
  retryWithBrowserDownloads: (opts: ProcessChapterStreamingOptions) => Promise<ChapterOutcome>
  getMemoryStats: () => { usedMB: number; totalMB: number; limitMB: number } | null
}
