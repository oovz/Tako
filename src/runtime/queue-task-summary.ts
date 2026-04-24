import type { DownloadTaskState, QueueTaskSummary } from '@/src/types/queue-state'

function classifyFailureCategory(errorMessage: string | undefined): QueueTaskSummary['failureCategory'] {
  if (!errorMessage) return undefined

  const msg = errorMessage.toLowerCase()

  if (
    msg.includes('network') ||
    msg.includes('timeout') ||
    msg.includes('dns') ||
    msg.includes('unreachable') ||
    msg.includes('offline') ||
    msg.includes('connection') ||
    msg.includes('econn') ||
    msg.includes('enet')
  ) {
    return 'network'
  }

  if (
    msg.includes('chapter') ||
    msg.includes('download') ||
    msg.includes('file') ||
    msg.includes('archive') ||
    msg.includes('zip') ||
    msg.includes('cbz') ||
    msg.includes('image') ||
    msg.includes('page')
  ) {
    return 'download'
  }

  return undefined
}

export function composeSeriesKey(siteId: string, seriesId: string): string {
  return `${siteId}#${seriesId}`
}

export function toQueueTaskSummary(task: DownloadTaskState): QueueTaskSummary {
  const totalChapters = task.chapters.length
  let completedChapters = 0
  let unsuccessfulChapters = 0

  for (const chapter of task.chapters) {
    if (chapter.status === 'completed') {
      completedChapters += 1
    } else if (chapter.status === 'failed' || chapter.status === 'partial_success') {
      unsuccessfulChapters += 1
    }
  }

  const failureReason = task.errorMessage
  const failureCategory = task.errorCategory ?? classifyFailureCategory(failureReason)

  return {
    id: task.id,
    seriesKey: composeSeriesKey(task.siteIntegrationId, task.mangaId),
    seriesTitle: task.seriesTitle,
    siteIntegration: task.siteIntegrationId,
    coverUrl: task.seriesCoverUrl,
    status: task.status,
    chapters: {
      total: totalChapters,
      completed: completedChapters,
      unsuccessful: unsuccessfulChapters,
    },
    timestamps: {
      created: task.created,
      completed: task.completed,
    },
    failureReason,
    failureCategory,
    isRetried: task.isRetried ?? false,
    isRetryTask: task.isRetryTask ?? false,
    lastSuccessfulDownloadId: task.lastSuccessfulDownloadId,
  }
}
