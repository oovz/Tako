import type { Chapter } from "@/src/types/chapter"
import type { TaskSettingsSnapshot } from "@/src/types/state-snapshots"
import type { DownloadErrorCategory } from "@/src/shared/download-contract"
import type { SeriesMetadataInput } from "./helpers"

export type ChapterOutcomeStatus = "completed" | "partial_success" | "failed"

export type ErrorCategory = DownloadErrorCategory

export type ChapterOutcome = {
  status: ChapterOutcomeStatus
  errorMessage?: string
  errorCategory?: ErrorCategory
  imagesFailed?: number
  outputsRequested?: number
  outputsFailedBeforeHandoff?: number
  outputsCommitted?: number
}

export type ArchiveNormalizationSettings = {
  normalizeImageFilenames: boolean
  imagePaddingDigits: "auto" | 2 | 3 | 4 | 5
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

export type WorkerZipProgress = {
  type: "progress"
  bytes: number
  chunks: number
  final: boolean
}

export type ProcessChapterStreamingOptions = {
  taskId: string
  jobId: string
  attempt: number
  chapter: Chapter
  seriesTitle: string
  format: "cbz" | "zip" | "none"
  includeComicInfo: boolean
  downloadMode: "browser" | "custom"
  comicInfoVersion: "2.0"
  onProgress: (
    pct: number,
    label?: string,
    imageProgress?: { current: number; total: number }
  ) => Promise<void>
  onArchiveProgress: (pct: number, label?: string) => Promise<void>
  abortSignal?: AbortSignal
  normalizeImageFilenames?: boolean
  imagePaddingDigits?: "auto" | 2 | 3 | 4 | 5
  coverImage?: { data: ArrayBuffer; mimeType: string }
  onImageDownloaded?: () => void
  integrationContext?: Record<string, unknown>
  seriesMetadata?: SeriesMetadataInput
  settingsSnapshot: ProcessDownloadChapterSettingsSnapshot
}

export type ProcessDownloadChapterSettingsSnapshot = Pick<
  TaskSettingsSnapshot,
  | "archiveFormat"
  | "conflictPolicy"
  | "includeComicInfo"
  | "includeCoverImage"
  | "rateLimitSettings"
  | "retrySettings"
>

export type ChapterDownloadImageResult = {
  filename: string
  data: ArrayBuffer
  mimeType: string
}

export type ChapterDownloadImageFn = (
  url: string,
  options: {
    signal?: AbortSignal
    context?: Record<string, unknown>
    onBytesReceived?: (bytesReceived: number) => void | Promise<void>
  }
) => Promise<ChapterDownloadImageResult>

export type BrowserBlobDownloadResponse =
  | {
      success: boolean
      error?: string
    }
  | undefined

export interface ChapterProcessingRuntime {
  withImageRetries: <T>(
    fn: () => Promise<T>,
    hooks?: { onAttemptStart?: (attempt: number) => void | Promise<void> }
  ) => Promise<T>
  resolveWritableDownloadRoot: (input: {
    taskId: string
    chapter: Chapter
    totalImages: number
  }) => Promise<FileSystemDirectoryHandle>
  requestBrowserBlobDownload: (input: {
    jobId: string
    attempt: number
    taskId: string
    chapterId: string
    blob: Blob
    filename: string
    outputId: string
    outputIndex: number
    outputCount: number
    outputKind: "archive" | "image"
    signal?: AbortSignal
  }) => Promise<BrowserBlobDownloadResponse>
  getMemoryStats: () => {
    usedMB: number
    totalMB: number
    limitMB: number
  } | null
}
