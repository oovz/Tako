import { memo, useEffect, useId, useRef, useState } from "react"
import { X } from "lucide-react"
import { PanelIcon } from "./PanelIcon"
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible"
import { InlineConfirmation } from "@/src/ui/shared/components/InlineConfirmation"
import { openOptionsPage } from "@/src/runtime/open-options"
import { TaskDestinationCaption } from "@/src/ui/shared/TaskDestinationCaption"
import { getDisplayName } from "@/src/site-integrations/catalog"
import { t } from "@/src/runtime/i18n"
import { getOutputResultLabel } from "@/src/runtime/output-result-presentation"
import { useI18n } from "@/src/ui/shared/hooks/useI18n"
import type { ActiveTaskProgress as ActiveTaskProgressState } from "../hooks/useActiveTaskProgress"
import type { QueueTaskSummary } from "@/src/domain/queue/state"
import { useTaskDetails } from "../hooks/useTaskDetails"
import {
  getProgressNumbers,
  getProgressChapterContext,
  getProgressStageCaption,
} from "./ActiveTaskProgress-model"
import { CommandCenterTaskActions } from "./CommandCenterTaskActions"
import { CoverPreview } from "./CoverPreview"
import {
  getRetryAvailability,
  getTaskActionAvailability,
  getTaskFailureMessage,
  getTaskStatusLabel,
  type CommandCenterTaskActionHandler,
} from "./command-center-queue-helpers"

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
  queuePosition?: number
  queuedCount?: number
  onReorder?: (taskId: string, position: number) => void | Promise<void>
}

function CommandCenterTaskRowView(props: CommandCenterTaskRowProps) {
  useI18n()
  const { task, activeTaskProgress } = props
  const [expanded, setExpanded] = useState(false)
  const [ordering, setOrdering] = useState(false)
  const [position, setPosition] = useState(String(props.queuePosition ?? 1))
  const [recovery, setRecovery] = useState<"retry" | "restart" | null>(null)
  const id = useId()
  const cancelButton = useRef<HTMLButtonElement>(null)
  const reorderButton = useRef<HTMLButtonElement>(null)
  const keepButton = useRef<HTMLButtonElement>(null)
  const active = task.status === "downloading"
  const queued = task.status === "queued"
  const details = useTaskDetails(task.id, expanded || active)
  const cancelPending = props.isCanceling || Boolean(details.task?.activeCancel)
  const progress =
    props.showActiveProgress && activeTaskProgress?.taskId === task.id
      ? activeTaskProgress
      : null
  const numbers = getProgressNumbers(task, progress)
  const calculated = Math.floor(numbers.progressValue)
  const [displayProgress, setDisplayProgress] = useState({
    id: task.id,
    percent: calculated,
  })
  const percent =
    displayProgress.id === task.id
      ? Math.max(displayProgress.percent, calculated)
      : calculated
  if (displayProgress.id !== task.id || displayProgress.percent !== percent) {
    setDisplayProgress({ id: task.id, percent })
  }
  const context = getProgressChapterContext(task, progress)
  const stage = cancelPending
    ? t("sidepanel_cancelingDownload")
    : task.activeBlock
      ? getTaskStatusLabel(
          task.status,
          task.activeBlock,
          task.outputDestination,
          task.saveConfirmedAt
        )
      : !progress
        ? t("progressStage_preparing")
        : progress?.stage === "saving"
          ? t("sidepanel_waitingForSave")
          : getProgressStageCaption(context, task.outputMode, numbers)
  const phase = cancelPending
    ? t("sidepanel_stageCanceling")
    : !progress || task.activeBlock
      ? stage
      : progress.stage === "downloading"
        ? t("sidepanel_stageDownloading")
        : progress.stage === "archiving"
          ? t("sidepanel_stagePacking")
          : progress.stage === "saving"
            ? t("sidepanel_stageSaving")
            : stage
  const phaseDetail = cancelPending
    ? t("sidepanel_cancelCleanup")
    : progress?.stage === "downloading"
      ? t("sidepanel_imageCount", [
          String(numbers.processedImages),
          String(numbers.totalImages),
        ])
      : progress?.stage === "saving"
        ? t("sidepanel_saveConfirmation")
        : progress?.stage === "archiving" && details.task
          ? t("sidepanel_archiveCaption", [
              details.task.settingsSnapshot.archiveFormat.toUpperCase(),
            ])
          : ""
  const currentChapter =
    details.task?.chapters.find(
      (chapter) => chapter.id === progress?.chapterId
    ) ??
    details.task?.chapters.find((chapter) => chapter.status === "downloading")
  const availability = getTaskActionAvailability(task, {
    hasCancelHandler: Boolean(props.onCancelTask),
    isCanceling: cancelPending,
    hasRestartHandler: Boolean(props.onRestartTask),
    hasRemoveHandler: Boolean(props.onRemoveTask),
    hasMoveToTopHandler: Boolean(props.onMoveTaskToTop),
    isFirstQueuedTask: props.isFirstQueuedTask,
  })
  const retry = getRetryAvailability(task, Boolean(props.onRetryFailed))
  const failure = getTaskFailureMessage(task)
  useEffect(() => {
    if (!props.isConfirmingCancel) return
    const trigger = cancelButton.current
    keepButton.current?.focus()
    return () => {
      trigger?.focus()
    }
  }, [props.isConfirmingCancel])
  const runRecovery = (kind: "retry" | "restart") => {
    if (task.outputUncertain) setRecovery(kind)
    else
      void (kind === "retry" ? props.onRetryFailed : props.onRestartTask)?.(
        task.id
      )
  }
  const actionProps = {
    taskId: task.id,
    status: task.status,
    outputUncertain: task.outputUncertain,
    isCanceling: cancelPending,
    isRetrying: props.isRetrying,
    isRestarting: props.isRestarting,
    isRemoving: props.isRemoving,
    isMoving: props.isMoving,
    canCancel: availability.canCancel,
    canRetryFailed: retry.canRetryFailed && !task.targetUnavailable,
    canRestart: availability.canRestart && !task.targetUnavailable,
    canMoveToTop: !props.onReorder && availability.canMoveToTop,
    canRemove: availability.canRemove,
    onBeginCancel: props.onBeginCancel,
    onRetryFailed: () => runRecovery("retry"),
    onRestartTask: () => runRecovery("restart"),
    onMoveTaskToTop: props.onMoveTaskToTop,
    onRemoveTask: props.onRemoveTask,
  }
  return (
    <Collapsible
      open={expanded}
      onOpenChange={setExpanded}
      className={active || queued ? "queue-task" : "queue-task failed-task"}
      data-task-id={task.id}
      data-active={active}
      data-queued={queued}
      data-expanded={expanded}
    >
      {(active || queued) && (
        <div className="queue-task-head">
          <button
            type="button"
            className="queue-task-toggle"
            aria-expanded={expanded}
            aria-controls={id}
            onClick={() => setExpanded(!expanded)}
          >
            <span className="task-disclosure">
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
              >
                <path d="M5 12h14" />
                <path className="expand-stem" d="M12 5v14" />
              </svg>
            </span>
            {active && (
              <span className="task-cover">
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
              </span>
            )}
            {queued && props.queuePosition && (
              <span className="queue-position">
                {String(props.queuePosition).padStart(2, "0")}
              </span>
            )}
            <span className="task-heading">
              <h3 title={task.seriesTitle}>{task.seriesTitle}</h3>
              <span className="panel-meta">
                {active ? (
                  t("sidepanel_savedCount", [
                    String(task.chapters.completed),
                    String(task.chapters.total),
                  ])
                ) : (
                  <>
                    <span className="queue-chapter-count">
                      {t(
                        task.chapters.total === 1
                          ? "sidepanel_oneChapter"
                          : "sidepanel_chapterCount",
                        [String(task.chapters.total)]
                      )}
                    </span>
                    {queued && task.chapterRange && (
                      <span className="queue-chapter-range">
                        {t("sidepanel_chapterNumber", [task.chapterRange])}
                      </span>
                    )}
                    {" · "}
                    {getDisplayName(task.siteIntegration)}
                  </>
                )}
              </span>
            </span>
          </button>
          {active ? (
            <button
              type="button"
              className="task-ring"
              data-percent={percent}
              ref={cancelButton}
              title={t(
                cancelPending
                  ? "sidepanel_cancelingDownload"
                  : "sidepanel_cancelDownload"
              )}
              aria-label={t(
                cancelPending
                  ? "sidepanel_cancelingDownload"
                  : "sidepanel_cancelDownload"
              )}
              aria-describedby={id + "-progress"}
              aria-controls={id + "-cancel"}
              aria-expanded={props.isConfirmingCancel}
              disabled={cancelPending || !availability.canCancel}
              onClick={() => props.onBeginCancel(task.id)}
            >
              <svg viewBox="0 0 42 42" aria-hidden="true">
                <circle className="ring-track" cx="21" cy="21" r="18" />
                <circle
                  className="ring-value"
                  cx="21"
                  cy="21"
                  r="18"
                  pathLength="100"
                  strokeDashoffset={100 - percent}
                />
              </svg>
              <span className="ring-percent" aria-hidden="true">
                {percent}%
              </span>
              <X className="ring-cancel" aria-hidden="true" />
              <span className="sr-only" id={id + "-progress"}>
                {t("sidepanel_taskPercent", [String(percent)])}
              </span>
            </button>
          ) : (
            <div className="task-actions">
              {queued && props.onReorder && (
                <button
                  type="button"
                  className="task-grip"
                  ref={reorderButton}
                  draggable={!props.isMoving}
                  aria-label={t("sidepanel_reorderTask")}
                  title={t("sidepanel_reorderTask")}
                  aria-expanded={ordering}
                  disabled={props.isMoving}
                  onClick={() => {
                    setPosition(String(props.queuePosition ?? 1))
                    setOrdering(!ordering)
                  }}
                >
                  <PanelIcon name="grip" />
                </button>
              )}
              <CommandCenterTaskActions {...actionProps} />
            </div>
          )}
        </div>
      )}
      {active && (
        <div
          id={id + "-cancel"}
          className="task-cancel-reveal"
          data-open={props.isConfirmingCancel}
          inert={!props.isConfirmingCancel}
        >
          <div>
            <div
              className="task-cancel"
              role="group"
              aria-label={t("sidepanel_cancelTask")}
              aria-busy={cancelPending}
              onKeyDown={(event) => {
                if (event.key === "Escape" && !cancelPending)
                  props.onDismissCancel()
              }}
            >
              <strong>{t("sidepanel_cancelTaskQuestion")}</strong>
              <p>{t("sidepanel_cancelTaskNote")}</p>
              <div>
                <button
                  ref={keepButton}
                  type="button"
                  onClick={props.onDismissCancel}
                  disabled={cancelPending}
                >
                  {t("sidepanel_keepDownloading")}
                </button>
                <button
                  className="destructive-action"
                  type="button"
                  onClick={() => props.onConfirmCancel(task.id)}
                  disabled={cancelPending}
                >
                  {t("sidepanel_cancelTask")}
                </button>
              </div>
              {props.cancelError && <p role="alert">{props.cancelError}</p>}
            </div>
          </div>
        </div>
      )}
      {active && (
        <div
          className="task-chapter-status"
          title={progress?.chapterTitle ?? currentChapter?.title}
        >
          <span>
            <strong>
              {currentChapter
                ? t("sidepanel_chapterNumber", [
                    String(
                      currentChapter.chapterNumber ?? currentChapter.index
                    ),
                  ])
                : progress?.chapterTitle}
            </strong>
            {currentChapter || progress?.chapterTitle ? " · " : ""}
            {phase}
          </span>
          <span>{phaseDetail}</span>
          {progress?.stage === "downloading" &&
            !cancelPending &&
            numbers.totalImages > 0 && (
              <progress
                aria-label={t("sidepanel_chapterProgress")}
                value={numbers.processedImages}
                max={numbers.totalImages}
              />
            )}
        </div>
      )}
      {!active && !queued && (
        <div className="task-outcome">
          <strong>{task.seriesTitle}</strong>
          <p className="failure-reason">
            {failure ??
              getTaskStatusLabel(
                task.status,
                task.activeBlock,
                task.outputDestination,
                task.saveConfirmedAt
              )}
          </p>
          <p className="panel-meta">
            {t("sidepanel_savedCount", [
              String(task.chapters.completed),
              String(task.chapters.total),
            ])}{" "}
            · {getDisplayName(task.siteIntegration)}
          </p>
          {task.targetUnavailable ? (
            <p className="recovery-note">
              {t("taskFolder_originalUnavailable")}
            </p>
          ) : task.folderAccessRequired ? (
            <p className="recovery-note">{t("sidepanel_restoreFolderNote")}</p>
          ) : task.outputUncertain ? (
            <p className="recovery-note">{t("sidepanel_checkDownloadsNote")}</p>
          ) : retry.canRetryFailed ? (
            <p className="recovery-note">{t("sidepanel_retryRemainingNote")}</p>
          ) : task.status === "completed" &&
            task.saveConfirmedAt === undefined ? (
            <p className="recovery-note">
              {t("output_saveUnconfirmedDescription")}
            </p>
          ) : null}
          {(task.targetUnavailable || task.folderAccessRequired) && (
            <TaskDestinationCaption
              destination={task.destination}
              requestedPath={task.requestedPath}
              useChromeFallback={task.useChromeFallback}
            />
          )}
          {task.outputUncertain && (
            <button
              type="button"
              className="text-action"
              onClick={() =>
                void chrome.tabs.create({ url: "chrome://downloads/" })
              }
            >
              {t("sidepanel_checkDownloads")}
            </button>
          )}
          {task.folderAccessRequired && (
            <button
              type="button"
              className="text-action"
              onClick={() => void openOptionsPage("activity")}
            >
              {t("taskFolder_openActions")}
            </button>
          )}
          <CommandCenterTaskActions {...actionProps} presentation="recovery" />
        </div>
      )}
      {recovery && (
        <div className="task-recovery-confirmation">
          <InlineConfirmation
            title={t(
              recovery === "retry"
                ? "sidepanel_retryTaskQuestion"
                : "sidepanel_restartTaskQuestion"
            )}
            description={t("sidepanel_duplicateWarning")}
            cancelLabel={t("common_cancel")}
            confirmLabel={t(
              recovery === "retry"
                ? "sidepanel_retryAnyway"
                : "sidepanel_restartAnyway"
            )}
            onCancel={() => setRecovery(null)}
            onConfirm={() => {
              void (
                recovery === "retry" ? props.onRetryFailed : props.onRestartTask
              )?.(task.id)
              setRecovery(null)
            }}
          />
        </div>
      )}
      {ordering && (
        <form
          className="task-order"
          onSubmit={async (event) => {
            event.preventDefault()
            const form = event.currentTarget
            const ownedFocus = form.contains(document.activeElement)
            const value = Number(position)
            if (
              Number.isInteger(value) &&
              value >= 1 &&
              value <= (props.queuedCount ?? 1)
            ) {
              await props.onReorder?.(task.id, value)
              setOrdering(false)
              if (ownedFocus)
                requestAnimationFrame(() => {
                  if (
                    document.activeElement !== document.body &&
                    !form.contains(document.activeElement)
                  )
                    return
                  if (reorderButton.current?.isConnected)
                    reorderButton.current.focus()
                  else document.getElementById("panel-tab-queue")?.focus()
                })
            }
          }}
        >
          <label>
            {t("sidepanel_queuePosition")}
            <input
              aria-label={t("sidepanel_queuePosition")}
              type="number"
              disabled={props.isMoving}
              min="1"
              max={props.queuedCount}
              value={position}
              onChange={(event) => setPosition(event.target.value)}
            />
          </label>
          <button type="submit" disabled={props.isMoving}>
            {t("sidepanel_moveTask")}
          </button>
        </form>
      )}
      {!active && !queued && (
        <button
          type="button"
          className="task-results-toggle"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded(!expanded)}
        >
          <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>{" "}
          {t("sidepanel_chapterResults")}
        </button>
      )}
      <CollapsibleContent className="task-details" id={id}>
        {active && (
          <p className="task-detail-meta">
            {t("sidepanel_taskDetailCount", [
              String(task.chapters.completed),
              String(task.chapters.total),
            ])}
            {details.task && (
              <>
                {" "}
                · {details.task.settingsSnapshot.archiveFormat.toUpperCase()}
              </>
            )}
          </p>
        )}
        {details.error ? (
          <button className="text-action" type="button" onClick={details.retry}>
            {t("common_retry")}
          </button>
        ) : !details.task ? (
          <p className="panel-meta">{t("common_loading")}</p>
        ) : (
          <ul>
            {details.task.chapters.map((chapter) => {
              const current = chapter.id === progress?.chapterId
              return (
                <li
                  key={chapter.id}
                  className="task-chapter"
                  data-status={
                    chapter.status === "completed"
                      ? "saved"
                      : current
                        ? "active"
                        : "queued"
                  }
                >
                  <span className="task-chapter-number">
                    {chapter.chapterNumber ?? chapter.index}
                  </span>
                  <span className="task-chapter-title">{chapter.title}</span>
                  <span className="task-chapter-state">
                    {current
                      ? phase
                      : chapter.status === "completed"
                        ? getOutputResultLabel(
                            chapter.outputDestination,
                            chapter.saveConfirmedAt
                          )
                        : t("chapterStatus_" + chapter.status)}
                  </span>
                  {current &&
                    progress?.stage === "downloading" &&
                    numbers.totalImages > 0 && (
                      <>
                        <progress
                          aria-label={t("sidepanel_chapterProgress")}
                          value={numbers.processedImages}
                          max={numbers.totalImages}
                        />
                        <span className="chapter-image-meta">
                          {t("sidepanel_imageCount", [
                            String(numbers.processedImages),
                            String(numbers.totalImages),
                          ])}{" "}
                          · {Math.floor(numbers.imageProgressValue)}%
                        </span>
                      </>
                    )}
                </li>
              )
            })}
          </ul>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}
export const CommandCenterTaskRow = memo(CommandCenterTaskRowView)
CommandCenterTaskRow.displayName = "CommandCenterTaskRow"
