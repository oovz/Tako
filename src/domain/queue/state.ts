import type {
  DownloadErrorCategory,
  DownloadTaskStatus,
} from "@/src/shared/download-contract"
import type { ChapterArchiveMetadata, ChapterStatus } from "@/src/types/chapter"
import type { TaskSettingsSnapshot } from "@/src/types/state-snapshots"

export const QUEUE_AGGREGATE_KEYS = [
  "queue",
  "lease",
  "pendingUndoActions",
] as const

export type QueueAggregateKey = (typeof QUEUE_AGGREGATE_KEYS)[number]

export type ActiveTaskBlock =
  "provider_network_policy_pending" | "provider_network_policy_action_required"

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
  fingerprint: string
  documentInstanceId?: string
  saveMode: "fsa" | "downloads-api"
  destinationHandleId?: string
  lastEventSignature?: string
  stage: OffscreenJobStage
  startedAt: number
  lastActivityAt: number
  leaseExpiresAt: number
  sequence: number
}

export type DispatchLeaseAuthority = DispatchLeaseIdentity &
  Pick<ActiveDispatchLease, "fingerprint" | "documentInstanceId">

export type FullDispatchLeaseIdentity = DispatchLeaseAuthority & {
  documentInstanceId: string
}

export type DispatchLeaseIdentity = Pick<
  ActiveDispatchLease,
  "jobId" | "attempt" | "taskId" | "chapterId"
>

export interface NativeOutputSettlement {
  jobId: string
  attempt: number
  taskId: string
  chapterId: string
  requested: number
  completed: number
  interrupted: number
  outputUncertain?: true
  errorMessage?: string
  errorCategory?: DownloadErrorCategory
  lastSuccessfulDownloadId?: number
  appliedAt: number
}

export interface TaskChapter extends ChapterArchiveMetadata {
  requestedPath: string | null
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
  outputDestination?: "downloads-api" | "fsa"
  saveConfirmedAt?: number
  nativeOutputSettlement?: NativeOutputSettlement
  dispatchAttempt?: number
  lastUpdated: number
}

export interface DownloadTaskState {
  fsaFallbackEligible?: true
  useChromeFallback?: true
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
  created: number
  started?: number
  completed?: number
  isRetried?: boolean
  isRetryTask?: boolean
  lastSuccessfulDownloadId?: number
  nextChapterDispatchAt?: number
  activeCancel?: {
    commandId: string
  }
  restoredUndo?: {
    token: string
    type: PendingUndoActionType
  }
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

export interface QueueAggregateState {
  queue: DownloadTaskState[]
  lease: ActiveDispatchLease | null
  pendingUndoActions: PendingUndoAction[]
}

export interface QueueTaskSummary {
  chapterRange?: string
  queueIndex?: number
  useChromeFallback?: true
  id: string
  seriesKey: string
  seriesTitle: string
  siteIntegration: string
  coverUrl?: string
  status: DownloadTaskStatus
  outputDestination?: "downloads-api" | "fsa"
  saveConfirmedAt?: number
  destination: TaskSettingsSnapshot["destination"]
  requestedPath?: string | null
  targetUnavailable?: true
  outputMode?: "downloads-api" | "fsa"
  activeBlock?: ActiveTaskBlock
  chapters: {
    total: number
    completed: number
    unsuccessful: number
  }
  timestamps: {
    created: number
    started?: number
    completed?: number
  }
  outputUncertain?: boolean
  failureCategory?: DownloadErrorCategory
  folderAccessRequired?: true
  isRetried?: boolean
  isRetryTask?: boolean
  lastSuccessfulDownloadId?: number
}
