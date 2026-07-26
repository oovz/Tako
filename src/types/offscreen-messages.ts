import type { ErrorResponse } from "@/src/types/message-common"
import type { OffscreenDownloadChapterPayload } from "@/src/runtime/message-schemas"
import type { DownloadErrorCategory } from "@/src/shared/download-contract"
import type { OffscreenJobStage } from "@/src/types/queue-state"

export interface OffscreenJobIdentity {
  jobId: string
  attempt: number
  taskId: string
  chapterId: string
}

export interface OffscreenJobState extends OffscreenJobIdentity {
  status: "active" | "terminal" | "canceled"
  stage: OffscreenJobStage
  sequence: number
  outcome?: {
    status: "completed" | "partial_success" | "failed"
    errorMessage?: string
    errorCategory?: DownloadErrorCategory
    imagesFailed?: number
    outputsRequested?: number
    outputsFailedBeforeHandoff?: number
    outputsCommitted?: number
  }
}

export interface OffscreenStatusMessage {
  type: "OFFSCREEN_STATUS"
}

export interface OffscreenStatusResponse {
  success: boolean
  isInitialized: boolean
  ready?: boolean
  activeJobCount: number
  activeTaskIds: string[]
}

export interface OffscreenDownloadProgressMessage {
  type: "OFFSCREEN_DOWNLOAD_PROGRESS"
  payload: {
    jobId: string
    attempt: number
    taskId: string
    chapterId: string
    sequence: number
    stage: OffscreenJobStage
    phaseFraction?: number
    status: "downloading" | "completed" | "failed" | "partial_success"
    chapterTitle?: string
    error?: string
    errorCategory?: DownloadErrorCategory
    imagesProcessed?: number
    imagesFailed?: number
    outputsRequested?: number
    outputsFailedBeforeHandoff?: number
    outputsCommitted?: number
    totalImages?: number
  }
}

export type OffscreenDownloadProgressResponse =
  { success: true } | ErrorResponse

/**
 * Message type for OFFSCREEN_DOWNLOAD_CHAPTER.
 *
 * The `payload` field uses the Zod-inferred `OffscreenDownloadChapterPayload`
 * type (from `message-schemas.ts`) as the single source of truth. This keeps
 * the runtime-validated wire format and the static type aligned — no
 * `as unknown as` casts needed at the validation boundary.
 *
 * `settingsSnapshot` and `book.metadata` are `Record<string, unknown>` on the
 * wire; downstream code narrows them to `TaskSettingsSnapshot` /
 * `SeriesMetadataSnapshot` via dedicated helpers.
 */
export interface OffscreenDownloadChapterMessage {
  type: "OFFSCREEN_DOWNLOAD_CHAPTER"
  payload: OffscreenDownloadChapterPayload
}

export type OffscreenDownloadChapterResponse =
  | {
      success: true
      status: "completed" | "partial_success" | "failed"
      errorMessage?: string
      errorCategory?: DownloadErrorCategory
      imagesFailed?: number
      outputsRequested?: number
      outputsFailedBeforeHandoff?: number
      outputsCommitted?: number
    }
  | ErrorResponse

export interface OffscreenOutputReadyMessage {
  type: "OFFSCREEN_OUTPUT_READY"
  payload: {
    jobId: string
    attempt: number
    outputId: string
    taskId: string
    chapterId: string
    fileUrl: string
    filename: string
    outputIndex: number
    outputCount: number
    outputKind: "archive" | "image"
  }
}

export type OffscreenOutputReadyResponse =
  | { success: true; accepted: true; id: number }
  | { success: true; accepted: "unknown"; id?: number }
  | ErrorResponse

export interface RevokeBlobUrlMessage {
  type: "REVOKE_BLOB_URL"
  payload: {
    jobId: string
    attempt: number
    outputId: string
    blobUrl: string
  }
}

export type RevokeBlobUrlResponse = { success: true } | ErrorResponse

export interface OffscreenControlMessage {
  type: "OFFSCREEN_CONTROL"
  payload: {
    taskId: string
    action: "cancel"
  }
}

export interface OffscreenJobAcceptedMessage {
  type: "OFFSCREEN_JOB_ACCEPTED"
  payload: OffscreenJobIdentity & { acceptedAt: number; sequence: number }
}

export interface OffscreenJobHeartbeatMessage {
  type: "OFFSCREEN_JOB_HEARTBEAT"
  payload: OffscreenJobIdentity & {
    stage: OffscreenJobStage
    sequence: number
    sentAt: number
  }
}

export interface OffscreenQueryJobMessage {
  type: "OFFSCREEN_QUERY_JOB"
  payload: { requestId: string }
}

export type OffscreenQueryJobResponse =
  | { success: true; requestId: string; job: OffscreenJobState | null }
  | ErrorResponse

export interface OffscreenCancelJobMessage {
  type: "OFFSCREEN_CANCEL_JOB"
  payload: OffscreenJobIdentity
}

export type OffscreenCancelJobResponse =
  | { success: true; canceled: boolean; jobId: string; attempt: number }
  | ErrorResponse

export interface OffscreenParseSeriesHtmlMessage {
  type: "OFFSCREEN_PARSE_SERIES_HTML"
  payload: {
    siteIntegrationId: string
    seriesUrl: string
    html: string
    language?: string
  }
}

export type OffscreenParseSeriesHtmlResponse =
  | {
      success: true
      seriesMetadata?: unknown
      chapterList?: unknown
      metadataError?: string
      chapterListError?: string
      chapterListNotice?: "adult-consent-required"
    }
  | ErrorResponse
