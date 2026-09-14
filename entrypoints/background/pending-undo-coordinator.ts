import type { QueueRepository } from "@/src/storage/queue-repository"
import {
  cancelPendingUndoExpiry,
  schedulePendingUndoExpiry,
} from "@/src/runtime/pending-undo-actions"
import type { PendingUndoReceipt } from "@/src/domain/queue/state"

export async function finalizePendingUndo(
  stateManager: QueueRepository,
  token: string
): Promise<void> {
  await stateManager.finalizePendingUndoAction(token)
  await cancelPendingUndoExpiry(token)
}

export async function schedulePendingUndoAction(
  stateManager: QueueRepository,
  action: PendingUndoReceipt
): Promise<void> {
  await schedulePendingUndoExpiry(action, (token) =>
    finalizePendingUndo(stateManager, token)
  )
}

export async function restorePendingUndo(
  stateManager: QueueRepository,
  token: string
): Promise<Awaited<ReturnType<QueueRepository["restorePendingUndoAction"]>>> {
  const result = await stateManager.restorePendingUndoAction({
    token,
    now: Date.now(),
  })
  await cancelPendingUndoExpiry(token)
  return result
}

export async function recoverPendingUndoActions(
  stateManager: QueueRepository
): Promise<void> {
  const { pending } = await stateManager.reconcileExpiredPendingUndoActions(
    Date.now()
  )
  for (const action of pending) {
    await schedulePendingUndoAction(stateManager, action)
  }
}
