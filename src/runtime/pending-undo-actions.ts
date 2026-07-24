import logger from "@/src/runtime/logger"
import { normalizePersistedDownloadTask } from "@/src/runtime/persisted-download-task"
import { isRecord } from "@/src/shared/type-guards"
import type {
  PendingUndoAction,
  PendingUndoActionType,
  PendingUndoReceipt,
} from "@/src/types/queue-state"

export const PENDING_UNDO_WINDOW_MS = 5_000
export const PENDING_UNDO_ALARM_PREFIX = "pending-undo:"

const PENDING_UNDO_ACTION_TYPES = new Set<PendingUndoActionType>([
  "cancel_queued",
  "remove_history",
])
const pendingUndoTimers = new Map<string, ReturnType<typeof setTimeout>>()

export function normalizePendingUndoActions(raw: unknown): PendingUndoAction[] {
  if (!Array.isArray(raw)) return []

  return raw
    .map((candidate): PendingUndoAction | null => {
      if (!isRecord(candidate)) return null
      if (
        typeof candidate.token !== "string" ||
        candidate.token.length === 0 ||
        typeof candidate.type !== "string" ||
        !PENDING_UNDO_ACTION_TYPES.has(
          candidate.type as PendingUndoActionType
        ) ||
        !Number.isInteger(candidate.previousQueuePosition) ||
        (candidate.previousQueuePosition as number) < 0 ||
        typeof candidate.createdAt !== "number" ||
        !Number.isFinite(candidate.createdAt) ||
        typeof candidate.expiresAt !== "number" ||
        !Number.isFinite(candidate.expiresAt) ||
        candidate.expiresAt < candidate.createdAt
      ) {
        return null
      }

      const taskSnapshot = normalizePersistedDownloadTask(
        candidate.taskSnapshot
      )
      if (!taskSnapshot) return null

      return {
        token: candidate.token,
        type: candidate.type as PendingUndoActionType,
        taskSnapshot,
        previousQueuePosition: candidate.previousQueuePosition as number,
        createdAt: candidate.createdAt,
        expiresAt: candidate.expiresAt,
      }
    })
    .filter((action): action is PendingUndoAction => action !== null)
}

export function toPendingUndoReceipt(
  action: PendingUndoAction
): PendingUndoReceipt {
  return {
    token: action.token,
    type: action.type,
    expiresAt: action.expiresAt,
  }
}

export function isPendingUndoReceipt(
  value: unknown
): value is PendingUndoReceipt {
  return (
    isRecord(value) &&
    typeof value.token === "string" &&
    PENDING_UNDO_ACTION_TYPES.has(value.type as PendingUndoActionType) &&
    typeof value.expiresAt === "number" &&
    Number.isFinite(value.expiresAt)
  )
}

export function pendingUndoAlarmName(token: string): string {
  return `${PENDING_UNDO_ALARM_PREFIX}${token}`
}

export function pendingUndoTokenFromAlarmName(name: string): string | null {
  if (!name.startsWith(PENDING_UNDO_ALARM_PREFIX)) return null
  const token = name.slice(PENDING_UNDO_ALARM_PREFIX.length)
  return token.length > 0 ? token : null
}

export async function schedulePendingUndoExpiry(
  action: Pick<PendingUndoAction, "token" | "expiresAt">,
  onExpired: (token: string) => Promise<void>
): Promise<void> {
  const existingTimer = pendingUndoTimers.get(action.token)
  if (existingTimer) clearTimeout(existingTimer)

  const timer = setTimeout(
    () => {
      pendingUndoTimers.delete(action.token)
      void onExpired(action.token).catch((error) => {
        logger.error("Failed to finalize expired Undo action:", error)
      })
    },
    Math.max(0, action.expiresAt - Date.now())
  )
  pendingUndoTimers.set(action.token, timer)

  try {
    await chrome.alarms.create(pendingUndoAlarmName(action.token), {
      when: action.expiresAt,
    })
  } catch (error) {
    // The in-process timer preserves the five-second experience. Startup
    // reconciliation remains the durable fallback if alarms are unavailable.
    logger.debug("Failed to schedule pending Undo alarm (non-fatal):", error)
  }
}

export async function cancelPendingUndoExpiry(token: string): Promise<void> {
  const timer = pendingUndoTimers.get(token)
  if (timer) {
    clearTimeout(timer)
    pendingUndoTimers.delete(token)
  }

  try {
    await chrome.alarms.clear(pendingUndoAlarmName(token))
  } catch (error) {
    logger.debug("Failed to clear pending Undo alarm (non-fatal):", error)
  }
}
