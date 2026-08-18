import React from "react"

import { CommandCenterQueue } from "@/entrypoints/sidepanel/components/CommandCenterQueue"
import type { QueueTaskSummary } from "@/src/domain/queue/state"
import { t } from "@/src/runtime/i18n"

export interface HistorySectionProps {
  tasks: QueueTaskSummary[]
  isInlineSelectionOpen: boolean
  onViewFullHistory: () => void
  onRetryFailed: (taskId: string) => void
  onRestartTask: (taskId: string) => void
  onRemoveTask: (taskId: string) => void
  retryingTaskIds?: Set<string>
  restartingTaskIds?: Set<string>
  removingTaskIds?: Set<string>
}

export function HistorySection({
  tasks,
  isInlineSelectionOpen,
  onViewFullHistory,
  onRetryFailed,
  onRestartTask,
  onRemoveTask,
  retryingTaskIds,
  restartingTaskIds,
  removingTaskIds,
}: HistorySectionProps) {
  if (tasks.length === 0) {
    return null
  }

  return (
    <section
      aria-labelledby="sidepanel-recent-history-title"
      className="min-h-[98px] max-h-[50%] shrink-0 overflow-y-auto border-t border-border/60"
    >
      <div className="flex items-center justify-between px-3 py-2 bg-muted/20">
        <h2
          id="sidepanel-recent-history-title"
          className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
        >
          {t("sidepanel_recentHistory")}
        </h2>
        {!isInlineSelectionOpen && (
          <button
            type="button"
            onClick={onViewFullHistory}
            className="text-[10px] text-muted-foreground hover:text-foreground transition-all duration-150 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded"
          >
            {t("sidepanel_viewFullHistory")}
          </button>
        )}
      </div>
      <CommandCenterQueue
        tasks={tasks.slice(0, 5)}
        onRetryFailed={onRetryFailed}
        onRestartTask={onRestartTask}
        onRemoveTask={onRemoveTask}
        retryingTaskIds={retryingTaskIds}
        restartingTaskIds={restartingTaskIds}
        removingTaskIds={removingTaskIds}
      />
    </section>
  )
}
