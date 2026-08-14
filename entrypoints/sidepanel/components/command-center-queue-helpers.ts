import { createElement, type ReactNode } from "react"

import { CheckCircle2, Clock, Loader2, XCircle } from "lucide-react"

import type { ActiveTaskProgress as ActiveTaskProgressState } from "@/entrypoints/sidepanel/hooks/useActiveTaskProgress"
import type { QueueTaskSummary } from "@/src/domain/queue/state"
import { t } from "@/src/runtime/i18n"
import { getDownloadErrorMessage } from "@/src/runtime/download-error-presentation"

export interface CommandCenterTaskActionAvailability {
  canCancel: boolean
  canForgetUnobservable: boolean
  isTaskHistory: boolean
  isRetried: boolean
  canRestart: boolean
  canMoveToTop: boolean
  canRemove: boolean
}

export type CommandCenterTaskActionId =
  | "cancel"
  | "forget-unobservable"
  | "retry-failed"
  | "restart"
  | "move-to-top"
  | "remove"

export interface CommandCenterTaskActionPlan {
  primary: CommandCenterTaskActionId | null
  overflow: CommandCenterTaskActionId[]
}

export interface CommandCenterTaskProgressPresentation {
  showProgressInRow: boolean
  activeRowChapterCount: number
}

export function shouldConfirmTaskCancellation(
  task: Pick<QueueTaskSummary, "status" | "activeBlock">
): boolean {
  return (
    task.status === "downloading" ||
    task.activeBlock === "native_output_action_required"
  )
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

export function getTaskStatusLabel(
  status: QueueTaskSummary["status"],
  activeBlock?: QueueTaskSummary["activeBlock"]
): string {
  if (activeBlock === "destination_action_required") {
    return t("status_destinationActionRequired")
  }
  if (activeBlock === "provider_network_policy_pending") {
    return t("status_waitingProviderPolicy")
  }
  if (activeBlock === "provider_network_policy_action_required") {
    return t("status_providerActionRequired")
  }
  if (activeBlock === "native_output_action_required") {
    return t("status_nativeOutputActionRequired")
  }

  switch (status) {
    case "downloading":
      return t("status_downloading")
    case "queued":
      return t("status_queued")
    case "completed":
      return t("status_completed")
    case "partial_success":
      return t("status_partialSuccess")
    case "failed":
      return t("status_failed")
    case "canceled":
      return t("status_canceled")
    default:
      return status
  }
}

export function getTaskStatusIcon(
  status: QueueTaskSummary["status"]
): ReactNode {
  switch (status) {
    case "downloading":
      return createElement(Loader2, { className: "h-2.5 w-2.5 animate-spin" })
    case "queued":
      return createElement(Clock, { className: "h-2.5 w-2.5" })
    case "completed":
      return createElement(CheckCircle2, {
        className: "h-2.5 w-2.5 text-emerald-600",
      })
    case "partial_success":
      return createElement(CheckCircle2, {
        className: "h-2.5 w-2.5 text-amber-600",
      })
    case "failed":
      return createElement(XCircle, {
        className: "h-2.5 w-2.5 text-destructive",
      })
    case "canceled":
      return createElement(XCircle, {
        className: "h-2.5 w-2.5 text-muted-foreground",
      })
    default:
      return null
  }
}

export function getTaskActionAvailability(
  task: QueueTaskSummary,
  options: {
    hasCancelHandler: boolean
    hasForgetUnobservableHandler?: boolean
    isCanceling: boolean
    hasRestartHandler: boolean
    hasMoveToTopHandler: boolean
    hasRemoveHandler: boolean
    isFirstQueuedTask?: boolean
  }
): CommandCenterTaskActionAvailability {
  const isTaskHistory =
    task.status === "completed" ||
    task.status === "partial_success" ||
    task.status === "failed" ||
    task.status === "canceled"
  const isRetried = task.isRetried === true
  const isUnobservableActionRequired =
    task.status === "queued" &&
    task.activeBlock === "native_output_action_required" &&
    task.hasUnobservableOutput === true

  return {
    canCancel:
      (task.status === "downloading" || task.status === "queued") &&
      options.hasCancelHandler,
    canForgetUnobservable:
      isUnobservableActionRequired &&
      (options.hasForgetUnobservableHandler ?? false),
    isTaskHistory,
    isRetried,
    canRestart:
      options.hasRestartHandler &&
      !isRetried &&
      (task.status === "partial_success" ||
        task.status === "failed" ||
        task.status === "canceled"),
    canMoveToTop:
      options.hasMoveToTopHandler &&
      task.status === "queued" &&
      options.isFirstQueuedTask !== true,
    canRemove: isTaskHistory && options.hasRemoveHandler,
  }
}

export function getTaskActionPlan(
  status: QueueTaskSummary["status"],
  availability: Pick<
    CommandCenterTaskActionAvailability,
    | "canCancel"
    | "canForgetUnobservable"
    | "canRestart"
    | "canMoveToTop"
    | "canRemove"
  > & { canRetryFailed: boolean }
): CommandCenterTaskActionPlan {
  if (status === "downloading") {
    return {
      primary: availability.canCancel ? "cancel" : null,
      overflow: [],
    }
  }

  if (status === "queued") {
    if (availability.canForgetUnobservable) {
      return {
        primary: "forget-unobservable",
        overflow: availability.canCancel ? ["cancel"] : [],
      }
    }
    return {
      primary: availability.canMoveToTop ? "move-to-top" : null,
      overflow: availability.canCancel ? ["cancel"] : [],
    }
  }

  if (status === "partial_success") {
    return {
      primary: availability.canRetryFailed
        ? "retry-failed"
        : availability.canRestart
          ? "restart"
          : null,
      overflow: [
        ...(availability.canRetryFailed && availability.canRestart
          ? (["restart"] as const)
          : []),
        ...(availability.canRemove ? (["remove"] as const) : []),
      ],
    }
  }

  if (status === "failed" || status === "canceled") {
    return {
      primary: availability.canRestart ? "restart" : null,
      overflow: availability.canRemove ? ["remove"] : [],
    }
  }

  return {
    primary: null,
    overflow: availability.canRemove ? ["remove"] : [],
  }
}

export function getTaskProgressPresentation(
  task: QueueTaskSummary,
  activeTaskProgress: ActiveTaskProgressState | null | undefined,
  showActiveProgress: boolean
): CommandCenterTaskProgressPresentation {
  const showProgressInRow =
    task.status === "downloading" &&
    showActiveProgress &&
    !!activeTaskProgress &&
    activeTaskProgress.taskId === task.id
  const inFlightChapterCount = showProgressInRow
    ? Math.max(
        1,
        activeTaskProgress?.activeChapterCount ??
          activeTaskProgress?.activeChapters?.length ??
          1
      )
    : 0

  return {
    showProgressInRow,
    activeRowChapterCount:
      task.status === "downloading"
        ? Math.min(
            task.chapters.total,
            task.chapters.completed + inFlightChapterCount
          )
        : task.chapters.completed,
  }
}

export function getTaskFailureMessage(
  task: QueueTaskSummary
): string | undefined {
  return task.failureCategory
    ? getDownloadErrorMessage(task.failureCategory)
    : undefined
}
