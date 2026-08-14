import type { TabContextStateService } from "@/entrypoints/background/tab-context-state-service"
import type { QueueRepository } from "@/src/storage/queue-repository"
import { setEnablementMap } from "@/src/site-integrations/catalog"
import type { SiteIntegrationEnablementService } from "@/src/storage/site-integration-enablement-service"
import {
  normalizeEnablementMap,
  type SiteIntegrationEnablementMap,
} from "@/src/domain/site-integrations/storage-schemas"
import type { DownloadTaskState } from "@/src/domain/queue/state"
import type { ResolvedTabReadyContext } from "@/src/types/resolved-tab-context"
import { ResolvedTabContextSchema } from "@/src/runtime/resolved-tab-context-schema"
import { LOCAL_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import { classifyRuntimeMessagePrincipal } from "@/src/runtime/runtime-message-sender"

export const E2E_SEED_DOWNLOAD_QUEUE_MESSAGE =
  "E2E_SEED_DOWNLOAD_QUEUE" as const
export const E2E_SEED_TAB_CONTEXT_MESSAGE = "E2E_SEED_TAB_CONTEXT" as const

type E2ESeedDownloadQueueMessage = {
  target: "e2e"
  type: typeof E2E_SEED_DOWNLOAD_QUEUE_MESSAGE
  payload: {
    downloadQueue: DownloadTaskState[]
    siteIntegrationEnablement?: SiteIntegrationEnablementMap
  }
}

type E2ESeedTabContextMessage = {
  target: "e2e"
  type: typeof E2E_SEED_TAB_CONTEXT_MESSAGE
  payload: {
    tabId: number
    context: ResolvedTabReadyContext
  }
}

function isSeedMessage(
  message: unknown
): message is E2ESeedDownloadQueueMessage {
  if (!message || typeof message !== "object") {
    return false
  }

  const candidate = message as {
    target?: unknown
    type?: unknown
    payload?: {
      downloadQueue?: unknown
      siteIntegrationEnablement?: unknown
    }
  }
  return (
    candidate.target === "e2e" &&
    candidate.type === E2E_SEED_DOWNLOAD_QUEUE_MESSAGE &&
    Array.isArray(candidate.payload?.downloadQueue) &&
    (candidate.payload?.siteIntegrationEnablement === undefined ||
      (typeof candidate.payload.siteIntegrationEnablement === "object" &&
        candidate.payload.siteIntegrationEnablement !== null &&
        !Array.isArray(candidate.payload.siteIntegrationEnablement)))
  )
}

function isTabContextSeedMessage(
  message: unknown
): message is E2ESeedTabContextMessage {
  if (!message || typeof message !== "object") {
    return false
  }

  const candidate = message as {
    target?: unknown
    type?: unknown
    payload?: { tabId?: unknown; context?: unknown }
  }
  return (
    candidate.target === "e2e" &&
    candidate.type === E2E_SEED_TAB_CONTEXT_MESSAGE &&
    typeof candidate.payload?.tabId === "number" &&
    Number.isInteger(candidate.payload.tabId) &&
    candidate.payload.tabId >= 0 &&
    ResolvedTabContextSchema.safeParse(candidate.payload.context).success &&
    (candidate.payload.context as { context?: unknown }).context === "ready"
  )
}

/**
 * Register the state seeding adapter used only by isolated E2E and live-test
 * builds. The compile-time guard lives in the background entrypoint;
 * production builds never register this message listener.
 */
export function registerE2EStateSeedListener(input: {
  ensureRuntimeReady: () => Promise<void>
  getTabContextStateService: () => TabContextStateService
  queueRepository: QueueRepository
  siteIntegrationEnablementService: Pick<
    SiteIntegrationEnablementService,
    "setAll"
  >
}): void {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (
      !message ||
      typeof message !== "object" ||
      (message as { target?: unknown }).target !== "e2e"
    ) {
      return false
    }

    const queueSeed = isSeedMessage(message)
    const tabContextSeed = isTabContextSeedMessage(message)
    if (!queueSeed && !tabContextSeed) {
      sendResponse({ success: false, error: "Invalid E2E seed request" })
      return true
    }

    const principal = classifyRuntimeMessagePrincipal(sender, chrome.runtime.id)
    if (principal !== "sidepanel" && principal !== "options") {
      sendResponse({ success: false, error: "Unauthorized E2E seed sender" })
      return true
    }

    void (async () => {
      await input.ensureRuntimeReady()
      if (queueSeed) {
        if (message.payload.siteIntegrationEnablement !== undefined) {
          const enablement = normalizeEnablementMap(
            message.payload.siteIntegrationEnablement
          )
          await input.siteIntegrationEnablementService.setAll(enablement)
          // Storage events converge other contexts eventually. The running
          // background must use this test profile immediately, before the next
          // mocked navigation is allowed to resolve.
          setEnablementMap(enablement)
        }
        await chrome.storage.local.set({
          [LOCAL_STORAGE_KEYS.downloadQueue]: structuredClone(
            message.payload.downloadQueue
          ),
        })
        await input.queueRepository.initialize()
        return { success: true }
      }

      const tab = await chrome.tabs.get(message.payload.tabId)
      const expectedUrl = message.payload.context.sourceUrl
      const currentUrl = tab.url ?? tab.pendingUrl
      if (
        tab.active !== true ||
        typeof tab.windowId !== "number" ||
        currentUrl !== expectedUrl
      ) {
        throw new Error("E2E tab context target is not the active source page")
      }

      const result = await input
        .getTabContextStateService()
        .commitResolvedTabContext(
          message.payload.context,
          message.payload.tabId,
          {
            windowId: tab.windowId,
            expectedUrl,
            supersedeInFlight: true,
          }
        )
      if (!result.success) {
        throw new Error("E2E tab context seed was rejected")
      }
      return { success: true }
    })()
      .then(sendResponse)
      .catch((error: unknown) => {
        sendResponse({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        })
      })

    return true
  })
}
