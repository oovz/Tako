import React, { useState } from 'react'

import type { ActiveTaskProgress as ActiveTaskProgressState } from '@/entrypoints/sidepanel/hooks/useActiveTaskProgress'
import { TooltipProvider } from '@/components/ui/tooltip'
import { CommandCenterTaskRow } from '@/entrypoints/sidepanel/components/CommandCenterTaskRow'
import type { QueueTaskSummary } from '@/src/types/queue-state'

export interface CommandCenterQueueProps {
  tasks: QueueTaskSummary[]
  onCancelTask?: (taskId: string) => void
  cancelingTaskIds?: Set<string>
  onRetryFailed?: (taskId: string) => void
  onRestartTask?: (taskId: string) => void
  onMoveTaskToTop?: (taskId: string) => void
  onRemoveTask?: (taskId: string) => void
  emptyState?: React.ReactNode
  historyOffset?: number
  onViewFullHistory?: () => void
  activeTaskProgress?: ActiveTaskProgressState | null
  showActiveProgress?: boolean
}

export { getRetryAvailability } from '@/entrypoints/sidepanel/components/command-center-queue-helpers'

export function CommandCenterQueue({
  tasks,
  onCancelTask,
  cancelingTaskIds,
  onRetryFailed,
  onRestartTask,
  onMoveTaskToTop,
  onRemoveTask,
  emptyState,
  historyOffset,
  onViewFullHistory,
  activeTaskProgress,
  showActiveProgress = false,
}: CommandCenterQueueProps) {
  const [confirmingCancelTaskId, setConfirmingCancelTaskId] = useState<string | null>(null)
  const [coverLoadFailures, setCoverLoadFailures] = useState<Record<string, true>>({})

  if (tasks.length === 0) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        {emptyState ?? 'No downloads yet. Start a download from any supported series tab to see it here.'}
      </div>
    )
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div>
        {tasks.map((task, index) => {
          const isCanceling = cancelingTaskIds?.has(task.id) ?? false

          const isHistoryStart = typeof historyOffset === 'number' && index === historyOffset

          return (
            <div key={task.id}>
              {isHistoryStart && (
                <div className="flex items-center justify-between px-3 py-2 bg-muted/20">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Recent history
                  </div>
                  {onViewFullHistory && (
                    <button
                      type="button"
                      onClick={onViewFullHistory}
                      className="text-[10px] text-muted-foreground hover:text-foreground"
                    >
                      View All
                    </button>
                  )}
                </div>
              )}
              <CommandCenterTaskRow
                task={task}
                isCanceling={isCanceling}
                isConfirmingCancel={confirmingCancelTaskId === task.id}
                coverFailed={coverLoadFailures[task.id] === true}
                activeTaskProgress={activeTaskProgress}
                showActiveProgress={showActiveProgress}
                onBeginCancel={setConfirmingCancelTaskId}
                onConfirmCancel={(taskId) => {
                  onCancelTask?.(taskId)
                  setConfirmingCancelTaskId(null)
                }}
                onDismissCancel={() => setConfirmingCancelTaskId(null)}
                onCoverError={(taskId) => {
                  setCoverLoadFailures((previousFailures) => ({
                    ...previousFailures,
                    [taskId]: true,
                  }))
                }}
                onCancelTask={onCancelTask}
                onRetryFailed={onRetryFailed}
                onRestartTask={onRestartTask}
                onMoveTaskToTop={onMoveTaskToTop}
                onRemoveTask={onRemoveTask}
              />
            </div>
          )
        })}
      </div>
    </TooltipProvider>
  )
}

