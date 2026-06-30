import logger from '@/src/runtime/logger'
import { offscreenSiteAdapters } from '@/src/runtime/generated/site-integration-offscreen-registry'
import {
  initializeSiteIntegrationEnablement,
  registerSiteIntegrationRuntime,
  type SiteIntegrationEnablementLoader,
} from '@/src/runtime/site-integration-initialization'
import type {
  GetSiteIntegrationEnablementMessage,
  GetSiteIntegrationEnablementResponse,
} from '@/src/types/runtime-command-messages'

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
 * On any failure the caller falls back to empty overrides (all defaults),
 * matching the prior graceful-degradation behavior but without the TypeError
 * from touching an unavailable API.
 */
const offscreenEnablementLoader: SiteIntegrationEnablementLoader = async () => {
  const response = await chrome.runtime.sendMessage<
    GetSiteIntegrationEnablementMessage,
    GetSiteIntegrationEnablementResponse
  >({ type: 'GET_SITE_INTEGRATION_ENABLEMENT' })

  if (!response || !response.success) {
    logger.warn(
      'offscreen: background returned no/failed enablement response; using defaults',
      response && !response.success ? response.error : undefined,
    )
    return {}
  }

  return response.enablement
}

async function registerOffscreenSiteIntegrations(): Promise<void> {
  if (offscreenInitialized) {
    return
  }

  logger.info('🔌 Initializing offscreen site integrations...')

  // Offscreen must NOT read chrome.storage directly; route through background.
  await initializeSiteIntegrationEnablement(offscreenEnablementLoader)

  for (const integration of offscreenSiteAdapters) {
    registerSiteIntegrationRuntime(integration)
  }

  offscreenInitialized = true
  logger.info('✅ Offscreen site integrations initialized')
}

export function initializeOffscreenSiteIntegrations(): Promise<void> {
  offscreenInitPromise ??= registerOffscreenSiteIntegrations()
  return offscreenInitPromise
}
