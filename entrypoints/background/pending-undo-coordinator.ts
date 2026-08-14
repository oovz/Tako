import type { DestinationService } from "@/entrypoints/background/destination"
import type { QueueRepository } from "@/src/storage/queue-repository"
import {
  cancelPendingUndoExpiry,
  schedulePendingUndoExpiry,
} from "@/src/runtime/pending-undo-actions"
import logger from "@/src/runtime/logger"
import type {
  PendingUndoAction,
  PendingUndoReceipt,
} from "@/src/domain/queue/state"

async function cleanUpFinalizedAction(
  action: PendingUndoAction,
  destinationService: DestinationService
): Promise<void> {
  if (action.type === "cancel_queued") {
    try {
      await destinationService.clearDestinationIssuesForTask(
        action.taskSnapshot.id
      )
    } catch (error) {
      logger.warn(
        "[Queue] Destination diagnostic cleanup failed after Undo finalization",
        error
      )
    }
  }
}

export async function finalizePendingUndoAndCleanup(
  stateManager: QueueRepository,
  token: string,
  destinationService: DestinationService
): Promise<void> {
  const result = await stateManager.finalizePendingUndoAction(token)
  await cancelPendingUndoExpiry(token)
  if (result.outcome === "applied") {
    await cleanUpFinalizedAction(result.action, destinationService)
  }
}

export async function schedulePendingUndoAction(
  stateManager: QueueRepository,
  action: PendingUndoReceipt,
  destinationService: DestinationService
): Promise<void> {
  await schedulePendingUndoExpiry(action, (token) =>
    finalizePendingUndoAndCleanup(stateManager, token, destinationService)
  )
}

export async function restorePendingUndoAndCleanup(
  stateManager: QueueRepository,
  token: string,
  destinationService: DestinationService
): Promise<Awaited<ReturnType<QueueRepository["restorePendingUndoAction"]>>> {
  const result = await stateManager.restorePendingUndoAction({
    token,
    now: Date.now(),
  })
  await cancelPendingUndoExpiry(token)
  if (result.outcome === "applied" && !result.restored) {
    await cleanUpFinalizedAction(result.action, destinationService)
  }
  return result
}

export async function recoverPendingUndoActions(
  stateManager: QueueRepository,
  destinationService: DestinationService
): Promise<void> {
  const result = await stateManager.reconcileExpiredPendingUndoActions(
    Date.now()
  )
  for (const action of result.finalized) {
    await cleanUpFinalizedAction(action, destinationService)
  }
  for (const action of result.pending) {
    await schedulePendingUndoAction(stateManager, action, destinationService)
  }
}
