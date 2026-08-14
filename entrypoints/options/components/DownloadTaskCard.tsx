import { useId, useState } from "react"
import {
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Trash2,
  XCircle,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { InlineConfirmation } from "@/src/ui/shared/components/InlineConfirmation"
import { getDisplayName } from "@/src/site-integrations/catalog"
import type { DownloadTaskState } from "@/src/domain/queue/state"
import { t } from "@/src/runtime/i18n"
import {
  getDownloadCancelPresentation,
  getDownloadErrorMessage,
} from "@/src/runtime/download-error-presentation"
import {
  chapterStatusBadgeClass,
  formatChapterStatusLabel,
  formatTaskTimestamp,
  getChapterImageSummary,
  getTaskStatusBadge,
  getTaskStatusSummaryLabel,
  getTerminalTimestampLabel,
  shouldShowChapterError,
} from "@/entrypoints/options/components/downloads-tab-helpers"
import type { DownloadTaskActionResult } from "@/entrypoints/options/types/download-task-actions"

export interface DownloadTaskCardProps {
  task: DownloadTaskState
  isChapterListExpanded?: boolean
  onChapterListExpandedChange?: (expanded: boolean) => void
  onCancel: (taskId: string) => Promise<DownloadTaskActionResult>
  onRetry: (taskId: string) => Promise<void>
  onRestart: (taskId: string) => Promise<void>
  onRemove: (taskId: string) => Promise<void>
}

function StatusBadge({ status }: { status: DownloadTaskState["status"] }) {
  const variant = getTaskStatusBadge(status)

  return <Badge className={variant.className}>{variant.label}</Badge>
}

export function DownloadTaskCard({
  task,
  isChapterListExpanded: controlledChapterListExpanded,
  onChapterListExpandedChange,
  onCancel,
  onRetry,
  onRestart,
  onRemove,
}: DownloadTaskCardProps) {
  const [uncontrolledChapterListExpanded, setUncontrolledChapterListExpanded] =
    useState(false)
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const [isCanceling, setIsCanceling] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<
    "retry" | "restart" | "remove" | null
  >(null)
  const chapterListId = useId()
  const isChapterListExpanded =
    controlledChapterListExpanded ?? uncontrolledChapterListExpanded
  const completedChapters = task.chapters.filter(
    (chapter) => chapter.status === "completed"
  ).length
  const totalChapters = task.chapters.length
  const siteIntegrationName = getDisplayName(task.siteIntegrationId)
  const terminalTimestampLabel = getTerminalTimestampLabel(task.status)
  const isRetried = task.isRetried ?? false
  const cancelPresentation = getDownloadCancelPresentation(
    task.errorCategory,
    task.chapters.some(
      (chapter) => chapter.errorCategory === "browser_download_unobservable"
    )
  )

  const runTaskAction = async (
    action: "retry" | "restart" | "remove",
    callback: () => Promise<void>
  ) => {
    if (pendingAction) return
    setPendingAction(action)
    try {
      await callback()
    } finally {
      setPendingAction(null)
    }
  }

  return (
    <Card
      className="relative"
      aria-busy={pendingAction !== null || isCanceling}
    >
      {confirmingCancel && task.status === "downloading" && (
        <InlineConfirmation
          title={cancelPresentation.title}
          description={cancelPresentation.description}
          pendingLabel={t("sidepanel_cancelingDownload")}
          confirmLabel={cancelPresentation.confirmLabel}
          cancelLabel={t("common_no")}
          isPending={isCanceling}
          errorMessage={cancelError}
          onConfirm={() => {
            setIsCanceling(true)
            setCancelError(null)
            void onCancel(task.id)
              .then((result) => {
                if (result.success) {
                  setConfirmingCancel(false)
                  return
                }
                setCancelError(t("options_toastCancelFailed"))
              })
              .catch(() => {
                setCancelError(t("options_toastCancelFailed"))
              })
              .finally(() => setIsCanceling(false))
          }}
          onCancel={() => {
            setCancelError(null)
            setConfirmingCancel(false)
          }}
        />
      )}
      <CardHeader className="pb-3">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <CardTitle role="heading" aria-level={3} className="text-base">
              {task.seriesTitle}
            </CardTitle>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span>
                {t("options_chaptersCount", [
                  String(completedChapters),
                  String(totalChapters),
                ])}
              </span>
              <span>•</span>
              <span>{siteIntegrationName}</span>
              {terminalTimestampLabel && typeof task.completed === "number" && (
                <>
                  <span>•</span>
                  <span>
                    {terminalTimestampLabel}{" "}
                    {formatTaskTimestamp(task.completed)}
                  </span>
                </>
              )}
              {!(
                terminalTimestampLabel && typeof task.completed === "number"
              ) && (
                <>
                  <span>•</span>
                  <span>
                    {t("options_createdAt", [
                      formatTaskTimestamp(task.created),
                    ])}
                  </span>
                </>
              )}
              {isRetried && (
                <>
                  <span>•</span>
                  <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                    {t("options_retried")}
                  </Badge>
                </>
              )}
            </div>
          </div>
          <StatusBadge status={task.status} />
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => {
              const nextValue = !isChapterListExpanded
              if (onChapterListExpandedChange) {
                onChapterListExpandedChange(nextValue)
              } else {
                setUncontrolledChapterListExpanded(nextValue)
              }
            }}
            className="flex w-full items-center gap-1.5 text-left text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded"
            aria-expanded={isChapterListExpanded}
            aria-controls={chapterListId}
          >
            {isChapterListExpanded ? (
              <ChevronDown className="size-4 shrink-0" />
            ) : (
              <ChevronRight className="size-4 shrink-0" />
            )}
            <span>{getTaskStatusSummaryLabel(task)}</span>
          </button>

          {isChapterListExpanded && (
            <div
              id={chapterListId}
              role="table"
              className="mt-2 overflow-x-auto rounded-md border"
            >
              <div
                role="row"
                className="grid min-w-[34rem] grid-cols-[minmax(0,1fr)_90px_100px_minmax(0,1fr)] bg-muted/40 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
              >
                <span role="columnheader">{t("options_chapter")}</span>
                <span role="columnheader">{t("options_status")}</span>
                <span role="columnheader">{t("options_images")}</span>
                <span role="columnheader">{t("options_error")}</span>
              </div>
              <div
                role="rowgroup"
                className="max-h-56 min-w-[34rem] overflow-y-auto"
              >
                {task.chapters.map((chapter, index) => {
                  const showError = shouldShowChapterError(chapter.status)
                  return (
                    <div
                      role="row"
                      key={chapter.id ?? chapter.url ?? `chapter-row-${index}`}
                      className="grid grid-cols-[minmax(0,1fr)_90px_100px_minmax(0,1fr)] items-center gap-2 border-t px-3 py-2 text-xs"
                    >
                      <span
                        role="cell"
                        className="truncate"
                        title={chapter.title}
                      >
                        {chapter.title}
                      </span>
                      <div role="cell">
                        <Badge
                          className={chapterStatusBadgeClass(chapter.status)}
                        >
                          {formatChapterStatusLabel(chapter.status)}
                        </Badge>
                      </div>
                      <span role="cell" className="font-mono text-[11px]">
                        {getChapterImageSummary(chapter)}
                      </span>
                      <span
                        role="cell"
                        className="truncate text-muted-foreground"
                        title={
                          showError
                            ? getDownloadErrorMessage(chapter.errorCategory)
                            : ""
                        }
                      >
                        {showError
                          ? getDownloadErrorMessage(chapter.errorCategory)
                          : "-"}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {task.errorCategory && (
          <p className="text-sm text-destructive">
            {t("common_error")}: {getDownloadErrorMessage(task.errorCategory)}
          </p>
        )}

        <div className="flex flex-wrap gap-2 pt-2">
          {task.status === "downloading" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setCancelError(null)
                setConfirmingCancel(true)
              }}
            >
              <XCircle data-icon="inline-start" className="size-4" />
              {t("common_cancel")}
            </Button>
          )}

          {task.status === "queued" && (
            <Button
              variant="outline"
              size="sm"
              disabled={isCanceling}
              onClick={() => {
                if (isCanceling) return
                setCancelError(null)
                setIsCanceling(true)
                void onCancel(task.id)
                  .then((result) => {
                    if (!result.success) {
                      setCancelError(t("options_toastCancelFailed"))
                    }
                  })
                  .catch(() => {
                    setCancelError(t("options_toastCancelFailed"))
                  })
                  .finally(() => setIsCanceling(false))
              }}
            >
              <XCircle data-icon="inline-start" className="size-4" />
              {isCanceling
                ? t("sidepanel_cancelingDownload")
                : t("common_cancel")}
            </Button>
          )}

          {task.status === "completed" && (
            <Button
              variant="outline"
              size="sm"
              disabled={pendingAction !== null}
              onClick={() =>
                void runTaskAction("remove", () => onRemove(task.id))
              }
            >
              <Trash2 data-icon="inline-start" className="size-4" />
              {t("common_remove")}
            </Button>
          )}

          {task.status === "partial_success" && !isRetried && (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={pendingAction !== null}
                onClick={() =>
                  void runTaskAction("retry", () => onRetry(task.id))
                }
              >
                <RotateCcw data-icon="inline-start" className="size-4" />
                {t("sidepanel_retryFailedChapters")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={pendingAction !== null}
                onClick={() =>
                  void runTaskAction("restart", () => onRestart(task.id))
                }
              >
                <RotateCcw data-icon="inline-start" className="size-4" />
                {t("sidepanel_restartTask")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={pendingAction !== null}
                onClick={() =>
                  void runTaskAction("remove", () => onRemove(task.id))
                }
              >
                <Trash2 data-icon="inline-start" className="size-4" />
                {t("common_remove")}
              </Button>
            </>
          )}

          {(task.status === "failed" || task.status === "canceled") && (
            <>
              {!isRetried && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pendingAction !== null}
                  onClick={() =>
                    void runTaskAction("restart", () => onRestart(task.id))
                  }
                >
                  <RotateCcw data-icon="inline-start" className="size-4" />
                  {t("sidepanel_restartTask")}
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                disabled={pendingAction !== null}
                onClick={() =>
                  void runTaskAction("remove", () => onRemove(task.id))
                }
              >
                <Trash2 data-icon="inline-start" className="size-4" />
                {t("common_remove")}
              </Button>
            </>
          )}
        </div>

        {task.status === "queued" && cancelError && (
          <p className="text-sm text-destructive">{cancelError}</p>
        )}
      </CardContent>
    </Card>
  )
}
