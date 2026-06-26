import type { DownloadTaskState, TaskChapter } from '@/src/types/queue-state'
import { t } from '@/src/shared/i18n'

export interface DownloadTaskBuckets {
  activeTasks: DownloadTaskState[]
  queuedTasks: DownloadTaskState[]
  completedTasks: DownloadTaskState[]
  failedTasks: DownloadTaskState[]
  canceledTasks: DownloadTaskState[]
  terminalTasks: DownloadTaskState[]
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export function getTerminalTimestampLabel(status: DownloadTaskState['status']): string | null {
  switch (status) {
    case 'completed':
    case 'partial_success':
      return t('options_completedAt')
    case 'failed':
      return t('options_failedAt')
    case 'canceled':
      return t('options_canceledAt')
    default:
      return null
  }
}

function countCompletedChapters(chapters: TaskChapter[]): number {
  return chapters.filter((chapter) => chapter.status === 'completed').length
}

export function getTaskStatusSummaryLabel(task: Pick<DownloadTaskState, 'status' | 'chapters'>): string {
  const completedChapters = countCompletedChapters(task.chapters)
  const totalChapters = task.chapters.length

  switch (task.status) {
    case 'completed':
      return t('options_taskCompleted', [String(totalChapters)])
    case 'failed':
      return t('options_taskFailed', [String(completedChapters), String(totalChapters)])
    case 'canceled':
      return t('options_taskCanceled', [String(completedChapters), String(totalChapters)])
    case 'queued':
      return t('options_taskQueued', [String(totalChapters)])
    case 'downloading':
      return t('options_taskDownloading', [String(completedChapters), String(totalChapters)])
    case 'partial_success':
      return t('options_taskPartial', [String(completedChapters), String(totalChapters)])
    default:
      return t('options_taskDefaultChapters', [String(totalChapters)])
  }
}

export function chapterStatusBadgeClass(status: string): string {
  if (status === 'completed') return 'bg-primary/10 text-primary'
  if (status === 'partial_success') return 'bg-amber-500/20 text-amber-700'
  if (status === 'failed') return 'bg-destructive text-destructive-foreground'
  if (status === 'downloading') return 'bg-primary text-primary-foreground'
  return 'bg-muted text-muted-foreground'
}

export function getTaskStatusBadge(status: DownloadTaskState['status']): { label: string; className: string } {
  switch (status) {
    case 'downloading':
      return { label: t('status_downloading'), className: 'bg-primary text-primary-foreground' }
    case 'queued':
      return { label: t('status_queued'), className: 'bg-secondary text-secondary-foreground' }
    case 'completed':
      return { label: t('status_completed'), className: 'bg-primary/10 text-primary' }
    case 'partial_success':
      return { label: t('options_partial'), className: 'bg-amber-500/20 text-amber-700' }
    case 'failed':
      return { label: t('status_failed'), className: 'bg-destructive text-destructive-foreground' }
    case 'canceled':
      return { label: t('status_canceled'), className: 'bg-muted text-muted-foreground' }
    default:
      return { label: status, className: 'bg-muted text-muted-foreground' }
  }
}

export function formatTaskTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString()
}

export function getChapterImageSummary(chapter: Pick<TaskChapter, 'status' | 'totalImages' | 'imagesFailed'>): string {
  const totalImages = typeof chapter.totalImages === 'number' ? chapter.totalImages : 0
  const imagesFailed = typeof chapter.imagesFailed === 'number' ? chapter.imagesFailed : 0
  const imagesSucceeded = Math.max(0, totalImages - imagesFailed)

  if (totalImages === 0) {
    return '-'
  }

  if (chapter.status === 'partial_success') {
    return t('options_imagesFailed', [String(imagesSucceeded), String(totalImages), String(imagesFailed)])
  }

  return t('options_imagesSummary', [String(imagesSucceeded), String(totalImages)])
}

export function shouldShowChapterError(status: TaskChapter['status']): boolean {
  return status === 'failed' || status === 'partial_success'
}

export function formatChapterStatusLabel(status: TaskChapter['status']): string {
  switch (status) {
    case 'completed':
      return t('status_completed')
    case 'partial_success':
      return t('status_partialSuccess')
    case 'failed':
      return t('status_failed')
    case 'downloading':
      return t('status_downloading')
    case 'queued':
      return t('status_queued')
    default:
      return status
  }
}

export function partitionDownloadTasks(tasks: DownloadTaskState[]): DownloadTaskBuckets {
  const activeTasks = tasks.filter((task) => task.status === 'downloading')
  const queuedTasks = tasks.filter((task) => task.status === 'queued')
  const completedTasks = tasks.filter((task) => task.status === 'completed')
  const failedTasks = tasks.filter((task) => task.status === 'failed' || task.status === 'partial_success')
  const canceledTasks = tasks.filter((task) => task.status === 'canceled')

  return {
    activeTasks,
    queuedTasks,
    completedTasks,
    failedTasks,
    canceledTasks,
    terminalTasks: [...completedTasks, ...failedTasks, ...canceledTasks],
  }
}
