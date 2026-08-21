import logger from "@/src/runtime/logger"
import {
  initializeSiteIntegrationEnablement,
  type SiteIntegrationEnablementLoader,
} from "@/src/runtime/site-integration-initialization"
import type { SiteIntegrationEnablementMap } from "@/src/domain/site-integrations/storage-schemas"
import { sendRuntimeMessage } from "@/src/runtime/send-runtime-message"

let offscreenInitialized = false
let offscreenInitPromise: Promise<void> | null = null

/**
 * Offscreen-context enablement loader.
 *
 * The offscreen document only has access to `chrome.runtime`; `chrome.storage`
 * is NOT available there. We must request the site integration enablement map
 * from the background service worker via messaging instead of reading storage
 * directly. The background handler for `GET_SITE_INTEGRATION_ENABLEMENT` reads
 * `chrome.storage.local` and returns the normalized map.
 *
 * Initialization fails when the background cannot provide the persisted map.
 * Treating an unreadable setting as "all defaults" could enable an integration
 * the user explicitly disabled.
 */
const offscreenEnablementLoader: SiteIntegrationEnablementLoader = async () => {
  const response = await sendRuntimeMessage({
    target: "background",
    type: "GET_SITE_INTEGRATION_ENABLEMENT",
  })

  if (!response || !response.success) {
    throw new Error(
      response
        ? `Failed to load site integration enablement: ${response.error}`
        : "Failed to load site integration enablement: no response"
    )
  }

  return response.enablement
}

export function loadOffscreenSiteIntegrationEnablement(): Promise<SiteIntegrationEnablementMap> {
  return offscreenEnablementLoader()
}

async function registerOffscreenSiteIntegrations(): Promise<void> {
  if (offscreenInitialized) {
    return
  }

  logger.info("🔌 Initializing offscreen site integrations...")

  // Offscreen must NOT read chrome.storage directly; route through background.
  await initializeSiteIntegrationEnablement(offscreenEnablementLoader)

  offscreenInitialized = true
  logger.info("✅ Offscreen site integrations initialized")
}

export function initializeOffscreenSiteIntegrations(): Promise<void> {
  offscreenInitPromise ??= registerOffscreenSiteIntegrations().catch(
    (error) => {
      offscreenInitPromise = null
      throw error
    }
  )
  return offscreenInitPromise
}
