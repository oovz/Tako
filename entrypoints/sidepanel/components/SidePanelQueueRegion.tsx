import { usePanelScrollMargin } from "../hooks/usePanelScrollMargin"
import { usePanelLayoutMotion } from "../hooks/usePanelLayoutMotion"
import { useMemo, useRef, useState } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { toast } from "sonner"
import type { QueueTaskSummary } from "@/src/domain/queue/state"
import type { ActiveTaskProgress as ActiveTaskProgressState } from "../hooks/useActiveTaskProgress"
import type { CancelTaskResult } from "../types"
import type { StorageReadStatus } from "@/src/ui/shared/hooks/useChromeStorageValue"
import type { CommandCenterTaskActionHandler } from "./command-center-queue-helpers"
import {
  CommandCenterQueue,
  type CommandCenterQueueProps,
} from "./CommandCenterQueue"
import { QueueReadNotice } from "@/src/ui/shared/QueueReadNotice"
import { queueCommandClient } from "@/src/ui/shared/queue-command-client"
import { t } from "@/src/runtime/i18n"

interface SidePanelQueueRegionProps {
  queueTasks: QueueTaskSummary[]
  historyTasks: QueueTaskSummary[]
  isLoading: boolean
  readStatus: StorageReadStatus
  onRefresh: () => Promise<void>
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
}

type Commands = Omit<CommandCenterQueueProps, "tasks">
function WaitingTasks({
  tasks,
  commands,
  scroll,
}: {
  tasks: QueueTaskSummary[]
  commands: Commands
  scroll: HTMLDivElement | null
}) {
  const list = useRef<HTMLDivElement>(null)
  const scrollRef = useMemo(() => ({ current: scroll }), [scroll])
  const scrollMargin = usePanelScrollMargin(scroll, list)
  usePanelLayoutMotion(
    scrollRef,
    "[data-task-id]",
    tasks.map((task) => task.id).join(",")
  )
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: tasks.length,
    getScrollElement: () => scroll,
    getItemKey: (index) => tasks[index].id,
    scrollMargin,
    // Wrapped text can have fractional height; rounding down overlaps rows.
    measureElement: (element, entry) =>
      Math.ceil(entry?.borderBoxSize?.[0]?.blockSize ?? element.offsetHeight),
    estimateSize: () => 74,
    overscan: 8,
  })
  return (
    <div ref={list} className="waiting-tasks">
      {tasks.length <= 24 ? (
        <CommandCenterQueue {...commands} tasks={tasks} />
      ) : (
        <div
          style={{ height: virtualizer.getTotalSize(), position: "relative" }}
        >
          {virtualizer.getVirtualItems().map((item) => (
            <div
              key={item.key}
              ref={virtualizer.measureElement}
              data-index={item.index}
              style={{
                position: "absolute",
                top: 0,
                width: "100%",
                transform: "translateY(" + (item.start - scrollMargin) + "px)",
              }}
            >
              <CommandCenterQueue {...commands} tasks={[tasks[item.index]]} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
export function SidePanelQueueRegion(props: SidePanelQueueRegionProps) {
  const [scroll, setScroll] = useState<HTMLDivElement | null>(null)
  const [moving, setMoving] = useState(false)
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null)
  const dragOrder = useRef<string[] | null>(null)
  const active = props.queueTasks.filter(
    (task) => task.status === "downloading"
  )
  const queued = props.queueTasks.filter((task) => task.status === "queued")
  const attention = props.historyTasks.filter(
    (task) => task.status !== "completed" || task.saveConfirmedAt === undefined
  )
  const ids = queued.map((task) => task.id)
  const reorder = async (taskId: string, position: number, expected = ids) => {
    const current = expected.indexOf(taskId)
    if (moving || current === -1 || position < 1 || position > expected.length)
      return
    const next = expected.filter((id) => id !== taskId)
    next.splice(position - 1, 0, taskId)
    setMoving(true)
    try {
      await queueCommandClient.reorderQueuedTasks(expected, next)
    } catch {
      toast.error(t("sidepanel_queueChanged"))
      await props.onRefresh()
    } finally {
      setMoving(false)
    }
  }
  const commands: Commands = {
    ...props,
    firstQueuedTaskId: ids[0],
    queuedTaskIds: ids,
    onReorder: reorder,
    movingTaskIds: moving ? new Set(ids) : props.movingTaskIds,
  }
  return (
    <div
      className="queue-region"
      ref={setScroll}
      data-queue-scroll-container
      data-sidepanel-queue-region
      onDragStart={(event) => {
        if (
          !(event.target instanceof Element) ||
          !event.target.closest(".task-grip")
        )
          return
        const task = event.target.closest<HTMLElement>("[data-task-id]")
        if (!task) return
        dragOrder.current = ids
        event.dataTransfer.effectAllowed = "move"
        event.dataTransfer.setData("text/plain", task.dataset.taskId!)
      }}
      onDragOver={(event) => {
        if (!dragOrder.current || !(event.target instanceof Element)) return
        const row = event.target.closest<HTMLElement>('[data-queued="true"]')
        if (!row) return
        event.preventDefault()
        const rect = row.getBoundingClientRect()
        const after = event.clientY > rect.top + rect.height / 2
        setDrop({ id: row.dataset.taskId!, after })
      }}
      onDrop={(event) => {
        event.preventDefault()
        const order = dragOrder.current
        const row =
          event.target instanceof Element
            ? event.target.closest<HTMLElement>('[data-queued="true"]')
            : null
        if (order && row) {
          const source = event.dataTransfer.getData("text/plain")
          const remaining = order.filter((id) => id !== source)
          const index = remaining.indexOf(row.dataset.taskId!)
          const bounds = row.getBoundingClientRect()
          const after = event.clientY > bounds.top + bounds.height / 2
          // Dragover is continuous; its visual state may not commit before drop.
          if (index >= 0) void reorder(source, index + (after ? 2 : 1), order)
        }
        dragOrder.current = null
        setDrop(null)
      }}
      onDragEnd={() => {
        dragOrder.current = null
        setDrop(null)
      }}
      data-drop-id={drop?.id}
      data-drop-after={drop?.after}
    >
      {drop && (
        <style>
          {'[data-task-id="' +
            CSS.escape(drop.id) +
            '"]{box-shadow:inset 0 ' +
            (drop.after ? "-2" : "2") +
            "px var(--primary)}"}
        </style>
      )}
      <QueueReadNotice status={props.readStatus} onRetry={props.onRefresh} />
      {props.isLoading ? (
        <p className="panel-empty" role="status" aria-busy="true">
          {t("common_loading")}
        </p>
      ) : (
        <>
          <div className="queue-current">
            <h2 className="queue-section-label">{t("sidepanel_inProgress")}</h2>
            {active.length ? (
              <CommandCenterQueue {...commands} tasks={active} />
            ) : (
              <p className="panel-empty">{t("sidepanel_noActiveDownloads")}</p>
            )}
            {attention.length > 0 && (
              <section>
                <h2 className="queue-section-label">
                  {t("sidepanel_needsAttention")}
                </h2>
                <CommandCenterQueue {...commands} tasks={attention} />
              </section>
            )}
          </div>
          {queued.length > 0 && (
            <>
              <h2 className="queue-section-label">{t("sidepanel_upNext")}</h2>
              <WaitingTasks
                tasks={queued}
                commands={commands}
                scroll={scroll}
              />
            </>
          )}
        </>
      )}
    </div>
  )
}
