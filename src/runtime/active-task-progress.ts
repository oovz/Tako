import {
  ActiveTaskProgressSnapshotSchema,
  runtimePortRegistry,
  type ActiveChapterProgressSnapshot,
  type ActiveTaskProgressSnapshot,
  type RuntimePortServerEvent,
} from "@/src/runtime/runtime-message-contracts"

export const ACTIVE_TASK_PROGRESS_PORT_NAME =
  runtimePortRegistry.ACTIVE_TASK_PROGRESS.name

export type { ActiveChapterProgressSnapshot, ActiveTaskProgressSnapshot }
export type ActiveTaskProgressPortMessage =
  RuntimePortServerEvent<"ACTIVE_TASK_PROGRESS">

export function normalizeActiveTaskProgress(
  value: unknown
): ActiveTaskProgressSnapshot | null {
  const parsed = ActiveTaskProgressSnapshotSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function normalizeActiveTaskProgressPortMessage(
  value: unknown
): ActiveTaskProgressPortMessage | null {
  const parsed =
    runtimePortRegistry.ACTIVE_TASK_PROGRESS.serverEvent.safeParse(value)
  if (!parsed.success) return null
  const progress = parsed.data.progress
  if (
    progress !== null &&
    (progress.generation !== parsed.data.generation ||
      progress.revision !== parsed.data.revision)
  ) {
    return null
  }
  return parsed.data
}
