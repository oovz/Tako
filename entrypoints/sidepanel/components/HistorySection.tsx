import React from 'react'

import { CommandCenterQueue } from '@/entrypoints/sidepanel/components/CommandCenterQueue'
import type { QueueTaskSummary } from '@/src/types/queue-state'

export interface HistorySectionProps {
  tasks: QueueTaskSummary[]
  isInlineSelectionOpen: boolean
  onViewFullHistory: () => void
  onRetryFailed: (taskId: string) => void
  onRestartTask: (taskId: string) => void
  onRemoveTask: (taskId: string) => void
}

export function HistorySection({
  tasks,
  isInlineSelectionOpen,
  onViewFullHistory,
  onRetryFailed,
  onRestartTask,
  onRemoveTask,
}: HistorySectionProps) {
  if (tasks.length === 0) {
    return null
  }

  return (
    <div className="max-h-56 flex-shrink-0 overflow-y-auto border-t border-border/60">
      <div className="flex items-center justify-between px-3 py-2 bg-muted/20">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Recent history
        </div>
        {!isInlineSelectionOpen && (
          <button
            type="button"
            onClick={onViewFullHistory}
            className="text-[10px] text-muted-foreground hover:text-foreground"
          >
            View Full History
          </button>
        )}
      </div>
      <CommandCenterQueue
        tasks={tasks.slice(0, 5)}
        onRetryFailed={onRetryFailed}
        onRestartTask={onRestartTask}
        onRemoveTask={onRemoveTask}
      />
    </div>
  )
}

