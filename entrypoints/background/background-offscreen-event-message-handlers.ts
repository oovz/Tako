import type { BackgroundRuntimeHandlerDependencies } from "@/entrypoints/background/background-runtime-handler-dependencies"
import { handleOffscreenDownloadProgress } from "@/entrypoints/background/offscreen-progress-handler"
import {
  closeOffscreenDocumentIfCurrent,
  getOffscreenContexts,
} from "@/entrypoints/background/offscreen-lifecycle"
import { runTaskSideEffectExclusive } from "@/entrypoints/background/download-task-side-effect-gate"
import type { RuntimeMessageHandlerMap } from "@/src/runtime/runtime-message-dispatcher"

type OffscreenEventMessageType =
  | "OFFSCREEN_BEGIN_FSA_WRITE"
  | "OFFSCREEN_JOB_ACCEPTED"
  | "OFFSCREEN_JOB_HEARTBEAT"
  | "OFFSCREEN_JOB_TERMINAL"
  | "OFFSCREEN_OUTPUT_READY"
  | "OFFSCREEN_DOWNLOAD_PROGRESS"
  | "OFFSCREEN_INITIALIZATION_FAILED"

class BackgroundOffscreenEventHandlers {
  constructor(private readonly deps: BackgroundRuntimeHandlerDependencies) {}
  async handleOffscreenBeginFsaWrite(
    message: Parameters<
      RuntimeMessageHandlerMap<"background">["OFFSCREEN_BEGIN_FSA_WRITE"]
    >[0],
    sender: Parameters<
      RuntimeMessageHandlerMap<"background">["OFFSCREEN_BEGIN_FSA_WRITE"]
    >[1]
  ): Promise<
    Awaited<
      ReturnType<
        RuntimeMessageHandlerMap<"background">["OFFSCREEN_BEGIN_FSA_WRITE"]
      >
    >
  > {
    if (!(await isCurrentOffscreenSender(sender)))
      return { success: true, permitted: false }
    return await runTaskSideEffectExclusive(
      message.payload.taskId,
      async () => {
        const result = await this.deps.queueRepository.beginFsaWrite(
          message.payload
        )
        return { success: true, permitted: result.outcome !== "rejected" }
      }
    )
  }

  async handleOffscreenJobAccepted(
    message: Parameters<
      RuntimeMessageHandlerMap<"background">["OFFSCREEN_JOB_ACCEPTED"]
    >[0],
    sender: Parameters<
      RuntimeMessageHandlerMap<"background">["OFFSCREEN_JOB_ACCEPTED"]
    >[1]
  ): Promise<
    Awaited<
      ReturnType<
        RuntimeMessageHandlerMap<"background">["OFFSCREEN_JOB_ACCEPTED"]
      >
    >
  > {
    if (!(await isCurrentOffscreenSender(sender))) {
      return { success: true, disposition: "lease_not_current" }
    }
    return await runTaskSideEffectExclusive(
      message.payload.taskId,
      async () => {
        if (!(await isActiveJobOwner(this.deps, message.payload))) {
          return { success: true, disposition: "lease_not_current" }
        }
        const renewal = await this.deps.queueRepository.renewDispatchLease({
          ...message.payload,
          stage: "accepted",
          activityAt: message.payload.acceptedAt,
          eventSignature: JSON.stringify(message.payload),
        })
        return renewalResponse(renewal)
      }
    )
  }

  async handleOffscreenJobHeartbeat(
    message: Parameters<
      RuntimeMessageHandlerMap<"background">["OFFSCREEN_JOB_HEARTBEAT"]
    >[0],
    sender: Parameters<
      RuntimeMessageHandlerMap<"background">["OFFSCREEN_JOB_HEARTBEAT"]
    >[1]
  ): Promise<
    Awaited<
      ReturnType<
        RuntimeMessageHandlerMap<"background">["OFFSCREEN_JOB_HEARTBEAT"]
      >
    >
  > {
    if (!(await isCurrentOffscreenSender(sender))) {
      return { success: true, disposition: "lease_not_current" }
    }
    return await runTaskSideEffectExclusive(
      message.payload.taskId,
      async () => {
        if (!(await isActiveJobOwner(this.deps, message.payload))) {
          return { success: true, disposition: "lease_not_current" }
        }
        const renewal = await this.deps.queueRepository.renewDispatchLease({
          ...message.payload,
          activityAt: message.payload.sentAt,
          eventSignature: JSON.stringify(message.payload),
        })
        return renewalResponse(renewal)
      }
    )
  }

  async handleOffscreenJobTerminal(
    message: Parameters<
      RuntimeMessageHandlerMap<"background">["OFFSCREEN_JOB_TERMINAL"]
    >[0],
    sender: Parameters<
      RuntimeMessageHandlerMap<"background">["OFFSCREEN_JOB_TERMINAL"]
    >[1]
  ): Promise<
    Awaited<
      ReturnType<
        RuntimeMessageHandlerMap<"background">["OFFSCREEN_JOB_TERMINAL"]
      >
    >
  > {
    if (!(await isCurrentOffscreenSender(sender))) {
      return { success: true, disposition: "lease_not_current" }
    }
    const terminal = await runTaskSideEffectExclusive(
      message.payload.taskId,
      async () => {
        // Terminal events may race with durable cancellation. The lease
        // renewal below validates the full job incarnation; requiring the
        // task to still be active would prevent exact terminal evidence
        // from releasing a canceled task's retained lease.
        const renewal = await this.deps.queueRepository.renewDispatchLease({
          ...message.payload,
          activityAt: message.payload.terminalAt,
          eventSignature: JSON.stringify(message.payload),
          requireSequenceAdvance: true,
        })
        const response = renewalResponse(renewal)
        if (!response.success || response.disposition !== "renewed") {
          return { response }
        }
        const settlement = await this.deps.terminalCoordinator.settle(
          message.payload
        )
        return { response, settlement }
      }
    )
    if (terminal.settlement) {
      await this.deps.terminalCoordinator.afterSettlement(
        message.payload.taskId,
        terminal.settlement
      )
    }
    return terminal.response
  }

  async handleOffscreenOutputReady(
    message: Parameters<
      RuntimeMessageHandlerMap<"background">["OFFSCREEN_OUTPUT_READY"]
    >[0],
    sender: Parameters<
      RuntimeMessageHandlerMap<"background">["OFFSCREEN_OUTPUT_READY"]
    >[1]
  ): Promise<
    Awaited<
      ReturnType<
        RuntimeMessageHandlerMap<"background">["OFFSCREEN_OUTPUT_READY"]
      >
    >
  > {
    if (!(await isCurrentOffscreenSender(sender))) {
      return {
        success: true,
        disposition: "not_persisted",
        reason: "stale-offscreen-document",
      }
    }
    const result = await runTaskSideEffectExclusive(
      message.payload.taskId,
      async () =>
        await this.deps.nativeOutputCoordinator.handleOutputReady(
          message.payload
        )
    )
    await this.deps.terminalCoordinator.continueAfterNativeOutputSettlement(
      result.effects
    )
    return result.response
  }

  async handleOffscreenDownloadProgress(
    message: Parameters<
      RuntimeMessageHandlerMap<"background">["OFFSCREEN_DOWNLOAD_PROGRESS"]
    >[0],
    sender: Parameters<
      RuntimeMessageHandlerMap<"background">["OFFSCREEN_DOWNLOAD_PROGRESS"]
    >[1]
  ): Promise<
    Awaited<
      ReturnType<
        RuntimeMessageHandlerMap<"background">["OFFSCREEN_DOWNLOAD_PROGRESS"]
      >
    >
  > {
    if (!(await isCurrentOffscreenSender(sender))) {
      return { success: true, disposition: "lease_not_current" }
    }
    return await runTaskSideEffectExclusive(
      message.payload.taskId,
      async () =>
        await handleOffscreenDownloadProgress(
          this.deps.queueRepository,
          message
        )
    )
  }

  async handleOffscreenInitializationFailed(
    message: Parameters<
      RuntimeMessageHandlerMap<"background">["OFFSCREEN_INITIALIZATION_FAILED"]
    >[0],
    sender: Parameters<
      RuntimeMessageHandlerMap<"background">["OFFSCREEN_INITIALIZATION_FAILED"]
    >[1]
  ): Promise<
    Awaited<
      ReturnType<
        RuntimeMessageHandlerMap<"background">["OFFSCREEN_INITIALIZATION_FAILED"]
      >
    >
  > {
    await closeOffscreenDocumentIfCurrent({
      documentInstanceId: message.payload.documentInstanceId,
      browserDocumentId: sender.documentId,
    })
    return { success: true }
  }
}

export function createBackgroundOffscreenEventMessageHandlers(
  deps: BackgroundRuntimeHandlerDependencies
): Pick<RuntimeMessageHandlerMap<"background">, OffscreenEventMessageType> {
  const handlers = new BackgroundOffscreenEventHandlers(deps)
  return {
    OFFSCREEN_BEGIN_FSA_WRITE:
      handlers.handleOffscreenBeginFsaWrite.bind(handlers),
    OFFSCREEN_JOB_ACCEPTED: handlers.handleOffscreenJobAccepted.bind(handlers),
    OFFSCREEN_JOB_HEARTBEAT:
      handlers.handleOffscreenJobHeartbeat.bind(handlers),
    OFFSCREEN_JOB_TERMINAL: handlers.handleOffscreenJobTerminal.bind(handlers),
    OFFSCREEN_OUTPUT_READY: handlers.handleOffscreenOutputReady.bind(handlers),
    OFFSCREEN_DOWNLOAD_PROGRESS:
      handlers.handleOffscreenDownloadProgress.bind(handlers),
    OFFSCREEN_INITIALIZATION_FAILED:
      handlers.handleOffscreenInitializationFailed.bind(handlers),
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
  // /offscreen.html principal; job and output messages additionally carry the
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
