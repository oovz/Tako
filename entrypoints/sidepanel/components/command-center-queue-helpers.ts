import { createElement, type ReactNode } from 'react'

import { CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react'

import type { ActiveTaskProgress as ActiveTaskProgressState } from '@/entrypoints/sidepanel/hooks/useActiveTaskProgress'
import type { QueueTaskSummary } from '@/src/types/queue-state'

export interface CommandCenterTaskActionAvailability {
  canCancel: boolean
  isTaskHistory: boolean
  isRetried: boolean
  canRestart: boolean
  canMoveToTop: boolean
  canRemove: boolean
}

export interface CommandCenterTaskProgressPresentation {
  showProgressInRow: boolean
  activeRowChapterCount: number
}

export function getRetryAvailability(
  task: QueueTaskSummary,
  hasRetryHandler: boolean,
): { canRetryFailed: boolean; retryBlockedMessage: string | null } {
  const isRetryableStatus = task.status === 'partial_success'
  const isRetried = task.isRetried === true

  if (!isRetryableStatus || task.chapters.unsuccessful === 0 || !hasRetryHandler || isRetried) {
    return { canRetryFailed: false, retryBlockedMessage: null }
  }

  return { canRetryFailed: true, retryBlockedMessage: null }
}

export function getTaskStatusLabel(status: QueueTaskSummary['status']): string {
  switch (status) {
    case 'downloading':
      return 'Downloading'
    case 'queued':
      return 'Queued'
    case 'completed':
      return 'Completed'
    case 'partial_success':
      return 'Partial'
    case 'failed':
      return 'Failed'
    case 'canceled':
      return 'Canceled'
    default:
      return status
  }
}

export function getTaskStatusIcon(status: QueueTaskSummary['status']): ReactNode {
  switch (status) {
    case 'downloading':
      return createElement(Loader2, { className: 'h-2.5 w-2.5 animate-spin' })
    case 'queued':
      return createElement(Clock, { className: 'h-2.5 w-2.5' })
    case 'completed':
      return createElement(CheckCircle2, { className: 'h-2.5 w-2.5 text-emerald-600' })
    case 'partial_success':
      return createElement(CheckCircle2, { className: 'h-2.5 w-2.5 text-amber-600' })
    case 'failed':
      return createElement(XCircle, { className: 'h-2.5 w-2.5 text-destructive' })
    case 'canceled':
      return createElement(XCircle, { className: 'h-2.5 w-2.5 text-muted-foreground' })
    default:
      return null
  }
}

export function getTaskActionAvailability(
  task: QueueTaskSummary,
  options: {
    hasCancelHandler: boolean
    isCanceling: boolean
    hasRestartHandler: boolean
    hasMoveToTopHandler: boolean
    hasRemoveHandler: boolean
  },
): CommandCenterTaskActionAvailability {
  const isTaskHistory =
    task.status === 'completed'
    || task.status === 'partial_success'
    || task.status === 'failed'
    || task.status === 'canceled'
  const isRetried = task.isRetried === true

  return {
    canCancel:
      (task.status === 'downloading' || task.status === 'queued')
      && options.hasCancelHandler
      && !options.isCanceling,
    isTaskHistory,
    isRetried,
    canRestart:
      options.hasRestartHandler
      && !isRetried
      && (task.status === 'partial_success' || task.status === 'failed' || task.status === 'canceled'),
    canMoveToTop: options.hasMoveToTopHandler && task.status === 'queued',
    canRemove: isTaskHistory && options.hasRemoveHandler,
  }
}

export function getTaskProgressPresentation(
  task: QueueTaskSummary,
  activeTaskProgress: ActiveTaskProgressState | null | undefined,
  showActiveProgress: boolean,
): CommandCenterTaskProgressPresentation {
  const showProgressInRow =
    task.status === 'downloading'
    && showActiveProgress
    && !!activeTaskProgress
    && activeTaskProgress.taskId === task.id
  const inFlightChapterCount = showProgressInRow
    ? Math.max(1, activeTaskProgress?.activeChapterCount ?? activeTaskProgress?.activeChapters?.length ?? 1)
    : 0

  return {
    showProgressInRow,
    activeRowChapterCount:
      task.status === 'downloading'
        ? Math.min(task.chapters.total, task.chapters.completed + inFlightChapterCount)
        : task.chapters.completed,
  }
}

export function getTaskFailureMessage(task: QueueTaskSummary): string | undefined {
  const failurePrefix =
    task.failureCategory === 'network'
      ? 'Network: '
      : task.failureCategory === 'download'
        ? 'Download: '
        : ''

  return task.failureReason
    ? `${failurePrefix}${task.failureReason}`
    : undefined
}
