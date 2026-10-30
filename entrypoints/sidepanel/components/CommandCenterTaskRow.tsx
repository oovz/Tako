import { Button } from "@/components/ui/button"
import { openOptionsPage } from "@/src/runtime/open-options"
import { TaskDestinationCaption } from "@/src/ui/shared/TaskDestinationCaption"
import { memo } from "react"
import { useTaskRowProgressVisibility } from "./CommandCenterTaskRow-progress"
import { cn } from "@/src/shared/utils"

import type { ActiveTaskProgress as ActiveTaskProgressState } from "@/entrypoints/sidepanel/hooks/useActiveTaskProgress"
import { getDisplayName } from "@/src/site-integrations/catalog"
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
  type CommandCenterTaskActionHandler,
} from "@/entrypoints/sidepanel/components/command-center-queue-helpers"
import type { QueueTaskSummary } from "@/src/domain/queue/state"
import { t } from "@/src/runtime/i18n"
import { getDownloadCancelPresentation } from "@/src/runtime/download-error-presentation"
import { useI18n } from "@/src/ui/shared/hooks/useI18n"
import { CoverPreview } from "@/entrypoints/sidepanel/components/CoverPreview"

interface CommandCenterTaskRowProps {
  task: QueueTaskSummary
  isCanceling: boolean
  isRetrying: boolean
  isRestarting: boolean
  isRemoving: boolean
  isMoving: boolean
  isConfirmingCancel: boolean
  cancelError: string | null
  activeTaskProgress: ActiveTaskProgressState | null | undefined
  showActiveProgress: boolean
  isFirstQueuedTask?: boolean
  onBeginCancel: (taskId: string) => void
  onConfirmCancel: (taskId: string) => void
  onDismissCancel: () => void
  onCancelTask?: (taskId: string) => void
  onRetryFailed?: CommandCenterTaskActionHandler
  onRestartTask?: CommandCenterTaskActionHandler
  onMoveTaskToTop?: CommandCenterTaskActionHandler
  onRemoveTask?: CommandCenterTaskActionHandler
}

function getTaskRowActionModel({
  task,
  isCanceling,
  isFirstQueuedTask,
  onCancelTask,
  onRetryFailed,
  onRestartTask,
  onMoveTaskToTop,
  onRemoveTask,
}: Pick<
  CommandCenterTaskRowProps,
  | "task"
  | "isCanceling"
  | "isFirstQueuedTask"
  | "onCancelTask"
  | "onRetryFailed"
  | "onRestartTask"
  | "onMoveTaskToTop"
  | "onRemoveTask"
>) {
  const retry = getRetryAvailability(task, !!onRetryFailed)
  const availability = getTaskActionAvailability(task, {
    hasCancelHandler: !!onCancelTask,
    isCanceling,
    hasRestartHandler: !!onRestartTask,
    hasMoveToTopHandler: !!onMoveTaskToTop,
    hasRemoveHandler: !!onRemoveTask,
    isFirstQueuedTask,
  })
  return {
    ...availability,
    canRetryFailed: retry.canRetryFailed && !task.targetUnavailable,
    canRestart: availability.canRestart && !task.targetUnavailable,
  }
}

function TaskRowCover({ task }: Pick<CommandCenterTaskRowProps, "task">) {
  return (
    <div className="h-12 w-8 shrink-0 overflow-hidden rounded bg-muted shadow-sm border border-border/50 transition-transform duration-200 group-hover:scale-105">
      <CoverPreview
        identity={
          task.coverUrl
            ? {
                integrationId: task.siteIntegration,
                coverUrl: task.coverUrl,
                source: { kind: "task", taskId: task.id },
              }
            : undefined
        }
        alt=""
        className="object-cover"
      />
    </div>
  )
}

function TaskRowHeading({
  task,
  activeRowChapterCount,
}: {
  task: QueueTaskSummary
  activeRowChapterCount: number
}) {
  return (
    <>
      <div className="flex items-center gap-1.5">
        <h3 className="font-semibold text-sm truncate" title={task.seriesTitle}>
          {task.seriesTitle}
        </h3>
        <Badge
          variant="outline"
          className="text-[11px] h-4 px-1.5 py-0 font-normal shrink-0"
        >
          {getDisplayName(task.siteIntegration)}
        </Badge>
      </div>

      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          {getTaskStatusIcon(task.status)}
          <span className="capitalize">
            {getTaskStatusLabel(
              task.status,
              task.activeBlock,
              task.outputDestination,
              task.saveConfirmedAt
            )}
          </span>
        </span>
        <span>·</span>
        <span className="font-mono">
          {activeRowChapterCount}/{task.chapters.total}{" "}
          {t("common_chaptersShort")}
        </span>
      </div>
    </>
  )
}

function TaskRowDetails({ task }: Pick<CommandCenterTaskRowProps, "task">) {
  const failureMessage = getTaskFailureMessage(task)
  return (
    <>
      {task.status === "completed" && task.saveConfirmedAt === undefined && (
        <p className="text-[11px] text-muted-foreground">
          {t("output_saveUnconfirmedDescription")}
        </p>
      )}

      <TaskDestinationCaption
        useChromeFallback={task.useChromeFallback}
        destination={task.destination}
        requestedPath={task.requestedPath}
      />
      {/* Failure message */}
      {task.targetUnavailable && (
        <p className="text-xs">{t("taskFolder_originalUnavailable")}</p>
      )}
      {failureMessage && (
        <div className="text-[11px] text-destructive">{failureMessage}</div>
      )}

      {task.destination.kind === "file-system-access" &&
        task.folderAccessRequired === true && (
          <Button
            variant="link"
            size="sm"
            onClick={() => void openOptionsPage("activity")}
          >
            {t("taskFolder_openActions")}
          </Button>
        )}
    </>
  )
}

function TaskRowCancellation({
  task,
  isCanceling,
  cancelError,
  onConfirmCancel,
  onDismissCancel,
}: Pick<
  CommandCenterTaskRowProps,
  "task" | "isCanceling" | "cancelError" | "onConfirmCancel" | "onDismissCancel"
>) {
  const cancelPresentation = getDownloadCancelPresentation()
  return (
    <InlineConfirmation
      title={cancelPresentation.title}
      description={cancelPresentation.description}
      confirmLabel={cancelPresentation.confirmLabel}
      pendingLabel={t("sidepanel_cancelingDownload")}
      cancelLabel={t("common_no")}
      isPending={isCanceling}
      errorMessage={cancelError}
      onConfirm={() => {
        onConfirmCancel(task.id)
      }}
      onCancel={onDismissCancel}
    />
  )
}

function CommandCenterTaskRowView(props: CommandCenterTaskRowProps) {
  const {
    task,
    isCanceling,
    isRetrying,
    isRestarting,
    isRemoving,
    isMoving,
    isConfirmingCancel,
    cancelError,
    activeTaskProgress,
    showActiveProgress,
    onBeginCancel,
    onConfirmCancel,
    onDismissCancel,
    onRetryFailed,
    onRestartTask,
    onMoveTaskToTop,
    onRemoveTask,
  } = props
  useI18n()
  const actions = getTaskRowActionModel(props)
  const { showProgressInRow, activeRowChapterCount } =
    getTaskProgressPresentation(task, activeTaskProgress, showActiveProgress)
  const progressVisible = useTaskRowProgressVisibility(showProgressInRow)
  const isActive = task.status === "downloading"

  return (
    <>
      <div
        className={cn(
          "group relative flex items-center gap-2.5 px-3 py-2 border-b border-border/50",
          "transition-all duration-200 ease-out",
          "hover:bg-muted/30",
          isActive && "bg-muted/40 border-l-2 border-l-primary",
          (isRemoving || isCanceling) &&
            "opacity-0 -translate-x-2 scale-[0.98] pointer-events-none"
        )}
      >
        {isConfirmingCancel && (
          <TaskRowCancellation
            task={task}
            isCanceling={isCanceling}
            cancelError={cancelError}
            onConfirmCancel={onConfirmCancel}
            onDismissCancel={onDismissCancel}
          />
        )}

        <TaskRowCover task={task} />

        <div
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2.5 transition-opacity duration-150",
            actions.isTaskHistory && "opacity-70 group-hover:opacity-100"
          )}
        >
          {/* Content */}
          <div className="flex-1 min-w-0 flex flex-col gap-0.5">
            <TaskRowHeading
              task={task}
              activeRowChapterCount={activeRowChapterCount}
            />
            <TaskRowDetails task={task} />
          </div>

          <CommandCenterTaskActions
            taskId={task.id}
            status={task.status}
            outputUncertain={task.outputUncertain}
            isCanceling={isCanceling}
            isRetrying={isRetrying}
            isRestarting={isRestarting}
            isRemoving={isRemoving}
            isMoving={isMoving}
            canCancel={actions.canCancel}
            canRetryFailed={actions.canRetryFailed}
            canRestart={actions.canRestart}
            canMoveToTop={actions.canMoveToTop}
            canRemove={actions.canRemove}
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
}

export const CommandCenterTaskRow = memo(CommandCenterTaskRowView)
CommandCenterTaskRow.displayName = "CommandCenterTaskRow"
