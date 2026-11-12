import { memo, useCallback, useEffect, useId, useRef, useState } from "react"
import { CircleAlert, Download, FolderOpen, X } from "lucide-react"
import { PanelIcon } from "./PanelIcon"
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible"
import { InlineConfirmation } from "@/src/ui/shared/components/InlineConfirmation"
import { openOptionsPage } from "@/src/runtime/open-options"
import logger from "@/src/runtime/logger"
import { TaskDestinationCaption } from "@/src/ui/shared/TaskDestinationCaption"
import { getDisplayName } from "@/src/site-integrations/catalog"
import { t } from "@/src/runtime/i18n"
import { getOutputResultLabel } from "@/src/runtime/output-result-presentation"
import { getDownloadErrorMessage } from "@/src/runtime/download-error-presentation"
import { useI18n } from "@/src/ui/shared/hooks/useI18n"
import type { ActiveTaskProgress as ActiveTaskProgressState } from "../hooks/useActiveTaskProgress"
import type { QueueTaskSummary } from "@/src/domain/queue/state"
import { useTaskDetails } from "../hooks/useTaskDetails"
import {
  getProgressNumbers,
  getProgressChapterContext,
  getProgressStageCaption,
} from "./ActiveTaskProgress-model"
import {
  CommandCenterTaskActions,
  type RecoveryTaskLink,
} from "./CommandCenterTaskActions"
import { CoverPreview } from "./CoverPreview"
import {
  TaskRowFeedback,
  TaskRowFeedbackButton,
  type TaskFeedback,
} from "./TaskRowFeedback"
import { TaskRowReveal } from "./TaskRowReveal"
import {
  getRetryAvailability,
  getTaskActionAvailability,
  getTaskStatusLabel,
  type CommandCenterTaskActionHandler,
} from "./command-center-queue-helpers"
import "./CommandCenterTaskRow.css"

interface CommandCenterTaskRowProps {
  task: QueueTaskSummary
  lane?: "active" | "waiting"
  isCanceling: boolean
  isRetrying: boolean
  isRestarting: boolean
  isRemoving: boolean
  isMoving: boolean
  isConfirmingCancel: boolean
  cancelError: string | null
  taskActionError?: string
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

function getRecoveryNote(task: QueueTaskSummary, canRetry: boolean) {
  if (task.outputUncertain)
    return getDownloadErrorMessage("browser_output_unconfirmed")
  if (task.targetUnavailable) return t("taskFolder_originalUnavailable")
  if (task.folderAccessRequired)
    return task.failureCategory === "folder_permission_required"
      ? null
      : t("sidepanel_restoreFolderNote")
  if (canRetry) return t("sidepanel_retryRemainingNote")
  if (task.status === "completed" && task.saveConfirmedAt === undefined)
    return t("output_saveUnconfirmedDescription")
  return null
}

function CommandCenterTaskRowView(props: CommandCenterTaskRowProps) {
  useI18n()
  const { task, activeTaskProgress } = props
  const [expanded, setExpanded] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [ordering, setOrdering] = useState(false)
  const [position, setPosition] = useState(String(props.queuePosition ?? 1))
  const [recovery, setRecovery] = useState<"retry" | "restart" | null>(null)
  const [recoveryLinkError, setRecoveryLinkError] = useState<string | null>(
    null
  )
  const pendingLink = useRef<RecoveryTaskLink["id"] | null>(null)
  const [openingLink, setOpeningLink] = useState<RecoveryTaskLink["id"] | null>(
    null
  )
  const id = useId()
  const cancelButton = useRef<HTMLButtonElement>(null)
  const reorderButton = useRef<HTMLButtonElement>(null)
  const keepButton = useRef<HTMLButtonElement>(null)
  const disclosure = useRef<HTMLButtonElement>(null)
  const feedbackTrigger = useRef<HTMLButtonElement>(null)
  const restoreCancelFocus = useRef(false)
  const active = task.status === "downloading"
  const queued = task.status === "queued"
  const terminal = !active && !queued
  const layout =
    props.lane ??
    (active || (terminal && task.timestamps.started !== undefined)
      ? "active"
      : "waiting")
  const activeLayout = layout === "active"
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
  useEffect(() => {
    if (!props.isConfirmingCancel) return
    const trigger = cancelButton.current
    const fallback = disclosure.current
    keepButton.current?.focus()
    return () => {
      if (trigger?.isConnected) trigger.focus()
      else fallback?.focus()
    }
  }, [props.isConfirmingCancel])
  const runRecovery = (kind: "retry" | "restart") => {
    if (task.outputUncertain) {
      feedbackTrigger.current?.focus()
      setFeedbackOpen(false)
      setRecovery(kind)
    } else
      void (kind === "retry" ? props.onRetryFailed : props.onRestartTask)?.(
        task.id
      )
  }
  const openRecoveryLink = useCallback(
    async (
      link: RecoveryTaskLink["id"],
      open: () => Promise<unknown>,
      failureKey:
        "taskFolder_openActionsFailed" | "sidepanel_checkDownloadsFailed"
    ) => {
      if (pendingLink.current) return
      pendingLink.current = link
      setOpeningLink(link)
      setRecoveryLinkError(null)
      try {
        await open()
      } catch (error) {
        logger.warn(
          "[CommandCenter] Could not open a task recovery action:",
          error
        )
        setRecoveryLinkError(t(failureKey))
      } finally {
        pendingLink.current = null
        setOpeningLink(null)
      }
    },
    []
  )
  const checkDownloads: RecoveryTaskLink = {
    id: "check-downloads",
    Icon: Download,
    label: t("sidepanel_checkDownloads"),
    pending: openingLink === "check-downloads",
    invoke: () =>
      openRecoveryLink(
        "check-downloads",
        () => chrome.tabs.create({ url: "chrome://downloads/" }),
        "sidepanel_checkDownloadsFailed"
      ),
  }
  const openFolderActions: RecoveryTaskLink = {
    id: "open-folder-actions",
    Icon: FolderOpen,
    label: t("taskFolder_openActions"),
    pending: openingLink === "open-folder-actions",
    invoke: () =>
      openRecoveryLink(
        "open-folder-actions",
        () => openOptionsPage("activity", task.id),
        "taskFolder_openActionsFailed"
      ),
  }
  const recoveryLinks = [
    ...(task.outputUncertain ? [checkDownloads] : []),
    ...(task.folderAccessRequired ? [openFolderActions] : []),
  ]
  const actionErrors = [
    props.cancelError,
    props.taskActionError,
    recoveryLinkError,
  ].filter((message): message is string => Boolean(message))
  const canRetryFailed = retry.canRetryFailed && !task.targetUnavailable
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
    canRetryFailed,
    canRestart: availability.canRestart && !task.targetUnavailable,
    canMoveToTop: !props.onReorder && availability.canMoveToTop,
    canRemove: availability.canRemove,
    onBeginCancel: (taskId: string) => {
      restoreCancelFocus.current =
        queued &&
        document.activeElement?.getAttribute("aria-label") ===
          t("sidepanel_cancelDownload")
      props.onBeginCancel(taskId)
    },
    onRetryFailed: () => runRecovery("retry"),
    onRestartTask: () => runRecovery("restart"),
    onMoveTaskToTop: props.onMoveTaskToTop,
    onRemoveTask: props.onRemoveTask,
  }
  const recoveryCause =
    task.failureCategory === "unknown" ||
    (task.failureCategory === "browser_output_unconfirmed" &&
      task.outputUncertain)
      ? null
      : task.failureCategory
        ? getDownloadErrorMessage(task.failureCategory)
        : null
  const recoveryNote = getRecoveryNote(task, canRetryFailed)
  const statusLabel = getTaskStatusLabel(
    task.status,
    task.activeBlock,
    task.outputDestination,
    task.saveConfirmedAt
  )
  const feedback: TaskFeedback | null =
    terminal || actionErrors.length > 0
      ? {
          summary: actionErrors[0] ?? statusLabel,
          tone:
            actionErrors.length > 0 || task.status === "failed"
              ? "error"
              : "warning",
          description:
            (terminal ? recoveryCause : statusLabel) ??
            (task.status === "failed" && !recoveryNote
              ? t("sidepanel_taskStoppedEarly")
              : null),
          guidance: recoveryNote,
          messages: actionErrors.slice(1),
        }
      : null
  useEffect(() => {
    if (!props.cancelError || !restoreCancelFocus.current) return
    restoreCancelFocus.current = false
    if (document.activeElement === document.body)
      feedbackTrigger.current?.focus()
  }, [props.cancelError])
  const savedCount = t("sidepanel_savedCount", [
    String(task.chapters.completed),
    String(task.chapters.total),
  ])
  const showSavedCount =
    activeLayout &&
    (task.status !== "completed" || task.saveConfirmedAt !== undefined)
  if (!feedback && feedbackOpen) setFeedbackOpen(false)
  const feedbackPanelId = id + "-feedback"
  const feedbackControl = feedback && (
    <TaskRowFeedbackButton
      feedback={feedback}
      panelId={feedbackPanelId}
      open={feedbackOpen}
      triggerRef={feedbackTrigger}
      onToggle={() => setFeedbackOpen((open) => !open)}
    />
  )
  const feedbackPanel = feedback && (
    <TaskRowFeedback
      panelId={feedbackPanelId}
      open={feedbackOpen}
      onClose={() => {
        setFeedbackOpen(false)
        feedbackTrigger.current?.focus()
      }}
      feedback={feedback}
      taskActions={
        active && props.isConfirmingCancel
          ? { ...actionProps, onBeginCancel: props.onConfirmCancel }
          : actionProps
      }
      recoveryLinks={recoveryLinks}
      terminal={terminal}
    >
      {terminal &&
        !activeLayout &&
        (task.status !== "completed" || task.saveConfirmedAt !== undefined) && (
          <p>{savedCount}</p>
        )}
      {terminal && (task.targetUnavailable || task.folderAccessRequired) && (
        <TaskDestinationCaption
          destination={task.destination}
          requestedPath={task.requestedPath}
          useChromeFallback={task.useChromeFallback}
        />
      )}
    </TaskRowFeedback>
  )
  return (
    <Collapsible
      open={expanded}
      onOpenChange={setExpanded}
      className="queue-task"
      data-task-id={task.id}
      data-active={active}
      data-queued={queued}
      data-expanded={expanded}
      data-recovery={terminal}
      data-layout={layout}
    >
      <div className="queue-task-head">
        <button
          type="button"
          ref={disclosure}
          className="queue-task-toggle"
          aria-label={
            terminal
              ? `${task.seriesTitle} · ${t("sidepanel_chapterResults")}`
              : undefined
          }
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
          {activeLayout && (
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
          {!activeLayout &&
          (props.queuePosition || (terminal && props.onReorder)) ? (
            <span
              className="queue-position"
              data-placeholder={terminal || undefined}
              aria-hidden={terminal || undefined}
            >
              {terminal ? "00" : String(props.queuePosition).padStart(2, "0")}
            </span>
          ) : null}
          <span className="task-heading">
            <h3 title={task.seriesTitle}>{task.seriesTitle}</h3>
            <span className="task-row-meta">
              <span
                className="panel-meta"
                data-replaced={Boolean(feedback)}
                aria-hidden={feedback ? true : undefined}
              >
                {showSavedCount ? (
                  savedCount
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
                    {!activeLayout && task.chapterRange && (
                      <span className="queue-chapter-range">
                        {t("sidepanel_chapterNumber", [task.chapterRange])}
                      </span>
                    )}
                    {" · "}
                    {getDisplayName(task.siteIntegration)}
                  </>
                )}
              </span>
              {feedback && (
                <span data-task-feedback-summary data-tone={feedback.tone}>
                  {feedback.summary}
                </span>
              )}
            </span>
          </span>
        </button>
        {activeLayout ? (
          (feedbackControl ?? (
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
              onClick={() => actionProps.onBeginCancel(task.id)}
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
          ))
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
            {terminal && props.onReorder && (
              <span className="task-grip-slot" aria-hidden="true" />
            )}
            {feedbackControl ?? <CommandCenterTaskActions {...actionProps} />}
          </div>
        )}
      </div>
      <span className="sr-only" aria-live="assertive">
        {actionErrors[0]}
      </span>
      {active && (
        <TaskRowReveal
          id={id + "-cancel"}
          open={props.isConfirmingCancel && !feedbackOpen}
          label={t("sidepanel_cancelTask")}
          busy={cancelPending}
          onEscape={props.onDismissCancel}
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
        </TaskRowReveal>
      )}
      {feedbackPanel}
      {activeLayout && (
        <div
          className="task-chapter-status"
          title={progress?.chapterTitle ?? currentChapter?.title}
        >
          <span>
            {terminal ? (
              showSavedCount ? (
                savedCount
              ) : (
                t("sidepanel_chapterCount", [String(task.chapters.total)])
              )
            ) : (
              <>
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
              </>
            )}
          </span>
          <span>
            {terminal ? getDisplayName(task.siteIntegration) : phaseDetail}
          </span>
          {!terminal &&
            progress?.stage === "downloading" &&
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
          <div className="task-detail-notice">
            <CircleAlert size={14} aria-hidden="true" />
            <p role="alert">{t("sidepanel_taskDetailsLoadFailed")}</p>
            <button
              className="task-recovery-dismiss"
              type="button"
              onClick={details.retry}
            >
              {t("common_retry")}
            </button>
          </div>
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
