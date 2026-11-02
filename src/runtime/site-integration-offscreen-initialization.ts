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
 * Load persisted enablement through the background; offscreen has no storage API.
 * Read failures stop initialization so disabled integrations stay disabled.
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
