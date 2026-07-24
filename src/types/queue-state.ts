import type { ExtensionSettings } from "@/src/storage/settings-types"
import type {
  DownloadErrorCategory,
  DownloadTaskStatus,
} from "@/src/shared/download-contract"
import type { ChapterStatus } from "@/src/types/chapter"
import type { TaskSettingsSnapshot } from "@/src/types/state-snapshots"

export type DestinationIssueKind =
  | "fsa_permission_required"
  | "fsa_folder_missing"
  | "fsa_write_failed"
  | "fsa_unsupported"
  | "disk_full"

export interface DestinationIssue {
  id: string
  taskId: string
  chapterId?: string
  kind: DestinationIssueKind
  occurredAt: number
  acknowledgedAt?: number
}

export type ActiveTaskBlock = "destination_action_required"

export type OffscreenJobStage =
  | "dispatching"
  | "accepted"
  | "resolving"
  | "downloading"
  | "transforming"
  | "archiving"
  | "saving"

export interface OutputAccounting {
  requested: number
  committed: number
  failed: number
}

export interface ActiveDispatchLease {
  jobId: string
  taskId: string
  chapterId: string
  attempt: number
  stage: OffscreenJobStage
  startedAt: number
  lastActivityAt: number
  leaseExpiresAt: number
  sequence: number
}

export interface PendingOutputRecord {
  outputId: string
  jobId: string
  attempt: number
  taskId: string
  chapterId: string
  downloadId?: number
  blobUrl: string
  filename: string
  outputIndex: number
  outputCount: number
  outputKind: "archive" | "image"
  state: "prepared" | "in_progress" | "complete" | "interrupted"
  createdAt: number
  terminalAt?: number
  blobRevokedAt?: number
  accountedAt?: number
  error?: string
}

export interface TaskChapter {
  id: string
  url: string
  title: string
  locked?: boolean
  index: number
  language?: string
  chapterLabel?: string
  chapterNumber?: number
  volumeId?: string
  volumeNumber?: number
  volumeLabel?: string
  status: ChapterStatus
  errorMessage?: string
  errorCategory?: DownloadErrorCategory
  totalImages?: number
  imagesFailed?: number
  outputs?: OutputAccounting
  dispatchAttempt?: number
  lastUpdated: number
}

export interface DownloadTaskState {
  id: string
  siteIntegrationId: string
  mangaId: string
  seriesTitle: string
  seriesCoverUrl?: string
  chapters: TaskChapter[]
  status: DownloadTaskStatus
  errorMessage?: string
  errorCategory?: DownloadErrorCategory
  activeBlock?: ActiveTaskBlock
  destinationOverride?: "downloads-api"
  created: number
  started?: number
  completed?: number
  isRetried?: boolean
  isRetryTask?: boolean
  lastSuccessfulDownloadId?: number
  nextChapterDispatchAt?: number
  settingsSnapshot: TaskSettingsSnapshot
}

export type PendingUndoActionType = "cancel_queued" | "remove_history"

export interface PendingUndoAction {
  token: string
  type: PendingUndoActionType
  taskSnapshot: DownloadTaskState
  previousQueuePosition: number
  createdAt: number
  expiresAt: number
}

export type PendingUndoReceipt = Pick<
  PendingUndoAction,
  "token" | "type" | "expiresAt"
>

export interface QueueTaskSummary {
  id: string
  seriesKey: string
  seriesTitle: string
  siteIntegration: string
  coverUrl?: string
  status: DownloadTaskStatus
  chapters: {
    total: number
    completed: number
    unsuccessful: number
  }
  timestamps: {
    created: number
    completed?: number
  }
  failureCategory?: DownloadErrorCategory
  isRetried?: boolean
  isRetryTask?: boolean
  lastSuccessfulDownloadId?: number
}

export interface GlobalAppState {
  downloadQueue: DownloadTaskState[]
  settings: ExtensionSettings
  lastActivity: number
}
