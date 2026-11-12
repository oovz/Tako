import { createElement, type ReactNode } from "react"

import { CheckCircle2, Clock, Loader2, XCircle } from "lucide-react"

import type { ActiveTaskProgress as ActiveTaskProgressState } from "@/entrypoints/sidepanel/hooks/useActiveTaskProgress"
import type { QueueTaskSummary } from "@/src/domain/queue/state"
import { getOutputResultLabel } from "@/src/runtime/output-result-presentation"
import { t } from "@/src/runtime/i18n"

export interface CommandCenterTaskActionAvailability {
  canCancel: boolean
  isTaskHistory: boolean
  isRetried: boolean
  canRestart: boolean
  canMoveToTop: boolean
  canRemove: boolean
}

export type CommandCenterTaskActionId =
  "cancel" | "retry-failed" | "restart" | "move-to-top" | "remove"

export type CommandCenterTaskActionHandler = (
  taskId: string
) => void | Promise<void>

export interface CommandCenterTaskActionPlan {
  inline: CommandCenterTaskActionId[]
  overflow: CommandCenterTaskActionId[]
}

export interface CommandCenterTaskProgressPresentation {
  showProgressInRow: boolean
  activeRowChapterCount: number
}

export function shouldConfirmTaskCancellation(
  task: Pick<QueueTaskSummary, "status" | "activeBlock">
): boolean {
  return task.status === "downloading"
}

export function getRetryAvailability(
  task: QueueTaskSummary,
  hasRetryHandler: boolean
): { canRetryFailed: boolean; retryBlockedMessage: string | null } {
  const isRetryableStatus = task.status === "partial_success"
  const isRetried = task.isRetried === true

  if (
    !isRetryableStatus ||
    task.chapters.unsuccessful === 0 ||
    !hasRetryHandler ||
    isRetried
  ) {
    return { canRetryFailed: false, retryBlockedMessage: null }
  }

  return { canRetryFailed: true, retryBlockedMessage: null }
}

const STATUS_LABEL_KEYS = {
  downloading: "status_downloading",
  queued: "status_queued",
  partial_success: "status_partialSuccess",
  failed: "status_failed",
  canceled: "status_canceled",
}

export function getTaskStatusLabel(
  status: QueueTaskSummary["status"],
  activeBlock?: QueueTaskSummary["activeBlock"],
  outputDestination?: QueueTaskSummary["outputDestination"],
  saveConfirmedAt?: number
): string {
  if (activeBlock === "provider_network_policy_pending")
    return t("status_waitingProviderPolicy")
  if (activeBlock === "provider_network_policy_action_required")
    return t("status_providerActionRequired")
  if (status === "completed")
    return getOutputResultLabel(outputDestination, saveConfirmedAt)
  const key = STATUS_LABEL_KEYS[status]
  return key ? t(key) : status
}

const STATUS_ICONS = {
  downloading: { Icon: Loader2, className: "h-2.5 w-2.5 animate-spin" },
  queued: { Icon: Clock, className: "h-2.5 w-2.5" },
  completed: { Icon: CheckCircle2, className: "h-2.5 w-2.5 text-emerald-600" },
  partial_success: {
    Icon: CheckCircle2,
    className: "h-2.5 w-2.5 text-amber-600",
  },
  failed: { Icon: XCircle, className: "h-2.5 w-2.5 text-destructive" },
  canceled: { Icon: XCircle, className: "h-2.5 w-2.5 text-muted-foreground" },
}

export function getTaskStatusIcon(
  status: QueueTaskSummary["status"]
): ReactNode {
  const presentation = STATUS_ICONS[status]
  return presentation
    ? createElement(presentation.Icon, { className: presentation.className })
    : null
}

const HISTORY_STATUSES = new Set<QueueTaskSummary["status"]>([
  "completed",
  "partial_success",
  "failed",
  "canceled",
])
const RESTARTABLE_STATUSES = new Set<QueueTaskSummary["status"]>([
  "partial_success",
  "failed",
  "canceled",
])
const CANCELABLE_STATUSES = new Set<QueueTaskSummary["status"]>([
  "downloading",
  "queued",
])

export function getTaskActionAvailability(
  task: QueueTaskSummary,
  options: {
    hasCancelHandler: boolean
    isCanceling: boolean
    hasRestartHandler: boolean
    hasMoveToTopHandler: boolean
    hasRemoveHandler: boolean
    isFirstQueuedTask?: boolean
  }
): CommandCenterTaskActionAvailability {
  const isTaskHistory = HISTORY_STATUSES.has(task.status)
  const isRetried = task.isRetried === true

  return {
    canCancel: CANCELABLE_STATUSES.has(task.status) && options.hasCancelHandler,
    isTaskHistory,
    isRetried,
    canRestart:
      options.hasRestartHandler &&
      !isRetried &&
      RESTARTABLE_STATUSES.has(task.status),
    canMoveToTop:
      options.hasMoveToTopHandler &&
      task.status === "queued" &&
      options.isFirstQueuedTask !== true,
    canRemove: isTaskHistory && options.hasRemoveHandler,
  }
}

type TaskActionPlanAvailability = Pick<
  CommandCenterTaskActionAvailability,
  "canCancel" | "canRestart" | "canMoveToTop" | "canRemove"
> & { canRetryFailed: boolean }

const ACTION_AVAILABILITY = {
  cancel: "canCancel",
  "retry-failed": "canRetryFailed",
  restart: "canRestart",
  "move-to-top": "canMoveToTop",
  remove: "canRemove",
} as const satisfies Record<
  CommandCenterTaskActionId,
  keyof TaskActionPlanAvailability
>

const ACTION_LAYOUTS: Record<
  Exclude<QueueTaskSummary["status"], "partial_success">,
  CommandCenterTaskActionPlan
> = {
  downloading: { inline: ["cancel"], overflow: [] },
  queued: { inline: ["move-to-top", "cancel"], overflow: [] },
  failed: { inline: ["restart", "remove"], overflow: [] },
  canceled: { inline: ["restart", "remove"], overflow: [] },
  completed: { inline: ["remove"], overflow: [] },
}

function getPartialSuccessActionLayout(
  canRetryFailed: boolean
): CommandCenterTaskActionPlan {
  return canRetryFailed
    ? { inline: ["retry-failed", "remove"], overflow: ["restart"] }
    : { inline: ["restart", "remove"], overflow: [] }
}

export function getTaskActionPlan(
  status: QueueTaskSummary["status"],
  availability: TaskActionPlanAvailability
): CommandCenterTaskActionPlan {
  const layout =
    status === "partial_success"
      ? getPartialSuccessActionLayout(availability.canRetryFailed)
      : ACTION_LAYOUTS[status]
  const available = (action: CommandCenterTaskActionId) =>
    availability[ACTION_AVAILABILITY[action]]
  return {
    inline: layout.inline.filter(available),
    overflow: layout.overflow.filter(available),
  }
}

function getInFlightChapterCount(progress: ActiveTaskProgressState): number {
  return Math.max(
    1,
    progress.activeChapterCount ?? progress.activeChapters?.length ?? 1
  )
}

export function getTaskProgressPresentation(
  task: QueueTaskSummary,
  activeTaskProgress: ActiveTaskProgressState | null | undefined,
  showActiveProgress: boolean
): CommandCenterTaskProgressPresentation {
  if (task.status !== "downloading") {
    return {
      showProgressInRow: false,
      activeRowChapterCount: task.chapters.completed,
    }
  }
  const currentProgress =
    showActiveProgress && activeTaskProgress?.taskId === task.id
      ? activeTaskProgress
      : null
  const inFlightChapterCount = currentProgress
    ? getInFlightChapterCount(currentProgress)
    : 0
  return {
    showProgressInRow: !!currentProgress,
    activeRowChapterCount: Math.min(
      task.chapters.total,
      task.chapters.completed + inFlightChapterCount
    ),
  }
}
