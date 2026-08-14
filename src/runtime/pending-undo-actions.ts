import logger from "@/src/runtime/logger"
import type { PendingUndoAction } from "@/src/domain/queue/state"

export const PENDING_UNDO_ALARM_PREFIX = "pending-undo:"

const pendingUndoTimers = new Map<string, ReturnType<typeof setTimeout>>()

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
