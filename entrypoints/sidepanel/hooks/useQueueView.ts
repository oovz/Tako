import { useMemo } from "react"

import {
  DownloadTaskStatusSchema,
  normalizeDownloadErrorCategory,
} from "@/src/shared/download-contract"
import { SESSION_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import type { QueueTaskSummary } from "@/src/domain/queue/state"
import { useChromeStorageValue } from "@/src/ui/shared/hooks/useChromeStorageValue"
import { isRecord } from "@/src/shared/type-guards"
import { z } from "zod"

const QueueTaskSummaryStorageSchema = z.object({
  id: z.string(),
  seriesKey: z.string(),
  seriesTitle: z.string(),
  siteIntegration: z.string(),
  coverUrl: z.unknown().optional(),
  status: DownloadTaskStatusSchema,
  activeBlock: z
    .enum([
      "destination_action_required",
      "provider_network_policy_pending",
      "provider_network_policy_action_required",
      "native_output_action_required",
    ])
    .optional(),
  chapters: z.object({
    total: z.number(),
    completed: z.number(),
    unsuccessful: z.number(),
  }),
  timestamps: z.object({
    created: z.number(),
    completed: z.number().optional(),
  }),
  failureCategory: z.unknown().optional(),
  hasUnobservableOutput: z.unknown().optional(),
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
    coverUrl: typeof data.coverUrl === "string" ? data.coverUrl : undefined,
    status: data.status,
    activeBlock: data.activeBlock,
    chapters: {
      total: data.chapters.total,
      completed: data.chapters.completed,
      unsuccessful: data.chapters.unsuccessful,
    },
    timestamps: {
      created: data.timestamps.created,
      completed: data.timestamps.completed,
    },
    failureCategory: normalizeDownloadErrorCategory(data.failureCategory),
    hasUnobservableOutput:
      typeof data.hasUnobservableOutput === "boolean"
        ? data.hasUnobservableOutput
        : undefined,
    isRetried: typeof data.isRetried === "boolean" ? data.isRetried : undefined,
    isRetryTask:
      typeof data.isRetryTask === "boolean" ? data.isRetryTask : undefined,
    lastSuccessfulDownloadId:
      typeof data.lastSuccessfulDownloadId === "number"
        ? data.lastSuccessfulDownloadId
        : undefined,
  }
}

export function normalizeQueueView(value: unknown): QueueTaskSummary[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map(normalizeQueueTaskSummary)
    .filter((task): task is QueueTaskSummary => task !== null)
}

function isTerminalTask(task: QueueTaskSummary): boolean {
  return (
    task.status === "completed" ||
    task.status === "partial_success" ||
    task.status === "failed" ||
    task.status === "canceled"
  )
}

export function normalizeHistoryView(value: unknown): QueueTaskSummary[] {
  return normalizeQueueView(value)
    .filter(isTerminalTask)
    .sort(
      (left, right) =>
        (right.timestamps.completed ?? 0) - (left.timestamps.completed ?? 0)
    )
    .slice(0, 5)
}

interface QueueProjectionStorageValue {
  queueView: QueueTaskSummary[]
  historyView: QueueTaskSummary[]
}

export function normalizeQueueProjection(
  value: unknown
): QueueProjectionStorageValue {
  if (!isRecord(value)) {
    return { queueView: [], historyView: [] }
  }

  const queue = normalizeQueueView(value[SESSION_STORAGE_KEYS.queueView])
  return {
    queueView: queue.filter((task) => !isTerminalTask(task)),
    historyView: normalizeHistoryView(value[SESSION_STORAGE_KEYS.historyView]),
  }
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
  const { value: projection, hydrated } =
    useChromeStorageValue<QueueProjectionStorageValue>({
      areaName: "session",
      key: [SESSION_STORAGE_KEYS.queueView, SESSION_STORAGE_KEYS.historyView],
      initialValue: { queueView: [], historyView: [] },
      parse: normalizeQueueProjection,
    })
  const { queueView, historyView } = projection

  const activeTasks = useMemo(
    () => queueView.filter((task) => task.status === "downloading"),
    [queueView]
  )

  const queuedTasks = useMemo(
    () => queueView.filter((task) => task.status === "queued"),
    [queueView]
  )

  const historyTasks = useMemo(() => historyView, [historyView])

  return {
    queueView,
    activeTasks,
    queuedTasks,
    historyTasks,
    activeCount: activeTasks.length,
    queuedCount: queuedTasks.length,
    hydrated,
    isLoading: !hydrated,
  }
}
