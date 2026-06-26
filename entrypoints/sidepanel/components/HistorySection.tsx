import React from 'react'

import { CommandCenterQueue } from '@/entrypoints/sidepanel/components/CommandCenterQueue'
import type { QueueTaskSummary } from '@/src/types/queue-state'
import { t } from '@/src/shared/i18n'

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
    <section
      aria-labelledby="sidepanel-recent-history-title"
      className="min-h-0 flex-shrink overflow-y-auto border-t border-border/60"
    >
      <div className="flex items-center justify-between px-3 py-2 bg-muted/20">
        <h2
          id="sidepanel-recent-history-title"
          className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
        >
          {t('sidepanel_recentHistory')}
        </h2>
        {!isInlineSelectionOpen && (
          <button
            type="button"
            onClick={onViewFullHistory}
            className="text-[10px] text-muted-foreground hover:text-foreground"
          >
            {t('sidepanel_viewFullHistory')}
          </button>
        )}
      </div>
      <CommandCenterQueue
        tasks={tasks.slice(0, 5)}
        onRetryFailed={onRetryFailed}
        onRestartTask={onRestartTask}
        onRemoveTask={onRemoveTask}
      />
    </section>
  )
}

