import { clearDestinationIssuesForTask } from "@/entrypoints/background/destination"
import type {
  CentralizedStateManager,
  RestorePendingUndoActionResult,
} from "@/src/runtime/centralized-state"
import {
  cancelPendingUndoExpiry,
  schedulePendingUndoExpiry,
} from "@/src/runtime/pending-undo-actions"
import type {
  PendingUndoAction,
  PendingUndoReceipt,
} from "@/src/types/queue-state"

async function cleanUpFinalizedAction(
  action: PendingUndoAction
): Promise<void> {
  if (action.type === "cancel_queued") {
    await clearDestinationIssuesForTask(action.taskSnapshot.id)
  }
}

export async function finalizePendingUndoAndCleanup(
  stateManager: CentralizedStateManager,
  token: string
): Promise<void> {
  const result = await stateManager.finalizePendingUndoAction(token)
  await cancelPendingUndoExpiry(token)
  if (result.success) {
    await cleanUpFinalizedAction(result.action)
  }
}

export async function schedulePendingUndoAction(
  stateManager: CentralizedStateManager,
  action: PendingUndoReceipt
): Promise<void> {
  await schedulePendingUndoExpiry(action, (token) =>
    finalizePendingUndoAndCleanup(stateManager, token)
  )
}

export async function restorePendingUndoAndCleanup(
  stateManager: CentralizedStateManager,
  token: string
): Promise<RestorePendingUndoActionResult> {
  const result = await stateManager.restorePendingUndoAction(token)
  await cancelPendingUndoExpiry(token)
  if (!result.success && result.reason === "expired" && result.action) {
    await cleanUpFinalizedAction(result.action)
  }
  return result
}

export async function recoverPendingUndoActions(
  stateManager: CentralizedStateManager
): Promise<void> {
  const result = await stateManager.reconcileExpiredPendingUndoActions()
  for (const action of result.finalized) {
    await cleanUpFinalizedAction(action)
  }
  for (const action of result.pending) {
    await schedulePendingUndoAction(stateManager, action)
  }
}
