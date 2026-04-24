import { SESSION_STORAGE_KEYS } from '@/src/runtime/storage-keys'
import { useChromeStorageValue } from '@/src/ui/shared/hooks/useChromeStorageValue'
import { z } from 'zod'

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

const ACTIVE_TASK_PROGRESS_STATUSES = [
  'downloading',
  'completed',
  'failed',
  'partial_success',
] as const satisfies ReadonlyArray<ActiveTaskProgress['status']>

const ActiveTaskProgressStatusSchema = z.enum(ACTIVE_TASK_PROGRESS_STATUSES)

const ActiveChapterSnapshotSchema = z.object({
  chapterId: z.string(),
  chapterTitle: z.string().optional(),
  imagesProcessed: z.number().optional(),
  totalImages: z.number().optional(),
  updatedAt: z.number().optional(),
})

const ActiveTaskProgressStorageSchema = z.object({
  taskId: z.string(),
  imagesProcessed: z.number(),
  totalImages: z.number(),
  activeChapterCount: z.number().optional(),
  activeChapters: z.array(z.unknown()).optional(),
  chapterId: z.string().optional(),
  chapterTitle: z.string().optional(),
  status: ActiveTaskProgressStatusSchema,
})

export function normalizeActiveTaskProgress(value: unknown): ActiveTaskProgress | null {
  const parsed = ActiveTaskProgressStorageSchema.safeParse(value)
  if (!parsed.success) {
    return null
  }

  const data = parsed.data

  const normalizedChapterTitle = typeof data.chapterTitle === 'string' ? data.chapterTitle.trim() : ''
  const normalizedActiveChapters: ActiveTaskProgress['activeChapters'] = []
  if (Array.isArray(data.activeChapters)) {
    for (const item of data.activeChapters) {
      const chapterParsed = ActiveChapterSnapshotSchema.safeParse(item)
      if (!chapterParsed.success) {
        continue
      }

      const chapter = chapterParsed.data

      const itemTitle = typeof chapter.chapterTitle === 'string' ? chapter.chapterTitle.trim() : ''
      normalizedActiveChapters.push({
        chapterId: chapter.chapterId,
        chapterTitle: itemTitle.length > 0 ? itemTitle : undefined,
        imagesProcessed: typeof chapter.imagesProcessed === 'number' ? Math.max(0, chapter.imagesProcessed) : 0,
        totalImages: typeof chapter.totalImages === 'number' ? Math.max(0, chapter.totalImages) : 0,
        updatedAt: typeof chapter.updatedAt === 'number' ? chapter.updatedAt : undefined,
      })
    }
  }

  const fallbackChapterId = typeof data.chapterId === 'string' ? data.chapterId : undefined
  const fallbackSingleChapter = fallbackChapterId
    ? [{
      chapterId: fallbackChapterId,
      chapterTitle: normalizedChapterTitle.length > 0 ? normalizedChapterTitle : undefined,
      imagesProcessed: Math.max(0, data.imagesProcessed),
      totalImages: Math.max(0, data.totalImages),
    }]
    : []

  const activeChapters = normalizedActiveChapters.length > 0 ? normalizedActiveChapters : fallbackSingleChapter
  // Prefer the normalized chapter snapshot count when present; payload count can lag under races.
  const payloadChapterCount = typeof data.activeChapterCount === 'number'
    ? Math.max(0, data.activeChapterCount)
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
      imagesProcessed: Math.max(0, data.imagesProcessed),
      totalImages: Math.max(0, data.totalImages),
    }

  return {
    taskId: data.taskId,
    chapterId: fallbackChapterId,
    chapterTitle: normalizedChapterTitle.length > 0 ? normalizedChapterTitle : undefined,
    imagesProcessed: aggregateProgress.imagesProcessed,
    totalImages: aggregateProgress.totalImages,
    activeChapterCount,
    activeChapters,
    status: data.status,
  }
}

export interface UseActiveTaskProgressResult {
  progress: ActiveTaskProgress | null
  hydrated: boolean
}

export function useActiveTaskProgress(): UseActiveTaskProgressResult {
  const { value: progress, hydrated } = useChromeStorageValue<ActiveTaskProgress | null>({
    areaName: 'session',
    key: SESSION_STORAGE_KEYS.activeTaskProgress,
    initialValue: null,
    parse: normalizeActiveTaskProgress,
  })

  return {
    progress,
    hydrated,
  }
}

