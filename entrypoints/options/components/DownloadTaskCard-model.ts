import type { DownloadTaskActionResult } from "@/entrypoints/options/types/download-task-actions"
import type { DownloadTaskState, TaskChapter } from "@/src/domain/queue/state"
import { getEffectiveTaskDestination } from "@/src/domain/queue/task-destination"
import { firstUnsuccessfulChapter } from "@/src/domain/queue/task-lifecycle"
import { getDownloadFailureMessage } from "@/src/runtime/download-error-presentation"
import { hasUncertainNativeOutput } from "@/src/runtime/output-result-presentation"
import { t } from "@/src/runtime/i18n"

export interface DownloadTaskCardProps {
  task: DownloadTaskState
  isChapterListExpanded?: boolean
  onChapterListExpandedChange?: (expanded: boolean) => void
  onCancel: (taskId: string) => Promise<DownloadTaskActionResult>
  onRetry: (taskId: string) => Promise<void>
  onRestart: (taskId: string) => Promise<void>
  onRemove: (taskId: string) => Promise<void>
}

export type TaskCardAction = "retry" | "restart" | "remove" | "grant"
export interface TaskCardRecoveryAction {
  action: "retry" | "restart" | "remove"
  label: string
}

function isTargetUnavailable(
  task: DownloadTaskState,
  destination: ReturnType<typeof getEffectiveTaskDestination>
): boolean {
  return (
    task.chapters.some((chapter) => chapter.requestedPath === null) ||
    (destination.kind === "file-system-access" && destination.handleId === null)
  )
}

function hasPermissionFailure(task: DownloadTaskState): boolean {
  return (
    (task.status === "failed" || task.status === "partial_success") &&
    task.chapters.some(
      (chapter) => chapter.errorCategory === "folder_permission_required"
    )
  )
}

function failureCategory(
  task: DownloadTaskState,
  chapter: TaskChapter | undefined
) {
  if (task.status === "completed") return undefined
  return chapter ? (chapter.errorCategory ?? "unknown") : task.errorCategory
}

function recoveryLabels(outputUncertain: boolean) {
  const restart: TaskCardRecoveryAction = {
    action: "restart",
    label: t(
      outputUncertain
        ? "sidepanel_restartUncertainHandoff"
        : "sidepanel_restartTask"
    ),
  }
  const remove: TaskCardRecoveryAction = {
    action: "remove",
    label: t("common_remove"),
  }
  const retry: TaskCardRecoveryAction = {
    action: "retry",
    label: t(
      outputUncertain
        ? "sidepanel_retryUncertainHandoff"
        : "sidepanel_retryFailedChapters"
    ),
  }
  return { restart, remove, retry }
}

function partialRecoveryActions(
  task: DownloadTaskState,
  targetUnavailable: boolean,
  labels: ReturnType<typeof recoveryLabels>
): TaskCardRecoveryAction[] {
  if (task.isRetried) return []
  if (targetUnavailable) return [labels.remove]
  return [labels.retry, labels.restart, labels.remove]
}

function recoveryActions(
  task: DownloadTaskState,
  targetUnavailable: boolean,
  outputUncertain: boolean
): TaskCardRecoveryAction[] {
  const labels = recoveryLabels(outputUncertain)
  const { restart, remove } = labels
  const canRecover = !task.isRetried && !targetUnavailable
  switch (task.status) {
    case "completed":
      return [remove]
    case "failed":
    case "canceled":
      return canRecover ? [restart, remove] : [remove]
    case "partial_success":
      return partialRecoveryActions(task, targetUnavailable, labels)
    default:
      return []
  }
}

/** Decisions shared by the card's destination, failure and recovery controls. */
export function getTaskCardModel(task: DownloadTaskState) {
  const destination = getEffectiveTaskDestination(task)
  const targetUnavailable = isTargetUnavailable(task, destination)
  const failureChapter = firstUnsuccessfulChapter(task.chapters)
  const outputUncertain = hasUncertainNativeOutput(task.chapters)
  const destinationChapter =
    failureChapter ??
    task.chapters.find((chapter) => chapter.status === "queued") ??
    task.chapters[0]
  return {
    destination,
    requestedPath: destinationChapter?.requestedPath,
    targetUnavailable,
    failureMessage: getDownloadFailureMessage(
      failureCategory(task, failureChapter),
      outputUncertain
    ),
    permissionFailure:
      destination.kind === "file-system-access" &&
      !targetUnavailable &&
      hasPermissionFailure(task),
    saveUnconfirmed: task.chapters.some(
      (chapter) =>
        chapter.status === "completed" && chapter.saveConfirmedAt === undefined
    ),
    recoveryActions: recoveryActions(task, targetUnavailable, outputUncertain),
  }
}

export type TaskCardModel = ReturnType<typeof getTaskCardModel>
