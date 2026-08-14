import type { BackgroundRuntimeHandlerDependencies } from "@/entrypoints/background/background-runtime-handler-dependencies"
import { handleOffscreenDownloadProgress } from "@/entrypoints/background/offscreen-progress-handler"
import {
  closeOffscreenDocumentIfCurrent,
  getOffscreenContexts,
} from "@/entrypoints/background/offscreen-lifecycle"
import { runTaskSideEffectExclusive } from "@/entrypoints/background/download-task-side-effect-gate"
import type { RuntimeMessageHandlerMap } from "@/src/runtime/runtime-message-dispatcher"

type OffscreenEventMessageType =
  | "OFFSCREEN_JOB_ACCEPTED"
  | "OFFSCREEN_JOB_HEARTBEAT"
  | "OFFSCREEN_JOB_TERMINAL"
  | "OFFSCREEN_OUTPUT_READY"
  | "OFFSCREEN_DOWNLOAD_PROGRESS"
  | "OFFSCREEN_INITIALIZATION_FAILED"

export function createBackgroundOffscreenEventMessageHandlers(
  deps: BackgroundRuntimeHandlerDependencies
): Pick<RuntimeMessageHandlerMap<"background">, OffscreenEventMessageType> {
  return {
    OFFSCREEN_JOB_ACCEPTED: async (message, sender) => {
      if (!(await isCurrentOffscreenSender(sender))) {
        return { success: true, disposition: "lease_not_current" }
      }
      return await runTaskSideEffectExclusive(
        message.payload.taskId,
        async () => {
          if (!(await isActiveJobOwner(deps, message.payload))) {
            return { success: true, disposition: "lease_not_current" }
          }
          const renewal = await deps.queueRepository.renewDispatchLease({
            ...message.payload,
            stage: "accepted",
            activityAt: message.payload.acceptedAt,
            eventSignature: JSON.stringify(message.payload),
          })
          return renewalResponse(renewal)
        }
      )
    },
    OFFSCREEN_JOB_HEARTBEAT: async (message, sender) => {
      if (!(await isCurrentOffscreenSender(sender))) {
        return { success: true, disposition: "lease_not_current" }
      }
      return await runTaskSideEffectExclusive(
        message.payload.taskId,
        async () => {
          if (!(await isActiveJobOwner(deps, message.payload))) {
            return { success: true, disposition: "lease_not_current" }
          }
          const renewal = await deps.queueRepository.renewDispatchLease({
            ...message.payload,
            activityAt: message.payload.sentAt,
            eventSignature: JSON.stringify(message.payload),
          })
          return renewalResponse(renewal)
        }
      )
    },
    OFFSCREEN_JOB_TERMINAL: async (message, sender) => {
      if (!(await isCurrentOffscreenSender(sender))) {
        return { success: true, disposition: "lease_not_current" }
      }
      const terminal = await runTaskSideEffectExclusive(
        message.payload.taskId,
        async () => {
          if (!(await isActiveJobOwner(deps, message.payload))) {
            return {
              response: {
                success: true as const,
                disposition: "lease_not_current" as const,
              },
            }
          }
          const renewal = await deps.queueRepository.renewDispatchLease({
            ...message.payload,
            activityAt: message.payload.terminalAt,
            eventSignature: JSON.stringify(message.payload),
            requireSequenceAdvance: true,
          })
          const response = renewalResponse(renewal)
          if (!response.success || response.disposition !== "renewed") {
            return { response }
          }
          const settlement = await deps.terminalCoordinator.settle(
            message.payload
          )
          return { response, settlement }
        }
      )
      if (terminal.settlement) {
        await deps.terminalCoordinator.afterSettlement(
          message.payload.taskId,
          terminal.settlement
        )
      }
      return terminal.response
    },
    OFFSCREEN_OUTPUT_READY: async (message, sender) => {
      if (!(await isCurrentOffscreenSender(sender))) {
        return {
          success: true,
          disposition: "not_persisted",
          reason: "stale-offscreen-document",
        }
      }
      return await runTaskSideEffectExclusive(
        message.payload.taskId,
        async () =>
          await deps.nativeOutputCoordinator.handleOutputReady(message.payload)
      )
    },
    OFFSCREEN_DOWNLOAD_PROGRESS: async (message, sender) => {
      if (!(await isCurrentOffscreenSender(sender))) {
        return { success: true, disposition: "lease_not_current" }
      }
      return await runTaskSideEffectExclusive(
        message.payload.taskId,
        async () =>
          await handleOffscreenDownloadProgress(deps.queueRepository, message)
      )
    },
    OFFSCREEN_INITIALIZATION_FAILED: async (message, sender) => {
      await closeOffscreenDocumentIfCurrent({
        documentInstanceId: message.payload.documentInstanceId,
        browserDocumentId: sender.documentId,
      })
      return { success: true }
    },
  }
}

async function isActiveJobOwner(
  deps: BackgroundRuntimeHandlerDependencies,
  identity: { taskId: string; chapterId: string }
): Promise<boolean> {
  const task = await deps.queueRepository.getTask(identity.taskId)
  return (
    task?.status === "downloading" &&
    task.chapters.some(
      (chapter) =>
        chapter.id === identity.chapterId && chapter.status === "downloading"
    )
  )
}

type RenewalResult = Awaited<
  ReturnType<
    BackgroundRuntimeHandlerDependencies["queueRepository"]["renewDispatchLease"]
  >
>

function renewalResponse(
  renewal: RenewalResult
): Extract<
  Awaited<
    ReturnType<
      RuntimeMessageHandlerMap<"background">["OFFSCREEN_JOB_HEARTBEAT"]
    >
  >,
  { success: true }
> {
  if (renewal.outcome === "applied") {
    return { success: true, disposition: "renewed" }
  }
  if (renewal.outcome === "unchanged") {
    return { success: true, disposition: "stale_or_reordered" }
  }
  return {
    success: true,
    disposition:
      renewal.reason === "stale-sequence"
        ? "stale_or_reordered"
        : renewal.reason === "lease-not-current"
          ? "lease_not_current"
          : "protocol_error",
  }
}

async function isCurrentOffscreenSender(
  sender: chrome.runtime.MessageSender
): Promise<boolean> {
  // Chrome may omit documentId for legitimate offscreen messages. The runtime
  // dispatcher has already required the exact same-extension, tabless
  // /offscreen.html principal; Phase 10 effects additionally carry the
  // mandatory application documentInstanceId and validate it against durable
  // job/output authority.
  if (sender.documentId === undefined) {
    return true
  }
  if (typeof sender.documentId !== "string" || sender.documentId.length === 0) {
    return false
  }
  const contexts = await getOffscreenContexts()
  return contexts.some(
    (context) =>
      typeof context === "object" &&
      context !== null &&
      "documentId" in context &&
      (context as { documentId?: unknown }).documentId === sender.documentId
  )
}
