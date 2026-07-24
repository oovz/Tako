import { useRef, useState } from "react"
import type { ReactNode } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"

import { DownloadTaskCard } from "@/entrypoints/options/components/DownloadTaskCard"
import type { DownloadTaskState } from "@/src/types/queue-state"
import type { DownloadTaskActionResult } from "@/entrypoints/options/download-task-actions"

interface DownloadTaskSectionProps {
  icon: ReactNode
  tasks: DownloadTaskState[]
  title: string
  titleClassName?: string
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
  onCancel,
  onRetry,
  onRestart,
  onRemove,
}: DownloadTaskSectionProps) {
  const parentRef = useRef<HTMLDivElement>(null)
  const [expandedTaskIds, setExpandedTaskIds] = useState<
    Record<string, boolean>
  >({})
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
  })

  if (tasks.length === 0) {
    return null
  }

  return (
    <div className="flex flex-col gap-4">
      <h2
        className={`flex items-center gap-2 text-sm font-medium uppercase tracking-wider text-muted-foreground ${titleClassName ?? ""}`.trim()}
      >
        {icon}
        {title} ({tasks.length})
      </h2>
      {tasks.length > 50 ? (
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
                  <DownloadTaskCard
                    task={task}
                    isChapterListExpanded={expandedTaskIds[task.id] === true}
                    onChapterListExpandedChange={(expanded) =>
                      setTaskExpanded(task.id, expanded)
                    }
                    onCancel={onCancel}
                    onRetry={onRetry}
                    onRestart={onRestart}
                    onRemove={onRemove}
                  />
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="grid gap-4">
          {tasks.map((task) => (
            <DownloadTaskCard
              key={task.id}
              task={task}
              isChapterListExpanded={expandedTaskIds[task.id] === true}
              onChapterListExpandedChange={(expanded) =>
                setTaskExpanded(task.id, expanded)
              }
              onCancel={onCancel}
              onRetry={onRetry}
              onRestart={onRestart}
              onRemove={onRemove}
            />
          ))}
        </div>
      )}
    </div>
  )
}
