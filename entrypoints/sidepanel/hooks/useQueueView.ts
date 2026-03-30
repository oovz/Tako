import { useEffect, useMemo, useState } from 'react'

import { SESSION_STORAGE_KEYS } from '@/src/runtime/storage-keys'
import type { QueueTaskSummary } from '@/src/types/queue-state'
import { useChromeStorageValue } from '@/src/ui/shared/hooks/useChromeStorageValue'
import { z } from 'zod'

const SKELETON_TIMEOUT_MS = 500
const QUEUE_TASK_STATUSES = [
  'queued',
  'downloading',
  'completed',
  'partial_success',
  'failed',
  'canceled',
] as const satisfies ReadonlyArray<QueueTaskSummary['status']>

const QUEUE_FAILURE_CATEGORIES = [
  'network',
  'download',
  'other',
] as const satisfies ReadonlyArray<NonNullable<QueueTaskSummary['failureCategory']>>

const QueueTaskStatusSchema = z.enum(QUEUE_TASK_STATUSES)
const QueueFailureCategorySchema = z.enum(QUEUE_FAILURE_CATEGORIES)

const QueueTaskSummaryStorageSchema = z.object({
  id: z.string(),
  seriesKey: z.string(),
  seriesTitle: z.string(),
  siteIntegration: z.string(),
  coverUrl: z.unknown().optional(),
  status: QueueTaskStatusSchema,
  chapters: z.object({
    total: z.number(),
    completed: z.number(),
    unsuccessful: z.number(),
  }),
  timestamps: z.object({
    created: z.number(),
    completed: z.number().optional(),
  }),
  failureReason: z.unknown().optional(),
  failureCategory: z.unknown().optional(),
  isRetried: z.unknown().optional(),
  isRetryTask: z.unknown().optional(),
  lastSuccessfulDownloadId: z.unknown().optional(),
})

function normalizeQueueTaskSummary(value: unknown): QueueTaskSummary | null {
  const parsed = QueueTaskSummaryStorageSchema.safeParse(value)
  if (!parsed.success) {
    return null
  }

  const data = parsed.data

  return {
    id: data.id,
    seriesKey: data.seriesKey,
    seriesTitle: data.seriesTitle,
    siteIntegration: data.siteIntegration,
    coverUrl: typeof data.coverUrl === 'string' ? data.coverUrl : undefined,
    status: data.status,
    chapters: {
      total: data.chapters.total,
      completed: data.chapters.completed,
      unsuccessful: data.chapters.unsuccessful,
    },
    timestamps: {
      created: data.timestamps.created,
      completed: data.timestamps.completed,
    },
    failureReason: typeof data.failureReason === 'string' ? data.failureReason : undefined,
    failureCategory: QueueFailureCategorySchema.safeParse(data.failureCategory).success
      ? QueueFailureCategorySchema.parse(data.failureCategory)
      : undefined,
    isRetried: typeof data.isRetried === 'boolean' ? data.isRetried : undefined,
    isRetryTask: typeof data.isRetryTask === 'boolean' ? data.isRetryTask : undefined,
    lastSuccessfulDownloadId: typeof data.lastSuccessfulDownloadId === 'number' ? data.lastSuccessfulDownloadId : undefined,
  }
}

export function normalizeQueueView(value: unknown): QueueTaskSummary[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.map(normalizeQueueTaskSummary).filter((task): task is QueueTaskSummary => task !== null)
}

export interface UseQueueViewResult {
  queueView: QueueTaskSummary[]
  activeTasks: QueueTaskSummary[]
  queuedTasks: QueueTaskSummary[]
  historyTasks: QueueTaskSummary[]
  activeCount: number
  queuedCount: number
  isLoading: boolean
  hydrated: boolean
}

export function useQueueView(): UseQueueViewResult {
  const { value: queueView, hydrated } = useChromeStorageValue<QueueTaskSummary[]>({
    areaName: 'session',
    key: SESSION_STORAGE_KEYS.queueView,
    initialValue: [],
    parse: normalizeQueueView,
  })

  const [showSkeleton, setShowSkeleton] = useState(true)

  useEffect(() => {
    if (!hydrated) {
      return
    }

    if (queueView.length > 0) {
      setShowSkeleton(false)
      return
    }

    const timeoutId = window.setTimeout(() => {
      setShowSkeleton(false)
    }, SKELETON_TIMEOUT_MS)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [hydrated, queueView.length])

  const activeTasks = useMemo(
    () => queueView.filter((task) => task.status === 'downloading'),
    [queueView],
  )

  const queuedTasks = useMemo(
    () => queueView.filter((task) => task.status === 'queued'),
    [queueView],
  )

  const historyTasks = useMemo(
    () => queueView.filter((task) => task.status === 'completed' || task.status === 'partial_success' || task.status === 'failed' || task.status === 'canceled').slice(0, 5),
    [queueView],
  )

  return {
    queueView,
    activeTasks,
    queuedTasks,
    historyTasks,
    activeCount: activeTasks.length,
    queuedCount: queuedTasks.length,
    hydrated,
    isLoading: !hydrated || showSkeleton,
  }
}

