import { cn } from '@/src/shared/utils'

import type { ActiveTaskProgress as ActiveTaskProgressState } from '@/entrypoints/sidepanel/hooks/useActiveTaskProgress'
import { getSiteIntegrationDisplayName } from '@/src/site-integrations/manifest'
import { Badge } from '@/components/ui/badge'
import { ActiveTaskProgress } from '@/entrypoints/sidepanel/components/ActiveTaskProgress'
import { CommandCenterTaskActions } from '@/entrypoints/sidepanel/components/CommandCenterTaskActions'
import { InlineConfirmation } from '@/src/ui/shared/components/InlineConfirmation'
import {
  getRetryAvailability,
  getTaskActionAvailability,
  getTaskFailureMessage,
  getTaskProgressPresentation,
  getTaskStatusIcon,
  getTaskStatusLabel,
} from '@/entrypoints/sidepanel/components/command-center-queue-helpers'
import type { QueueTaskSummary } from '@/src/types/queue-state'

interface CommandCenterTaskRowProps {
  task: QueueTaskSummary
  isCanceling: boolean
  isConfirmingCancel: boolean
  coverFailed: boolean
  activeTaskProgress: ActiveTaskProgressState | null | undefined
  showActiveProgress: boolean
  onBeginCancel: (taskId: string) => void
  onConfirmCancel: (taskId: string) => void
  onDismissCancel: () => void
  onCoverError: (taskId: string) => void
  onCancelTask?: (taskId: string) => void
  onRetryFailed?: (taskId: string) => void
  onRestartTask?: (taskId: string) => void
  onMoveTaskToTop?: (taskId: string) => void
  onRemoveTask?: (taskId: string) => void
}

export function CommandCenterTaskRow({
  task,
  isCanceling,
  isConfirmingCancel,
  coverFailed,
  activeTaskProgress,
  showActiveProgress,
  onBeginCancel,
  onConfirmCancel,
  onDismissCancel,
  onCoverError,
  onCancelTask,
  onRetryFailed,
  onRestartTask,
  onMoveTaskToTop,
  onRemoveTask,
}: CommandCenterTaskRowProps) {
  const totalChapters = task.chapters.total
  const { canRetryFailed, retryBlockedMessage } = getRetryAvailability(task, !!onRetryFailed)
  const {
    canCancel,
    isTaskHistory,
    isRetried,
    canRestart,
    canMoveToTop,
    canRemove,
  } = getTaskActionAvailability(task, {
    hasCancelHandler: !!onCancelTask,
    isCanceling,
    hasRestartHandler: !!onRestartTask,
    hasMoveToTopHandler: !!onMoveTaskToTop,
    hasRemoveHandler: !!onRemoveTask,
  })

  const isActive = task.status === 'downloading'
  const { showProgressInRow, activeRowChapterCount } = getTaskProgressPresentation(
    task,
    activeTaskProgress,
    showActiveProgress,
  )

  const failureMessage = getTaskFailureMessage(task)
  const fallbackCoverUrl = chrome.runtime.getURL('icon/128.png')
  const coverSrc = task.coverUrl && !coverFailed
    ? task.coverUrl
    : fallbackCoverUrl

  const icon = getTaskStatusIcon(task.status)

  return (
    <>
      {/* Task Row - Reference UX style with hover-reveal actions */}
      <div
        className={cn(
          'group relative flex items-center gap-2.5 px-3 py-2 border-b border-border/50',
          'transition-colors duration-100',
          'hover:bg-muted/30',
          isActive && 'bg-muted/40 border-l-2 border-l-foreground',
        )}
      >
        {isConfirmingCancel && (
          <InlineConfirmation
            title="Cancel this download?"
            description="Progress for in-flight chapter may be lost."
            onConfirm={() => {
              onConfirmCancel(task.id)
            }}
            onCancel={onDismissCancel}
          />
        )}

        {/* Thumbnail */}
        <div className="h-10 w-7 shrink-0 overflow-hidden rounded bg-muted shadow-sm border border-border/50">
          <img
            src={coverSrc}
            alt=""
            className="h-full w-full object-cover"
            onError={() => {
              if (!task.coverUrl || coverFailed) {
                return
              }

              onCoverError(task.id)
            }}
            draggable={false}
          />
        </div>

        <div
          className={cn(
            'flex min-w-0 flex-1 items-center gap-2.5 transition-opacity duration-150',
            isTaskHistory && 'opacity-70 group-hover:opacity-100',
          )}
        >
          {/* Content */}
          <div className="flex-1 min-w-0 space-y-0.5">
            <div className="flex items-center gap-1.5">
              <h3 className="font-semibold text-sm truncate" title={task.seriesTitle}>
                {task.seriesTitle}
              </h3>
              <Badge variant="outline" className="text-[9px] h-4 px-1.5 py-0 font-normal shrink-0">
                {getSiteIntegrationDisplayName(task.siteIntegration)}
              </Badge>
            </div>

            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                {icon}
                <span className="capitalize">{getTaskStatusLabel(task.status)}</span>
              </span>
              <span>·</span>
              <span className="font-mono">
                {activeRowChapterCount}/{totalChapters} ch
              </span>
            </div>

            {/* Failure message */}
            {failureMessage && (
              <div className="text-[9px] text-destructive truncate select-text" title={task.failureReason}>
                {failureMessage}
              </div>
            )}

            {/* Retry blocked message for failed tasks */}
            {retryBlockedMessage && (
              <div className="text-[9px] text-muted-foreground">
                {retryBlockedMessage}
              </div>
            )}
          </div>

          <CommandCenterTaskActions
            taskId={task.id}
            status={task.status}
            isRetried={isRetried}
            isCanceling={isCanceling}
            canCancel={canCancel}
            canRetryFailed={canRetryFailed}
            canRestart={canRestart}
            canMoveToTop={canMoveToTop}
            canRemove={canRemove}
            onBeginCancel={onBeginCancel}
            onRetryFailed={onRetryFailed}
            onRestartTask={onRestartTask}
            onMoveTaskToTop={onMoveTaskToTop}
            onRemoveTask={onRemoveTask}
          />
        </div>
      </div>

      {showProgressInRow && (
        <div className="border-b border-border/50">
          <ActiveTaskProgress task={task} progress={activeTaskProgress ?? null} />
        </div>
      )}
    </>
  )
}

