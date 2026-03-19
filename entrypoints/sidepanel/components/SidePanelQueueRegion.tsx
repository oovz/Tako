import { useRef } from 'react'

import { useVirtualizer } from '@tanstack/react-virtual'

import { cn } from '@/src/shared/utils'
import { HistorySection } from '@/entrypoints/sidepanel/components/HistorySection'
import { CommandCenterQueue } from '@/entrypoints/sidepanel/components/CommandCenterQueue'
import type { ActiveTaskProgress as ActiveTaskProgressState } from '@/entrypoints/sidepanel/hooks/useActiveTaskProgress'
import type { QueueTaskSummary } from '@/src/types/queue-state'

interface SidePanelQueueRegionProps {
  activeTasks: QueueTaskSummary[]
  queuedTasks: QueueTaskSummary[]
  historyTasks: QueueTaskSummary[]
  isLoading: boolean
  isInlineSelectionOpen: boolean
  cancelingTaskIds: Set<string>
  activeTaskProgress: ActiveTaskProgressState | null
  showActiveProgress: boolean
  onCancelTask: (taskId: string) => void | Promise<void>
  onRetryFailed: (taskId: string) => void | Promise<void>
  onRestartTask: (taskId: string) => void | Promise<void>
  onMoveTaskToTop: (taskId: string) => void | Promise<void>
  onRemoveTask: (taskId: string) => void | Promise<void>
  onViewFullHistory: () => void | Promise<void>
}

export function SidePanelQueueRegion({
  activeTasks,
  queuedTasks,
  historyTasks,
  isLoading,
  isInlineSelectionOpen,
  cancelingTaskIds,
  activeTaskProgress,
  showActiveProgress,
  onCancelTask,
  onRetryFailed,
  onRestartTask,
  onMoveTaskToTop,
  onRemoveTask,
  onViewFullHistory,
}: SidePanelQueueRegionProps) {
  const queueScrollRef = useRef<HTMLDivElement | null>(null)

  const queueVirtualizer = useVirtualizer({
    count: queuedTasks.length,
    getScrollElement: () => queueScrollRef.current,
    estimateSize: () => 78,
    overscan: 4,
  })

  const hasAnyTask = activeTasks.length > 0 || queuedTasks.length > 0 || historyTasks.length > 0

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col bg-background', isInlineSelectionOpen && 'flex-shrink-0')}>
      {isLoading && (
        <div className="space-y-2 p-3" aria-label="queue-loading-skeleton">
          <div className="h-16 animate-pulse rounded-md border border-border/60 bg-muted/30" />
          <div className="h-16 animate-pulse rounded-md border border-border/60 bg-muted/30" />
          <div className="h-16 animate-pulse rounded-md border border-border/60 bg-muted/30" />
        </div>
      )}

      {!isLoading && activeTasks.length > 0 && (
        <div className="flex-shrink-0 border-y border-border/50">
          <CommandCenterQueue
            tasks={activeTasks}
            activeTaskProgress={activeTaskProgress}
            showActiveProgress={showActiveProgress}
            onCancelTask={onCancelTask}
            cancelingTaskIds={cancelingTaskIds}
            onRetryFailed={onRetryFailed}
            onRestartTask={onRestartTask}
            onRemoveTask={onRemoveTask}
          />
        </div>
      )}

      {!isLoading && queuedTasks.length > 0 && (
        <div ref={queueScrollRef} className="min-h-0 flex-1 overflow-y-auto border-b border-border/50">
          <div
            style={{
              height: `${queueVirtualizer.getTotalSize()}px`,
              position: 'relative',
            }}
          >
            {queueVirtualizer.getVirtualItems().map((item) => {
              const task = queuedTasks[item.index]
              if (!task) return null

              return (
                <div
                  key={task.id}
                  data-index={item.index}
                  ref={queueVirtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${item.start}px)`,
                  }}
                >
                  <CommandCenterQueue
                    tasks={[task]}
                    onCancelTask={onCancelTask}
                    cancelingTaskIds={cancelingTaskIds}
                    onMoveTaskToTop={onMoveTaskToTop}
                  />
                </div>
              )
            })}
          </div>
        </div>
      )}

      {!isLoading && (
        <HistorySection
          tasks={historyTasks}
          isInlineSelectionOpen={isInlineSelectionOpen}
          onViewFullHistory={onViewFullHistory}
          onRetryFailed={onRetryFailed}
          onRestartTask={onRestartTask}
          onRemoveTask={onRemoveTask}
        />
      )}

      {!isLoading && isInlineSelectionOpen && !hasAnyTask && (
        <div className="px-3 py-3 bg-muted/20 border-t border-border/50">
          <p className="text-xs text-muted-foreground text-center">
            Select chapters above and click Download to add to queue
          </p>
        </div>
      )}

      {!isLoading && !isInlineSelectionOpen && !hasAnyTask && (
        <div className="p-6 text-center">
          <h3 className="font-medium text-sm mb-1">No downloads yet</h3>
          <p className="text-xs text-muted-foreground">
            Use "Select Chapters" above to start downloading
          </p>
        </div>
      )}
    </div>
  )
}

