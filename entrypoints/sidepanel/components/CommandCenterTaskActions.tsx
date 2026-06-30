import { ArrowUp, Loader2, RotateCcw, Trash2, XCircle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { QueueTaskSummary } from '@/src/types/queue-state'
import { t } from '@/src/runtime/i18n'

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
        <Button aria-label={t('sidepanel_cancelingDownload')} variant="ghost" size="icon" className="size-6" disabled>
          <Loader2 aria-hidden="true" data-icon="inline-start" className="animate-spin" />
        </Button>
      ) : canCancel ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={t('common_cancel')}
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              onClick={() => onBeginCancel(taskId)}
            >
              <XCircle aria-hidden="true" data-icon="inline-start" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left" className="text-xs">
            {t('sidepanel_cancelDownload')}
          </TooltipContent>
        </Tooltip>
      ) : null}

      {status === 'partial_success' && !isRetried && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={t('sidepanel_retryFailed')}
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
            {t('sidepanel_retryFailedChapters')}
          </TooltipContent>
        </Tooltip>
      )}

      {canRestart && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={t('sidepanel_restartTask')}
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => onRestartTask?.(taskId)}
            >
              <RotateCcw aria-hidden="true" data-icon="inline-start" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left" className="text-xs">
            {t('sidepanel_restartAllChapters')}
          </TooltipContent>
        </Tooltip>
      )}

      {canMoveToTop && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={t('sidepanel_moveTaskToTop')}
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => onMoveTaskToTop?.(taskId)}
            >
              <ArrowUp aria-hidden="true" data-icon="inline-start" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left" className="text-xs">
            {t('sidepanel_moveToTop')}
          </TooltipContent>
        </Tooltip>
      )}

      {canRemove && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={t('common_remove')}
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              onClick={() => onRemoveTask?.(taskId)}
            >
              <Trash2 aria-hidden="true" data-icon="inline-start" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left" className="text-xs">
            {t('common_remove')}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}
