import { useMemo } from "react"

import {
  DownloadTaskStatusSchema,
  normalizeDownloadErrorCategory,
} from "@/src/shared/download-contract"
import { SESSION_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import { PublicHttpsUrlSchema } from "@/src/runtime/series-data-schemas"
import type { QueueTaskSummary } from "@/src/domain/queue/state"
import {
  useChromeStorageValue,
  type StorageReadStatus,
} from "@/src/ui/shared/hooks/useChromeStorageValue"
import { isRecord } from "@/src/shared/type-guards"
import { z } from "zod"

const QueueTaskSummaryStorageSchema = z.object({
  id: z.string(),
  seriesKey: z.string(),
  seriesTitle: z.string(),
  siteIntegration: z.string(),
  coverUrl: z.unknown().optional(),
  status: DownloadTaskStatusSchema,
  outputDestination: z.enum(["downloads-api", "fsa"]).optional(),
  saveConfirmedAt: z.number().finite().nonnegative().optional(),
  outputMode: z.enum(["downloads-api", "fsa"]).optional(),
  activeBlock: z
    .enum([
      "destination_action_required",
      "provider_network_policy_pending",
      "provider_network_policy_action_required",
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
  acceptanceUncertain: z.boolean().optional(),
  failureCategory: z.unknown().optional(),
  isRetried: z.unknown().optional(),
  isRetryTask: z.unknown().optional(),
  lastSuccessfulDownloadId: z.unknown().optional(),
})

function normalizeQueueTaskSummary(value: unknown): QueueTaskSummary {
  const data = QueueTaskSummaryStorageSchema.parse(value)

  return {
    id: data.id,
    seriesKey: data.seriesKey,
    seriesTitle: data.seriesTitle,
    siteIntegration: data.siteIntegration,
    coverUrl: PublicHttpsUrlSchema.safeParse(data.coverUrl).success
      ? (data.coverUrl as string)
      : undefined,
    status: data.status,
    activeBlock: data.activeBlock,
    outputDestination: data.outputDestination,
    saveConfirmedAt: data.saveConfirmedAt,
    outputMode: data.outputMode,
    chapters: {
      total: data.chapters.total,
      completed: data.chapters.completed,
      unsuccessful: data.chapters.unsuccessful,
    },
    timestamps: {
      created: data.timestamps.created,
      completed: data.timestamps.completed,
    },
    acceptanceUncertain: data.acceptanceUncertain,
    failureCategory: normalizeDownloadErrorCategory(data.failureCategory),
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
  if (value === undefined) return []
  return z.array(z.unknown()).parse(value).map(normalizeQueueTaskSummary)
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
    throw new Error("Invalid queue projection")
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
  status: StorageReadStatus
  refresh: () => Promise<void>
}

export function useQueueView(): UseQueueViewResult {
  const {
    value: projection,
    hydrated,
    status,
    refresh,
  } = useChromeStorageValue<QueueProjectionStorageValue>({
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
    isLoading: status === "loading",
    status,
    refresh,
  }
}
