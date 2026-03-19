import { useEffect, useMemo, useState } from 'react'

import { SESSION_STORAGE_KEYS } from '@/src/runtime/storage-keys'
import { useStorageSubscription } from '@/entrypoints/sidepanel/hooks/useStorageSubscription'
import { isRecord } from '@/src/shared/type-guards'
import type { QueueTaskSummary } from '@/src/types/queue-state'

const SKELETON_TIMEOUT_MS = 500
const QUEUE_TASK_STATUSES = new Set<QueueTaskSummary['status']>([
  'queued',
  'downloading',
  'completed',
  'partial_success',
  'failed',
  'canceled',
])

function isQueueTaskSummary(value: unknown): value is QueueTaskSummary {
  if (!isRecord(value)) {
    return false
  }

  if (!isRecord(value.chapters) || !isRecord(value.timestamps)) {
    return false
  }

  return (
    typeof value.id === 'string'
    && typeof value.seriesKey === 'string'
    && typeof value.status === 'string'
    && QUEUE_TASK_STATUSES.has(value.status as QueueTaskSummary['status'])
    && typeof value.seriesTitle === 'string'
    && typeof value.siteIntegration === 'string'
    && typeof value.chapters.total === 'number'
    && typeof value.chapters.completed === 'number'
    && typeof value.chapters.unsuccessful === 'number'
    && typeof value.timestamps.created === 'number'
    && (typeof value.timestamps.completed === 'number' || typeof value.timestamps.completed === 'undefined')
  )
}

export function normalizeQueueView(value: unknown): QueueTaskSummary[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter(isQueueTaskSummary)
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
  const { value: queueView, hydrated } = useStorageSubscription<QueueTaskSummary[]>({
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

