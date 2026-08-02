import logger from "@/src/runtime/logger"
import { settingsService } from "@/src/storage/settings-service"
import { activeDispatchLeaseStore } from "@/src/runtime/active-dispatch-lease"
import type { CentralizedStateManager } from "@/src/runtime/centralized-state"
import type { OffscreenMessage } from "@/src/runtime/message-schemas"
import type { OffscreenOutputReadyResponse } from "@/src/types/offscreen-messages"
import type { PendingOutputRecord } from "@/src/types/queue-state"
import type { PendingDownloadsStore } from "./pending-downloads"
import {
  reconcilePendingOutput,
  reconcilePreparedOutput,
} from "./native-output-finalizer"
import { runTaskSideEffectExclusive } from "./download-task-side-effect-gate"

type OffscreenOutputReadyMessage = Extract<
  OffscreenMessage,
  { type: "OFFSCREEN_OUTPUT_READY" }
>

type OutputReadyIdentity = {
  jobId: string
  attempt: number
  taskId: string
  chapterId: string
  blobUrl: string
  filename: string
  outputIndex: number
  outputCount: number
  outputKind: "archive" | "image"
}

type OutputReadyOperation = {
  identity: OutputReadyIdentity
  promise: Promise<OffscreenOutputReadyResponse>
}

export interface OffscreenOutputReadyHandlerDependencies {
  ensureStateManagerInitialized: () => Promise<void>
  getStateManager: () => CentralizedStateManager
  pendingDownloadsStore: PendingDownloadsStore
  requestBlobRevocation: (
    record: Pick<
      PendingOutputRecord,
      "jobId" | "attempt" | "outputId" | "blobUrl"
    >
  ) => Promise<void>
}

const outputReadyOperations = new Map<string, OutputReadyOperation>()

async function runOutputReadySingleFlight(
  outputId: string,
  identity: OutputReadyIdentity,
  onCollision: (
    currentIdentity: OutputReadyIdentity
  ) => Promise<OffscreenOutputReadyResponse>,
  operation: () => Promise<OffscreenOutputReadyResponse>
): Promise<OffscreenOutputReadyResponse> {
  const current = outputReadyOperations.get(outputId)
  if (current) {
    const sameIdentity = Object.entries(identity).every(
      ([key, value]) =>
        current.identity[key as keyof OutputReadyIdentity] === value
    )
    if (!sameIdentity) return await onCollision(current.identity)
    return await current.promise
  }

  const pending = operation()
  const entry = { identity, promise: pending }
  outputReadyOperations.set(outputId, entry)
  try {
    return await pending
  } finally {
    if (outputReadyOperations.get(outputId) === entry) {
      outputReadyOperations.delete(outputId)
    }
  }
}

function matchesStoredIdentity(
  record: PendingOutputRecord,
  identity: OutputReadyIdentity
): boolean {
  return (
    record.jobId === identity.jobId &&
    record.attempt === identity.attempt &&
    record.taskId === identity.taskId &&
    record.chapterId === identity.chapterId &&
    record.blobUrl === identity.blobUrl &&
    record.filename === identity.filename &&
    record.outputIndex === identity.outputIndex &&
    record.outputCount === identity.outputCount &&
    record.outputKind === identity.outputKind
  )
}

async function revokeIncomingBlobWhenDifferent(
  deps: OffscreenOutputReadyHandlerDependencies,
  outputId: string,
  identity: OutputReadyIdentity,
  currentBlobUrl: string
): Promise<void> {
  if (currentBlobUrl === identity.blobUrl) return
  await deps.requestBlobRevocation({
    jobId: identity.jobId,
    attempt: identity.attempt,
    outputId,
    blobUrl: identity.blobUrl,
  })
}

/**
 * Complete the native Downloads API handoff for a validated offscreen output.
 * The operation is single-flight by output ID and fenced by the durable
 * job/attempt/task/chapter lease before Chrome receives the Blob URL.
 */
export async function handleOffscreenOutputReady(
  message: OffscreenOutputReadyMessage,
  deps: OffscreenOutputReadyHandlerDependencies
): Promise<OffscreenOutputReadyResponse> {
  try {
    const {
      jobId,
      attempt,
      outputId,
      taskId,
      chapterId,
      fileUrl,
      filename,
      outputIndex,
      outputCount,
      outputKind,
    } = message.payload
    const identity: OutputReadyIdentity = {
      jobId,
      attempt,
      taskId,
      chapterId,
      blobUrl: fileUrl,
      filename,
      outputIndex,
      outputCount,
      outputKind,
    }

    logger.debug("[offscreen-output-ready] Processing output handoff", {
      jobId,
      outputId,
      taskId,
      chapterId,
      filename,
    })

    await deps.ensureStateManagerInitialized()
    const stateManager = deps.getStateManager()

    return await runOutputReadySingleFlight(
      outputId,
      identity,
      async (currentIdentity) => {
        await revokeIncomingBlobWhenDifferent(
          deps,
          outputId,
          identity,
          currentIdentity.blobUrl
        )
        return { success: false, error: "Output identity collision" }
      },
      () =>
        runTaskSideEffectExclusive(taskId, async () => {
          const finalizerDependencies = {
            stateManager,
            pendingOutputs: deps.pendingDownloadsStore,
            requestBlobRevocation: deps.requestBlobRevocation,
          }
          let existing = deps.pendingDownloadsStore.getByOutputId(outputId)
          if (existing) {
            if (!matchesStoredIdentity(existing, identity)) {
              await revokeIncomingBlobWhenDifferent(
                deps,
                outputId,
                identity,
                existing.blobUrl
              )
              return { success: false, error: "Output identity collision" }
            }

            if (existing.state === "prepared") {
              try {
                existing = await reconcilePreparedOutput(
                  finalizerDependencies,
                  existing
                )
              } catch (error) {
                logger.warn("Prepared output reconciliation will retry", {
                  outputId,
                  error,
                })
                return { success: true, accepted: "unknown" }
              }
            }
            if (existing.downloadId !== undefined) {
              try {
                await reconcilePendingOutput(
                  finalizerDependencies,
                  existing.downloadId
                )
              } catch (error) {
                logger.warn("Accepted output reconciliation will retry", {
                  outputId,
                  downloadId: existing.downloadId,
                  error,
                })
                return {
                  success: true,
                  accepted: "unknown",
                  id: existing.downloadId,
                }
              }
              return {
                success: true,
                accepted: true,
                id: existing.downloadId,
              }
            }
            if (existing.state === "interrupted") {
              return {
                success: false,
                error: existing.error ?? "Output handoff was interrupted",
              }
            }
            // The durable prepared record owns the Blob until reconciliation
            // proves whether Chrome accepted the handoff.
            return { success: true, accepted: "unknown" }
          }

          const currentLease = await activeDispatchLeaseStore.get()
          if (
            !currentLease ||
            currentLease.jobId !== jobId ||
            currentLease.attempt !== attempt ||
            currentLease.taskId !== taskId ||
            currentLease.chapterId !== chapterId
          ) {
            await deps.requestBlobRevocation({
              jobId,
              attempt,
              outputId,
              blobUrl: fileUrl,
            })
            return { success: false, error: "Output belongs to a stale job" }
          }

          const task = (await stateManager.getGlobalState()).downloadQueue.find(
            (queuedTask) => queuedTask.id === taskId
          )
          if (task?.status !== "downloading") {
            await deps.requestBlobRevocation({
              jobId,
              attempt,
              outputId,
              blobUrl: fileUrl,
            })
            return {
              success: false,
              error: "Download task is no longer active",
            }
          }

          await deps.pendingDownloadsStore.prepare({
            outputId,
            jobId,
            attempt,
            taskId,
            chapterId,
            blobUrl: fileUrl,
            filename,
            outputIndex,
            outputCount,
            outputKind,
            state: "prepared",
            createdAt: Date.now(),
          })

          const settings = await settingsService.getSettings()
          const conflictAction = task.settingsSnapshot.conflictPolicy
          const saveAs = settings.downloads.suppressSaveAsDialog === false
          let downloadId: number
          try {
            const acceptedId = await chrome.downloads.download({
              url: fileUrl,
              filename,
              conflictAction,
              saveAs,
            })
            if (typeof acceptedId !== "number") {
              throw new Error("downloads.download returned no download id")
            }
            downloadId = acceptedId
          } catch (error) {
            const errorMessage =
              error instanceof Error
                ? error.message
                : "Chrome rejected the download"
            await deps.pendingDownloadsStore.markPreparedInterrupted(
              outputId,
              errorMessage
            )
            try {
              await deps.requestBlobRevocation({
                jobId,
                attempt,
                outputId,
                blobUrl: fileUrl,
              })
              await deps.pendingDownloadsStore.markBlobRevoked(outputId)
            } catch (revocationError) {
              logger.warn("Blob URL revocation will be retried", {
                outputId,
                revocationError,
              })
            }
            return { success: false, error: errorMessage }
          }

          try {
            const attached = await deps.pendingDownloadsStore.attachDownload(
              outputId,
              downloadId
            )
            if (!attached || attached.downloadId !== downloadId) {
              throw new Error("Failed to persist native download acceptance")
            }
            await reconcilePendingOutput(finalizerDependencies, downloadId)
          } catch (error) {
            // Chrome may already be streaming the Blob. Preserve ownership and
            // let durable reconciliation establish the terminal outcome.
            logger.warn("Native output acceptance will be reconciled", {
              outputId,
              downloadId,
              error,
            })
            return {
              success: true,
              accepted: "unknown",
              id: downloadId,
            }
          }

          return { success: true, accepted: true, id: downloadId }
        })
    )
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "downloads.download failed"
    logger.error("OFFSCREEN_OUTPUT_READY failed:", error)
    return { success: false, error: errorMessage }
  }
}
