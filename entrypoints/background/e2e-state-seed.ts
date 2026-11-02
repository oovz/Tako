import type { TabContextStateService } from "@/entrypoints/background/tab-context-state-service"
import type { QueueRepository } from "@/src/storage/queue-repository"
import { setEnablementMap } from "@/src/site-integrations/catalog"
import type { SiteIntegrationEnablementService } from "@/src/storage/site-integration-enablement-service"
import { normalizeEnablementMap } from "@/src/domain/site-integrations/storage-schemas"
import type { ResolvedTabReadyContext } from "@/src/types/resolved-tab-context"
import { ResolvedTabContextSchema } from "@/src/runtime/resolved-tab-context-schema"
import { LOCAL_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import { classifyRuntimeMessagePrincipal } from "@/src/runtime/runtime-message-sender"
import { isRecord } from "@/src/shared/type-guards"

export const E2E_SEED_DOWNLOAD_QUEUE_MESSAGE =
  "E2E_SEED_DOWNLOAD_QUEUE" as const
export const E2E_SEED_TAB_CONTEXT_MESSAGE = "E2E_SEED_TAB_CONTEXT" as const

type QueueSeedPayload = {
  // The repository validates stored task state during hydration.
  downloadQueue: unknown[]
  siteIntegrationEnablement?: Record<string, unknown>
}

type TabContextSeedPayload = {
  tabId: number
  context: ResolvedTabReadyContext
}

type SeedRequest =
  | { type: typeof E2E_SEED_DOWNLOAD_QUEUE_MESSAGE; payload: QueueSeedPayload }
  | {
      type: typeof E2E_SEED_TAB_CONTEXT_MESSAGE
      payload: TabContextSeedPayload
    }

interface SeedDependencies {
  ensureRuntimeReady: () => Promise<void>
  getTabContextStateService: () => Pick<
    TabContextStateService,
    "commitResolvedTabContext"
  >
  cancelTabContextResolution: (tabId: number) => void
  queueRepository: Pick<QueueRepository, "initialize">
  siteIntegrationEnablementService: Pick<
    SiteIntegrationEnablementService,
    "setAll"
  >
}

function readQueueSeed(
  payload: Record<string, unknown>
): QueueSeedPayload | null {
  if (!Array.isArray(payload.downloadQueue)) return null
  const enablement = payload.siteIntegrationEnablement
  if (enablement !== undefined && !isRecord(enablement)) return null
  return {
    downloadQueue: payload.downloadQueue,
    siteIntegrationEnablement: enablement,
  }
}

function readTabContextSeed(
  payload: Record<string, unknown>
): TabContextSeedPayload | null {
  const tabId = payload.tabId
  if (typeof tabId !== "number" || !Number.isInteger(tabId) || tabId < 0) {
    return null
  }
  const parsed = ResolvedTabContextSchema.safeParse(payload.context)
  if (!parsed.success || parsed.data.context !== "ready") return null
  return { tabId, context: parsed.data }
}

function readSeedRequest(message: Record<string, unknown>): SeedRequest | null {
  if (!isRecord(message.payload)) return null
  switch (message.type) {
    case E2E_SEED_DOWNLOAD_QUEUE_MESSAGE: {
      const payload = readQueueSeed(message.payload)
      return payload ? { type: message.type, payload } : null
    }
    case E2E_SEED_TAB_CONTEXT_MESSAGE: {
      const payload = readTabContextSeed(message.payload)
      return payload ? { type: message.type, payload } : null
    }
    default:
      return null
  }
}

async function seedDownloadQueue(
  payload: QueueSeedPayload,
  input: SeedDependencies
): Promise<void> {
  if (payload.siteIntegrationEnablement !== undefined) {
    const enablement = normalizeEnablementMap(payload.siteIntegrationEnablement)
    await input.siteIntegrationEnablementService.setAll(enablement)
    // The running background needs the test profile before mocked navigation.
    setEnablementMap(enablement)
  }
  await chrome.storage.local.set({
    [LOCAL_STORAGE_KEYS.downloadQueue]: structuredClone(payload.downloadQueue),
  })
  await input.queueRepository.initialize()
}

async function seedTabContext(
  payload: TabContextSeedPayload,
  input: SeedDependencies
): Promise<void> {
  const tab = await chrome.tabs.get(payload.tabId)
  const expectedUrl = payload.context.sourceUrl
  const currentUrl = tab.url ?? tab.pendingUrl
  if (
    tab.active !== true ||
    typeof tab.windowId !== "number" ||
    currentUrl !== expectedUrl
  ) {
    throw new Error("E2E tab context target is not the active source page")
  }

  input.cancelTabContextResolution(payload.tabId)
  const result = await input
    .getTabContextStateService()
    .commitResolvedTabContext(payload.context, payload.tabId, {
      windowId: tab.windowId,
      expectedUrl,
      supersedeInFlight: true,
    })
  if (!result.success) {
    throw new Error("E2E tab context seed was rejected")
  }
  // An activation can start during the serialized commit. Cancel that owner
  // before it can publish a provider result over the authoritative seed.
  input.cancelTabContextResolution(payload.tabId)
}

async function applySeedRequest(
  request: SeedRequest,
  input: SeedDependencies
): Promise<{ success: true }> {
  await input.ensureRuntimeReady()
  switch (request.type) {
    case E2E_SEED_DOWNLOAD_QUEUE_MESSAGE:
      await seedDownloadQueue(request.payload, input)
      return { success: true }
    case E2E_SEED_TAB_CONTEXT_MESSAGE:
      await seedTabContext(request.payload, input)
      return { success: true }
  }
}

/**
 * Register the state seeding adapter used only by isolated E2E and live-test
 * builds. The compile-time guard lives in the background entrypoint;
 * production builds never register this message listener.
 */
export function registerE2EStateSeedListener(input: SeedDependencies): void {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isRecord(message) || message.target !== "e2e") return false

    const request = readSeedRequest(message)
    if (!request) {
      sendResponse({ success: false, error: "Invalid E2E seed request" })
      return true
    }

    const principal = classifyRuntimeMessagePrincipal(sender, chrome.runtime.id)
    if (principal !== "sidepanel" && principal !== "options") {
      sendResponse({ success: false, error: "Unauthorized E2E seed sender" })
      return true
    }

    void applySeedRequest(request, input)
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
