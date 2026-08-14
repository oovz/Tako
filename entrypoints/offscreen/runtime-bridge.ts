import logger from "@/src/runtime/logger"
import { createRuntimeMessageListener } from "@/src/runtime/runtime-message-dispatcher"
import type {
  OffscreenInitializationState,
  RuntimeMessageReadiness,
} from "@/src/runtime/runtime-message-contracts"
import { classifyRuntimeMessagePrincipal } from "@/src/runtime/runtime-message-sender"
import { sendRuntimeMessage } from "@/src/runtime/send-runtime-message"
import {
  createOffscreenRuntimeMessageHandlers,
  type OffscreenWorkerRuntime,
} from "@/entrypoints/offscreen/offscreen-runtime-message-handlers"

interface RegisterOffscreenRuntimeOptions {
  onInitialized: () => void
  onInitializationError: (errorMessage: string) => void
}

type BufferedReadinessWaiter = {
  resolve: () => void
  reject: (error: Error) => void
}

const MAX_PENDING_INITIALIZATION_WORK_WAITERS = 32
const INITIALIZATION_WORK_QUEUE_FULL_ERROR =
  "Offscreen initialization work queue is full"

export interface OffscreenRuntimeReadinessController {
  waitForReadiness: (readiness: RuntimeMessageReadiness) => Promise<void>
  getInitializationState: () => OffscreenInitializationState
  markInitialized: () => void
  markFailed: (errorMessage: string) => void
}

/**
 * Releases buffered runtime-ready requests in arrival order. Their handlers
 * start deterministically and may then complete concurrently.
 */
export function createOffscreenRuntimeReadinessController(): OffscreenRuntimeReadinessController {
  let initializationState: OffscreenInitializationState = "initializing"
  let failure: Error | null = null
  const waiters: BufferedReadinessWaiter[] = []

  return {
    async waitForReadiness(readiness) {
      if (readiness === "control-ready") return
      if (initializationState === "failed") throw failure!
      if (initializationState === "ready") return
      if (waiters.length >= MAX_PENDING_INITIALIZATION_WORK_WAITERS) {
        throw new Error(INITIALIZATION_WORK_QUEUE_FULL_ERROR)
      }
      await new Promise<void>((resolve, reject) => {
        waiters.push({ resolve, reject })
      })
    },
    getInitializationState() {
      return initializationState
    },
    markInitialized() {
      if (initializationState !== "initializing") return
      initializationState = "ready"
      for (const waiter of waiters.splice(0, waiters.length)) {
        waiter.resolve()
      }
    },
    markFailed(errorMessage) {
      if (initializationState !== "initializing") return
      initializationState = "failed"
      failure = new Error(errorMessage)
      for (const waiter of waiters.splice(0, waiters.length)) {
        waiter.reject(failure)
      }
    },
  }
}

export function registerOffscreenRuntime(
  worker: OffscreenWorkerRuntime,
  options: RegisterOffscreenRuntimeOptions
): void {
  if (
    !options ||
    typeof options.onInitialized !== "function" ||
    typeof options.onInitializationError !== "function"
  ) {
    throw new TypeError(
      "registerOffscreenRuntime requires initialization callbacks"
    )
  }

  const readiness = createOffscreenRuntimeReadinessController()
  const handlers = createOffscreenRuntimeMessageHandlers(
    worker,
    readiness.getInitializationState
  )
  const listener = createRuntimeMessageListener({
    target: "offscreen",
    handlers,
    classifySender: (sender) =>
      classifyRuntimeMessagePrincipal(sender, chrome.runtime.id),
    waitForReadiness: readiness.waitForReadiness,
    reportError: (message, error) => logger.error(message, error),
  })

  // Chrome service-worker messages can arrive as soon as this document loads.
  // Claim the target before starting any asynchronous initialization work.
  chrome.runtime.onMessage.addListener(listener)

  void worker
    .initialize()
    .then(() => {
      readiness.markInitialized()
      options.onInitialized()
      logger.debug("🚀 Offscreen document ready for processing")
    })
    .catch(async (error: unknown) => {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Offscreen worker initialization failed"
      readiness.markFailed(errorMessage)
      options.onInitializationError(errorMessage)
      try {
        const response = await sendRuntimeMessage({
          target: "background",
          type: "OFFSCREEN_INITIALIZATION_FAILED",
          payload: {
            errorMessage,
            documentInstanceId: worker.documentInstanceId,
          },
        })
        if (!response.success) throw new Error(response.error)
      } catch (notificationError) {
        logger.error(
          "❌ Failed to report offscreen initialization failure:",
          notificationError
        )
      }
      logger.error("❌ Failed to initialize offscreen worker:", error)
    })
}
