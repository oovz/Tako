import { SESSION_STORAGE_KEYS } from '@/src/runtime/storage-keys'
import { useStorageSubscription } from '@/entrypoints/sidepanel/hooks/useStorageSubscription'
import { isRecord } from '@/src/shared/type-guards'

export interface ActiveTaskProgress {
  taskId: string
  imagesProcessed: number
  totalImages: number
  activeChapterCount: number
  activeChapters: Array<{
    chapterId: string
    chapterTitle?: string
    imagesProcessed: number
    totalImages: number
    updatedAt?: number
  }>
  chapterId?: string
  chapterTitle?: string
  status: 'downloading' | 'completed' | 'failed' | 'partial_success'
}

const DEFAULT_PROGRESS: ActiveTaskProgress | null = null

const ACTIVE_TASK_PROGRESS_STATUSES = new Set<ActiveTaskProgress['status']>([
  'downloading',
  'completed',
  'failed',
  'partial_success',
])

export function normalizeActiveTaskProgress(value: unknown): ActiveTaskProgress | null {
  if (!isRecord(value)) {
    return null
  }

  if (
    typeof value.taskId !== 'string'
    || typeof value.imagesProcessed !== 'number'
    || typeof value.totalImages !== 'number'
    || typeof value.status !== 'string'
    || !ACTIVE_TASK_PROGRESS_STATUSES.has(value.status as ActiveTaskProgress['status'])
  ) {
    return null
  }

  const normalizedChapterTitle = typeof value.chapterTitle === 'string' ? value.chapterTitle.trim() : ''
  const normalizedActiveChapters: ActiveTaskProgress['activeChapters'] = []
  if (Array.isArray(value.activeChapters)) {
    for (const item of value.activeChapters) {
      if (!isRecord(item) || typeof item.chapterId !== 'string') {
        continue
      }

      const itemTitle = typeof item.chapterTitle === 'string' ? item.chapterTitle.trim() : ''
      normalizedActiveChapters.push({
        chapterId: item.chapterId,
        chapterTitle: itemTitle.length > 0 ? itemTitle : undefined,
        imagesProcessed: typeof item.imagesProcessed === 'number' ? Math.max(0, item.imagesProcessed) : 0,
        totalImages: typeof item.totalImages === 'number' ? Math.max(0, item.totalImages) : 0,
        updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : undefined,
      })
    }
  }

  const fallbackChapterId = typeof value.chapterId === 'string' ? value.chapterId : undefined
  const fallbackSingleChapter = fallbackChapterId
    ? [{
      chapterId: fallbackChapterId,
      chapterTitle: normalizedChapterTitle.length > 0 ? normalizedChapterTitle : undefined,
      imagesProcessed: Math.max(0, value.imagesProcessed),
      totalImages: Math.max(0, value.totalImages),
    }]
    : []

  const activeChapters = normalizedActiveChapters.length > 0 ? normalizedActiveChapters : fallbackSingleChapter
  // Prefer the normalized chapter snapshot count when present; payload count can lag under races.
  const payloadChapterCount = typeof value.activeChapterCount === 'number'
    ? Math.max(0, value.activeChapterCount)
    : 0
  const activeChapterCount = activeChapters.length > 0
    ? activeChapters.length
    : payloadChapterCount

  const aggregateProgress = activeChapters.length > 0
    ? activeChapters.reduce(
      (acc, chapter) => {
        acc.imagesProcessed += chapter.imagesProcessed
        acc.totalImages += chapter.totalImages
        return acc
      },
      { imagesProcessed: 0, totalImages: 0 },
    )
    : {
      imagesProcessed: Math.max(0, value.imagesProcessed),
      totalImages: Math.max(0, value.totalImages),
    }

  return {
    taskId: value.taskId,
    chapterId: fallbackChapterId,
    chapterTitle: normalizedChapterTitle.length > 0 ? normalizedChapterTitle : undefined,
    imagesProcessed: aggregateProgress.imagesProcessed,
    totalImages: aggregateProgress.totalImages,
    activeChapterCount,
    activeChapters,
    status: value.status as ActiveTaskProgress['status'],
  }
}

export interface UseActiveTaskProgressResult {
  progress: ActiveTaskProgress | null
  hydrated: boolean
}

export function useActiveTaskProgress(): UseActiveTaskProgressResult {
  const { value: progress, hydrated } = useStorageSubscription<ActiveTaskProgress | null>({
    areaName: 'session',
    key: SESSION_STORAGE_KEYS.activeTaskProgress,
    initialValue: DEFAULT_PROGRESS,
    parse: normalizeActiveTaskProgress,
  })

  return {
    progress,
    hydrated,
  }
}

