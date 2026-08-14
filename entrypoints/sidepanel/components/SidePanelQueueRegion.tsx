import { useCallback, useMemo, useRef } from "react"
import { Download } from "lucide-react"

import { useVirtualizer } from "@tanstack/react-virtual"

import { cn } from "@/src/shared/utils"
import { HistorySection } from "@/entrypoints/sidepanel/components/HistorySection"
import { CommandCenterQueue } from "@/entrypoints/sidepanel/components/CommandCenterQueue"
import type { ActiveTaskProgress as ActiveTaskProgressState } from "@/entrypoints/sidepanel/hooks/useActiveTaskProgress"
import type { QueueTaskSummary } from "@/src/domain/queue/state"
import { t } from "@/src/runtime/i18n"
import type { CancelTaskResult } from "@/entrypoints/sidepanel/types"

interface SidePanelQueueRegionProps {
  queueTasks: QueueTaskSummary[]
  historyTasks: QueueTaskSummary[]
  isLoading: boolean
  isInlineSelectionOpen: boolean
  cancelingTaskIds: Set<string>
  forgettingTaskIds: Set<string>
  retryingTaskIds: Set<string>
  restartingTaskIds: Set<string>
  removingTaskIds: Set<string>
  movingTaskIds: Set<string>
  activeTaskProgress: ActiveTaskProgressState | null
  showActiveProgress: boolean
  onCancelTask: (taskId: string) => CancelTaskResult | Promise<CancelTaskResult>
  onForgetUnobservable: (taskId: string) => void | Promise<void>
  onRetryFailed: (taskId: string) => void | Promise<void>
  onRestartTask: (taskId: string) => void | Promise<void>
  onMoveTaskToTop: (taskId: string) => void | Promise<void>
  onRemoveTask: (taskId: string) => void | Promise<void>
  onViewFullHistory: () => void | Promise<void>
}

export function SidePanelQueueRegion({
  queueTasks,
  historyTasks,
  isLoading,
  isInlineSelectionOpen,
  cancelingTaskIds,
  forgettingTaskIds,
  retryingTaskIds,
  restartingTaskIds,
  removingTaskIds,
  movingTaskIds,
  activeTaskProgress,
  showActiveProgress,
  onCancelTask,
  onForgetUnobservable,
  onRetryFailed,
  onRestartTask,
  onMoveTaskToTop,
  onRemoveTask,
  onViewFullHistory,
}: SidePanelQueueRegionProps) {
  const queueScrollRef = useRef<HTMLDivElement | null>(null)
  const visibleQueueTasks = useMemo(
    () =>
      isInlineSelectionOpen
        ? queueTasks.filter((task) => task.status === "downloading")
        : queueTasks,
    [isInlineSelectionOpen, queueTasks]
  )
  // React Compiler safely skips this component because TanStack Virtual returns
  // imperative functions whose identities cannot be compiler-memoized.
  // eslint-disable-next-line react-hooks/incompatible-library
  const queueVirtualizer = useVirtualizer({
    count: visibleQueueTasks.length,
    getScrollElement: () => queueScrollRef.current,
    estimateSize: () => 78,
    overscan: 6,
    // Use stable task IDs as keys so the virtualizer's measurement cache
    // survives reordering (e.g. moveTaskToTop) without DOM reuse bugs.
    getItemKey: (index) => visibleQueueTasks[index]?.id ?? index,
  })

  const measureQueueRow = useCallback(
    (element: HTMLDivElement | null) => {
      if (!element) return
      queueVirtualizer.measureElement(element)
    },
    [queueVirtualizer]
  )

  const hasAnyTask = queueTasks.length > 0 || historyTasks.length > 0
  const firstQueuedTaskId = queueTasks.find(
    (task) => task.status === "queued"
  )?.id

  const renderTask = (task: QueueTaskSummary) => (
    <CommandCenterQueue
      tasks={[task]}
      activeTaskProgress={
        task.status === "downloading" ? activeTaskProgress : null
      }
      showActiveProgress={task.status === "downloading" && showActiveProgress}
      firstQueuedTaskId={firstQueuedTaskId}
      onCancelTask={onCancelTask}
      onForgetUnobservable={onForgetUnobservable}
      cancelingTaskIds={cancelingTaskIds}
      forgettingTaskIds={forgettingTaskIds}
      retryingTaskIds={retryingTaskIds}
      restartingTaskIds={restartingTaskIds}
      removingTaskIds={removingTaskIds}
      movingTaskIds={movingTaskIds}
      onRetryFailed={onRetryFailed}
      onRestartTask={onRestartTask}
      onMoveTaskToTop={onMoveTaskToTop}
      onRemoveTask={onRemoveTask}
    />
  )

  return (
    <div
      data-sidepanel-queue-region
      data-state={isInlineSelectionOpen ? "open" : "closed"}
      className={cn(
        "flex min-h-0 basis-auto shrink-0 flex-col overflow-hidden bg-background transition-[flex-grow] duration-[280ms] ease-out",
        isInlineSelectionOpen ? "grow-0" : "grow"
      )}
    >
      {isLoading && !isInlineSelectionOpen && (
        <div
          className="flex flex-col gap-2 p-3"
          role="status"
          aria-live="polite"
          aria-busy="true"
          aria-label={t("common_loading")}
        >
          <div
            className="h-16 animate-pulse rounded-md border border-border/60 bg-muted/30"
            aria-hidden="true"
          />
          <div
            className="h-16 animate-pulse rounded-md border border-border/60 bg-muted/30"
            aria-hidden="true"
          />
          <div
            className="h-16 animate-pulse rounded-md border border-border/60 bg-muted/30"
            aria-hidden="true"
          />
        </div>
      )}

      {!isLoading && visibleQueueTasks.length > 0 && (
        <div
          ref={queueScrollRef}
          data-queue-scroll-container
          className="min-h-0 flex-1 overflow-y-auto border-y border-border/50"
        >
          {visibleQueueTasks.length <= 24 ? (
            visibleQueueTasks.map((task, index) => (
              <div
                key={task.id}
                data-index={index}
                data-queue-task-id={task.id}
              >
                {renderTask(task)}
              </div>
            ))
          ) : (
            <div
              style={{
                height: `${queueVirtualizer.getTotalSize()}px`,
                position: "relative",
              }}
            >
              {queueVirtualizer.getVirtualItems().map((item) => {
                const task = visibleQueueTasks[item.index]
                if (!task) return null

                return (
                  <div
                    key={task.id}
                    data-index={item.index}
                    data-queue-task-id={task.id}
                    ref={measureQueueRow}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${item.start}px)`,
                      contentVisibility: "auto",
                      containIntrinsicSize: "auto 78px",
                    }}
                  >
                    {renderTask(task)}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {!isLoading && !isInlineSelectionOpen && (
        <HistorySection
          tasks={historyTasks}
          isInlineSelectionOpen={isInlineSelectionOpen}
          onViewFullHistory={onViewFullHistory}
          onRetryFailed={onRetryFailed}
          onRestartTask={onRestartTask}
          onRemoveTask={onRemoveTask}
          retryingTaskIds={retryingTaskIds}
          restartingTaskIds={restartingTaskIds}
          removingTaskIds={removingTaskIds}
        />
      )}

      {!isLoading && !isInlineSelectionOpen && !hasAnyTask && (
        <div className="p-6 text-center">
          <Download
            className="size-8 mx-auto mb-2 text-muted-foreground/50"
            aria-hidden="true"
          />
          <h3 className="font-medium text-sm mb-1">
            {t("sidepanel_noDownloadsYet")}
          </h3>
          <p className="text-xs text-muted-foreground">
            {t("sidepanel_useSelectChapters")}
          </p>
        </div>
      )}
    </div>
  )
}
