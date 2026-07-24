import type { CentralizedStateManager } from "@/src/runtime/centralized-state"
import { setUserSiteIntegrationEnablement } from "@/src/site-integrations/registry"
import {
  normalizeEnablementMap,
  siteIntegrationEnablementService,
  type SiteIntegrationEnablementMap,
} from "@/src/storage/site-integration-enablement-service"
import type { DownloadTaskState } from "@/src/types/queue-state"

export const E2E_SEED_DOWNLOAD_QUEUE_MESSAGE =
  "E2E_SEED_DOWNLOAD_QUEUE" as const

type E2ESeedDownloadQueueMessage = {
  type: typeof E2E_SEED_DOWNLOAD_QUEUE_MESSAGE
  payload: {
    downloadQueue: DownloadTaskState[]
    siteIntegrationEnablement?: SiteIntegrationEnablementMap
  }
}

function isSeedMessage(
  message: unknown
): message is E2ESeedDownloadQueueMessage {
  if (!message || typeof message !== "object") {
    return false
  }

  const candidate = message as {
    type?: unknown
    payload?: {
      downloadQueue?: unknown
      siteIntegrationEnablement?: unknown
    }
  }
  return (
    candidate.type === E2E_SEED_DOWNLOAD_QUEUE_MESSAGE &&
    Array.isArray(candidate.payload?.downloadQueue) &&
    (candidate.payload?.siteIntegrationEnablement === undefined ||
      (typeof candidate.payload.siteIntegrationEnablement === "object" &&
        candidate.payload.siteIntegrationEnablement !== null &&
        !Array.isArray(candidate.payload.siteIntegrationEnablement)))
  )
}

/**
 * Register the queue seeding adapter used only by deterministic E2E builds.
 * The compile-time guard lives in the background entrypoint; production and
 * live builds never register this message listener.
 */
export function registerE2EStateSeedListener(input: {
  ensureStateManagerInitialized: () => Promise<void>
  getStateManager: () => CentralizedStateManager
}): void {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isSeedMessage(message)) {
      return false
    }

    void (async () => {
      await input.ensureStateManagerInitialized()
      if (message.payload.siteIntegrationEnablement !== undefined) {
        const enablement = normalizeEnablementMap(
          message.payload.siteIntegrationEnablement
        )
        await siteIntegrationEnablementService.setAll(enablement)
        // Storage events converge other contexts eventually. The running
        // background must use this test profile immediately, before the next
        // mocked navigation is allowed to resolve.
        setUserSiteIntegrationEnablement(enablement)
      }
      await input.getStateManager().updateGlobalState({
        downloadQueue: message.payload.downloadQueue,
      })
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
