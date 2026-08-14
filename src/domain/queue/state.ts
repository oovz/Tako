import type {
  DownloadErrorCategory,
  DownloadTaskStatus,
} from "@/src/shared/download-contract"
import type { ChapterStatus } from "@/src/types/chapter"
import type { TaskSettingsSnapshot } from "@/src/types/state-snapshots"

export const QUEUE_AGGREGATE_KEYS = [
  "queue",
  "lease",
  "pendingUndoActions",
] as const

export type QueueAggregateKey = (typeof QUEUE_AGGREGATE_KEYS)[number]

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

export type ActiveTaskBlock =
  | "destination_action_required"
  | "provider_network_policy_pending"
  | "provider_network_policy_action_required"
  | "native_output_action_required"

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
  /** Outputs whose Chrome download history entry was erased and the user surrendered observation of. */
  surrendered: number
  lastSuccessfulDownloadId?: number
  appliedAt: number
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
  nativeOutputSettlement?: NativeOutputSettlement
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
  destinationBlockRevision?: number
  destinationResume?: {
    commandId: string
    blockRevision: number
  }
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
  id: string
  seriesKey: string
  seriesTitle: string
  siteIntegration: string
  coverUrl?: string
  status: DownloadTaskStatus
  activeBlock?: ActiveTaskBlock
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
  /** True when any chapter has a native output whose result is unobservable. */
  hasUnobservableOutput?: boolean
  isRetried?: boolean
  isRetryTask?: boolean
  lastSuccessfulDownloadId?: number
}
