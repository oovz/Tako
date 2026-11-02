import { useCallback, useMemo, useRef } from "react"
import { Download } from "lucide-react"
import { useVirtualizer } from "@tanstack/react-virtual"

import { cn } from "@/src/shared/utils"
import { HistorySection } from "@/entrypoints/sidepanel/components/HistorySection"
import {
  CommandCenterQueue,
  type CommandCenterQueueProps,
} from "@/entrypoints/sidepanel/components/CommandCenterQueue"
import type { ActiveTaskProgress as ActiveTaskProgressState } from "@/entrypoints/sidepanel/hooks/useActiveTaskProgress"
import type { QueueTaskSummary } from "@/src/domain/queue/state"
import { t } from "@/src/runtime/i18n"
import type { CancelTaskResult } from "@/entrypoints/sidepanel/types"
import { QueueReadNotice } from "@/src/ui/shared/QueueReadNotice"
import type { StorageReadStatus } from "@/src/ui/shared/hooks/useChromeStorageValue"
import type { CommandCenterTaskActionHandler } from "./command-center-queue-helpers"

interface SidePanelQueueRegionProps {
  queueTasks: QueueTaskSummary[]
  historyTasks: QueueTaskSummary[]
  isLoading: boolean
  readStatus: StorageReadStatus
  onRefresh: () => Promise<void>
  isInlineSelectionOpen: boolean
  cancelingTaskIds: Set<string>
  retryingTaskIds: Set<string>
  restartingTaskIds: Set<string>
  removingTaskIds: Set<string>
  movingTaskIds: Set<string>
  activeTaskProgress: ActiveTaskProgressState | null
  showActiveProgress: boolean
  onCancelTask: (taskId: string) => CancelTaskResult | Promise<CancelTaskResult>
  onRetryFailed: CommandCenterTaskActionHandler
  onRestartTask: CommandCenterTaskActionHandler
  onMoveTaskToTop: CommandCenterTaskActionHandler
  onRemoveTask: CommandCenterTaskActionHandler
  onViewFullHistory: () => void | Promise<void>
}

type QueueCommands = Omit<CommandCenterQueueProps, "tasks" | "emptyState">

function QueueRegionTask({
  task,
  commands,
}: {
  task: QueueTaskSummary
  commands: QueueCommands
}) {
  return (
    <CommandCenterQueue
      {...commands}
      tasks={[task]}
      activeTaskProgress={
        task.status === "downloading" ? commands.activeTaskProgress : null
      }
      showActiveProgress={
        task.status === "downloading" && commands.showActiveProgress
      }
    />
  )
}

function QueueTaskList({
  tasks,
  commands,
  isLoading,
}: {
  tasks: QueueTaskSummary[]
  commands: QueueCommands
  isLoading: boolean
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  // TanStack Virtual's imperative functions cannot be compiler-memoized.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: tasks.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 78,
    overscan: 6,
    // Preserve measured task identities across queue reordering.
    getItemKey: (index) => tasks[index]?.id ?? index,
  })
  const measureRow = useCallback(
    (element: HTMLDivElement | null) => {
      if (element) virtualizer.measureElement(element)
    },
    [virtualizer]
  )

  if (isLoading || tasks.length === 0) return null
  return (
    <div
      ref={scrollRef}
      data-queue-scroll-container
      className="min-h-0 flex-1 overflow-y-auto border-y border-border/50"
    >
      {tasks.length <= 24 ? (
        tasks.map((task, index) => (
          <div key={task.id} data-index={index} data-queue-task-id={task.id}>
            <QueueRegionTask task={task} commands={commands} />
          </div>
        ))
      ) : (
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            position: "relative",
          }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const task = tasks[item.index]
            if (!task) return null
            return (
              <div
                key={task.id}
                data-index={item.index}
                data-queue-task-id={task.id}
                ref={measureRow}
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
                <QueueRegionTask task={task} commands={commands} />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function QueueLoadingState({ visible }: { visible: boolean }) {
  if (!visible) return null
  return (
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
  )
}

function QueueHistory(props: SidePanelQueueRegionProps) {
  if (props.isLoading || props.isInlineSelectionOpen) return null
  return (
    <HistorySection
      tasks={props.historyTasks}
      isInlineSelectionOpen={props.isInlineSelectionOpen}
      onViewFullHistory={props.onViewFullHistory}
      onRetryFailed={props.onRetryFailed}
      onRestartTask={props.onRestartTask}
      onRemoveTask={props.onRemoveTask}
      retryingTaskIds={props.retryingTaskIds}
      restartingTaskIds={props.restartingTaskIds}
      removingTaskIds={props.removingTaskIds}
    />
  )
}

function QueueEmptyState({
  readStatus,
  isInlineSelectionOpen,
  queueTasks,
  historyTasks,
}: Pick<
  SidePanelQueueRegionProps,
  "readStatus" | "isInlineSelectionOpen" | "queueTasks" | "historyTasks"
>) {
  if (
    readStatus !== "ready" ||
    isInlineSelectionOpen ||
    queueTasks.length > 0 ||
    historyTasks.length > 0
  )
    return null
  return (
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
  )
}

export function SidePanelQueueRegion(props: SidePanelQueueRegionProps) {
  const { queueTasks, isInlineSelectionOpen } = props
  const visibleTasks = useMemo(
    () =>
      isInlineSelectionOpen
        ? queueTasks.filter((task) => task.status === "downloading")
        : queueTasks,
    [isInlineSelectionOpen, queueTasks]
  )
  const commands: QueueCommands = {
    firstQueuedTaskId: queueTasks.find((task) => task.status === "queued")?.id,
    activeTaskProgress: props.activeTaskProgress,
    showActiveProgress: props.showActiveProgress,
    onCancelTask: props.onCancelTask,
    cancelingTaskIds: props.cancelingTaskIds,
    retryingTaskIds: props.retryingTaskIds,
    restartingTaskIds: props.restartingTaskIds,
    removingTaskIds: props.removingTaskIds,
    movingTaskIds: props.movingTaskIds,
    onRetryFailed: props.onRetryFailed,
    onRestartTask: props.onRestartTask,
    onMoveTaskToTop: props.onMoveTaskToTop,
    onRemoveTask: props.onRemoveTask,
  }
  return (
    <div
      data-sidepanel-queue-region
      data-state={isInlineSelectionOpen ? "open" : "closed"}
      className={cn(
        "flex min-h-0 basis-auto shrink-0 flex-col overflow-hidden bg-background transition-[flex-grow] duration-[280ms] ease-out",
        isInlineSelectionOpen ? "grow-0" : "grow"
      )}
    >
      <QueueReadNotice status={props.readStatus} onRetry={props.onRefresh} />
      <QueueLoadingState visible={props.isLoading && !isInlineSelectionOpen} />
      <QueueTaskList
        tasks={visibleTasks}
        commands={commands}
        isLoading={props.isLoading}
      />
      <QueueHistory {...props} />
      <QueueEmptyState {...props} />
    </div>
  )
}
