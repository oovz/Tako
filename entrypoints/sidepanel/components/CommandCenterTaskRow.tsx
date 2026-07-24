import { memo, useEffect, useRef, useState } from "react"
import { cn } from "@/src/shared/utils"

import type { ActiveTaskProgress as ActiveTaskProgressState } from "@/entrypoints/sidepanel/hooks/useActiveTaskProgress"
import { getSiteIntegrationDisplayName } from "@/src/site-integrations/manifest"
import { Badge } from "@/components/ui/badge"
import { ActiveTaskProgress } from "@/entrypoints/sidepanel/components/ActiveTaskProgress"
import { CommandCenterTaskActions } from "@/entrypoints/sidepanel/components/CommandCenterTaskActions"
import { InlineConfirmation } from "@/src/ui/shared/components/InlineConfirmation"
import {
  getRetryAvailability,
  getTaskActionAvailability,
  getTaskFailureMessage,
  getTaskProgressPresentation,
  getTaskStatusIcon,
  getTaskStatusLabel,
} from "@/entrypoints/sidepanel/components/command-center-queue-helpers"
import type { QueueTaskSummary } from "@/src/types/queue-state"
import { t } from "@/src/runtime/i18n"
import { useI18n } from "@/src/ui/shared/hooks/useI18n"

interface CommandCenterTaskRowProps {
  task: QueueTaskSummary
  isCanceling: boolean
  isRetrying: boolean
  isRestarting: boolean
  isRemoving: boolean
  isMoving: boolean
  isConfirmingCancel: boolean
  cancelError: string | null
  coverFailed: boolean
  activeTaskProgress: ActiveTaskProgressState | null | undefined
  showActiveProgress: boolean
  isFirstQueuedTask?: boolean
  onBeginCancel: (taskId: string) => void
  onConfirmCancel: (taskId: string) => void
  onDismissCancel: () => void
  onCoverError: (taskId: string) => void
  onCancelTask?: (taskId: string) => void
  onRetryFailed?: (taskId: string) => void
  onRestartTask?: (taskId: string) => void
  onMoveTaskToTop?: (taskId: string) => void
  onRemoveTask?: (taskId: string) => void
}

export const CommandCenterTaskRow = memo(function CommandCenterTaskRow({
  task,
  isCanceling,
  isRetrying,
  isRestarting,
  isRemoving,
  isMoving,
  isConfirmingCancel,
  cancelError,
  coverFailed,
  activeTaskProgress,
  showActiveProgress,
  isFirstQueuedTask = false,
  onBeginCancel,
  onConfirmCancel,
  onDismissCancel,
  onCoverError,
  onCancelTask,
  onRetryFailed,
  onRestartTask,
  onMoveTaskToTop,
  onRemoveTask,
}: CommandCenterTaskRowProps) {
  useI18n()
  const totalChapters = task.chapters.total
  const { canRetryFailed, retryBlockedMessage } = getRetryAvailability(
    task,
    !!onRetryFailed
  )
  const { canCancel, isTaskHistory, canRestart, canMoveToTop, canRemove } =
    getTaskActionAvailability(task, {
      hasCancelHandler: !!onCancelTask,
      isCanceling,
      hasRestartHandler: !!onRestartTask,
      hasMoveToTopHandler: !!onMoveTaskToTop,
      hasRemoveHandler: !!onRemoveTask,
      isFirstQueuedTask,
    })

  const isActive = task.status === "downloading"
  const { showProgressInRow, activeRowChapterCount } =
    getTaskProgressPresentation(task, activeTaskProgress, showActiveProgress)

  // Spec: "Per-image progress bar MUST remain visible for at least 500ms to
  // prevent flickering on fast downloads." Track when progress first becomes
  // visible and delay hiding until the minimum visibility window has elapsed.
  const progressVisibleSinceRef = useRef<number | null>(null)
  const [progressVisible, setProgressVisible] = useState(false)
  useEffect(() => {
    if (showProgressInRow) {
      if (progressVisibleSinceRef.current === null) {
        progressVisibleSinceRef.current = Date.now()
      }
      setProgressVisible(true)
      return
    }
    // showProgressInRow is false — check minimum visibility before hiding
    const visibleSince = progressVisibleSinceRef.current
    if (visibleSince === null) {
      setProgressVisible(false)
      return
    }
    const elapsed = Date.now() - visibleSince
    const remaining = 500 - elapsed
    if (remaining <= 0) {
      progressVisibleSinceRef.current = null
      setProgressVisible(false)
    } else {
      const timer = setTimeout(() => {
        progressVisibleSinceRef.current = null
        setProgressVisible(false)
      }, remaining)
      return () => clearTimeout(timer)
    }
  }, [showProgressInRow])

  const failureMessage = getTaskFailureMessage(task)
  const fallbackCoverUrl = chrome.runtime.getURL("icon/128.png")
  const coverSrc =
    task.coverUrl && !coverFailed ? task.coverUrl : fallbackCoverUrl

  const icon = getTaskStatusIcon(task.status)

  return (
    <>
      {/* Task Row - Reference UX style with hover-reveal actions */}
      <div
        className={cn(
          "group relative flex items-center gap-2.5 px-3 py-2 border-b border-border/50",
          "transition-colors duration-100",
          "hover:bg-muted/30",
          isActive && "bg-muted/40 border-l-2 border-l-primary"
        )}
      >
        {isConfirmingCancel && (
          <InlineConfirmation
            title={t("sidepanel_cancelThisDownload")}
            description={t("sidepanel_cancelProgressWarning")}
            confirmLabel={t("common_yes")}
            pendingLabel={t("sidepanel_cancelingDownload")}
            cancelLabel={t("common_no")}
            isPending={isCanceling}
            errorMessage={cancelError}
            onConfirm={() => {
              onConfirmCancel(task.id)
            }}
            onCancel={onDismissCancel}
          />
        )}

        {/* Thumbnail */}
        <div className="h-12 w-8 shrink-0 overflow-hidden rounded bg-muted shadow-sm border border-border/50">
          <img
            src={coverSrc}
            alt=""
            className="h-full w-full object-cover"
            onError={() => {
              if (!task.coverUrl || coverFailed) {
                return
              }

              onCoverError(task.id)
            }}
            draggable={false}
          />
        </div>

        <div
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2.5 transition-opacity duration-150",
            isTaskHistory && "opacity-70 group-hover:opacity-100"
          )}
        >
          {/* Content */}
          <div className="flex-1 min-w-0 flex flex-col gap-0.5">
            <div className="flex items-center gap-1.5">
              <h3
                className="font-semibold text-sm truncate"
                title={task.seriesTitle}
              >
                {task.seriesTitle}
              </h3>
              <Badge
                variant="outline"
                className="text-[11px] h-4 px-1.5 py-0 font-normal shrink-0"
              >
                {getSiteIntegrationDisplayName(task.siteIntegration)}
              </Badge>
            </div>

            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                {icon}
                <span className="capitalize">
                  {getTaskStatusLabel(task.status)}
                </span>
              </span>
              <span>·</span>
              <span className="font-mono">
                {activeRowChapterCount}/{totalChapters}{" "}
                {t("common_chaptersShort")}
              </span>
            </div>

            {/* Failure message */}
            {failureMessage && (
              <div className="text-[11px] text-destructive truncate">
                {failureMessage}
              </div>
            )}

            {/* Retry blocked message for failed tasks */}
            {retryBlockedMessage && (
              <div className="text-[11px] text-muted-foreground">
                {retryBlockedMessage}
              </div>
            )}
          </div>

          <CommandCenterTaskActions
            taskId={task.id}
            status={task.status}
            isCanceling={isCanceling}
            isRetrying={isRetrying}
            isRestarting={isRestarting}
            isRemoving={isRemoving}
            isMoving={isMoving}
            canCancel={canCancel}
            canRetryFailed={canRetryFailed}
            canRestart={canRestart}
            canMoveToTop={canMoveToTop}
            canRemove={canRemove}
            onBeginCancel={onBeginCancel}
            onRetryFailed={onRetryFailed}
            onRestartTask={onRestartTask}
            onMoveTaskToTop={onMoveTaskToTop}
            onRemoveTask={onRemoveTask}
          />
        </div>
      </div>

      {progressVisible && (
        <div className="border-b border-border/50">
          <ActiveTaskProgress
            task={task}
            progress={activeTaskProgress ?? null}
          />
        </div>
      )}
    </>
  )
})
