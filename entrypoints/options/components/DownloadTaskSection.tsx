import { useCallback, useRef, useState } from "react"
import type { ReactNode } from "react"
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual"

import { DownloadTaskCard } from "@/entrypoints/options/components/DownloadTaskCard"
import type { DownloadTaskState } from "@/src/domain/queue/state"
import type { DownloadTaskActionResult } from "@/entrypoints/options/types/download-task-actions"

export interface TaskFocusRequest {
  taskId: string
  reveal: (card: HTMLDivElement, scrollIntoView: () => void) => void
}

interface DownloadTaskSectionProps {
  icon: ReactNode
  tasks: DownloadTaskState[]
  title: string
  titleClassName?: string
  taskFocus?: TaskFocusRequest
  onCancel: (taskId: string) => Promise<DownloadTaskActionResult>
  onRetry: (taskId: string) => Promise<void>
  onRestart: (taskId: string) => Promise<void>
  onRemove: (taskId: string) => Promise<void>
}

export function DownloadTaskSection({
  icon,
  tasks,
  title,
  titleClassName,
  taskFocus,
  onCancel,
  onRetry,
  onRestart,
  onRemove,
}: DownloadTaskSectionProps) {
  const parentRef = useRef<HTMLDivElement>(null)
  const [expandedTaskIds, setExpandedTaskIds] = useState<
    Record<string, boolean>
  >({})
  const isVirtual = tasks.length > 50
  const linkedIndex = taskFocus
    ? tasks.findIndex((task) => task.id === taskFocus.taskId)
    : -1
  const setTaskExpanded = (taskId: string, expanded: boolean) => {
    setExpandedTaskIds((current) => {
      if (current[taskId] === expanded) return current
      return { ...current, [taskId]: expanded }
    })
  }
  // React Compiler safely skips this component because TanStack Virtual returns
  // imperative functions whose identities cannot be compiler-memoized.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: tasks.length,
    getScrollElement: () => parentRef.current,
    getItemKey: (index) => tasks[index]?.id ?? index,
    estimateSize: () => 120,
    overscan: 5,
    // Mount a linked card even when it is outside the visible virtual range.
    rangeExtractor: (range) => {
      const indexes = defaultRangeExtractor(range)
      if (linkedIndex < 0 || indexes.includes(linkedIndex)) return indexes
      return [...indexes, linkedIndex].sort((a, b) => a - b)
    },
  })
  const revealTask = taskFocus?.reveal
  const revealLinkedCard = useCallback(
    (card: HTMLDivElement) => {
      revealTask?.(card, () => {
        if (isVirtual) {
          parentRef.current?.scrollIntoView({ block: "center" })
          // Keep the linked index visible as the virtualizer measures rows.
          virtualizer.scrollToIndex(linkedIndex, { align: "center" })
        } else {
          card.scrollIntoView({ block: "nearest" })
        }
      })
    },
    [revealTask, isVirtual, virtualizer, linkedIndex]
  )

  if (tasks.length === 0) {
    return null
  }

  const renderTask = (task: DownloadTaskState) => (
    <DownloadTaskCard
      key={task.id}
      task={task}
      onReveal={taskFocus?.taskId === task.id ? revealLinkedCard : undefined}
      isChapterListExpanded={expandedTaskIds[task.id] === true}
      onChapterListExpandedChange={(expanded) =>
        setTaskExpanded(task.id, expanded)
      }
      onCancel={onCancel}
      onRetry={onRetry}
      onRestart={onRestart}
      onRemove={onRemove}
    />
  )

  return (
    <div className="flex flex-col gap-4">
      <h2
        className={`flex items-center gap-2 text-sm font-medium text-muted-foreground ${titleClassName ?? ""}`.trim()}
      >
        {icon}
        {title} ({tasks.length})
      </h2>
      {isVirtual ? (
        <div ref={parentRef} className="max-h-[600px] overflow-auto">
          <div
            className="relative"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const task = tasks[virtualItem.index]
              return (
                <div
                  key={task.id}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  className="pb-4"
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                >
                  {renderTask(task)}
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="grid gap-4">{tasks.map(renderTask)}</div>
      )}
    </div>
  )
}
