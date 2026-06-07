import { ArrowUp, Loader2, RotateCcw, Trash2, XCircle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { QueueTaskSummary } from '@/src/types/queue-state'

interface CommandCenterTaskActionsProps {
  taskId: string
  status: QueueTaskSummary['status']
  isRetried: boolean
  isCanceling: boolean
  canCancel: boolean
  canRetryFailed: boolean
  canRestart: boolean
  canMoveToTop: boolean
  canRemove: boolean
  onBeginCancel: (taskId: string) => void
  onRetryFailed?: (taskId: string) => void
  onRestartTask?: (taskId: string) => void
  onMoveTaskToTop?: (taskId: string) => void
  onRemoveTask?: (taskId: string) => void
}

export function CommandCenterTaskActions({
  taskId,
  status,
  isRetried,
  isCanceling,
  canCancel,
  canRetryFailed,
  canRestart,
  canMoveToTop,
  canRemove,
  onBeginCancel,
  onRetryFailed,
  onRestartTask,
  onMoveTaskToTop,
  onRemoveTask,
}: CommandCenterTaskActionsProps) {
  return (
    <div className="flex items-center gap-0.5">
      {isCanceling ? (
        <Button aria-label="Canceling download" variant="ghost" size="icon" className="size-6" disabled>
          <Loader2 aria-hidden="true" data-icon="inline-start" className="animate-spin" />
        </Button>
      ) : canCancel ? (
        <Button
          aria-label="Cancel"
          variant="ghost"
          size="icon"
          className="size-6 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          onClick={() => onBeginCancel(taskId)}
        >
          <XCircle aria-hidden="true" data-icon="inline-start" />
        </Button>
      ) : null}

      {status === 'partial_success' && !isRetried && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label="Retry failed"
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => onRetryFailed?.(taskId)}
              disabled={!canRetryFailed}
            >
              <RotateCcw aria-hidden="true" data-icon="inline-start" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left" className="text-xs">
            Retry failed chapters
          </TooltipContent>
        </Tooltip>
      )}

      {canRestart && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label="Restart task"
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => onRestartTask?.(taskId)}
            >
              <RotateCcw aria-hidden="true" data-icon="inline-start" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left" className="text-xs">
            Restart all chapters
          </TooltipContent>
        </Tooltip>
      )}

      {canMoveToTop && (
        <Button
          aria-label="Move task to top"
          variant="ghost"
          size="icon"
          className="size-6 text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={() => onMoveTaskToTop?.(taskId)}
        >
          <ArrowUp aria-hidden="true" data-icon="inline-start" />
        </Button>
      )}

      {canRemove && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label="Remove"
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              onClick={() => onRemoveTask?.(taskId)}
            >
              <Trash2 aria-hidden="true" data-icon="inline-start" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left" className="text-xs">
            Remove
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}
