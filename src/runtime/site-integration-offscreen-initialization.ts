import logger from '@/src/runtime/logger'
import { offscreenSiteAdapters } from '@/src/runtime/generated/site-integration-offscreen-registry'
import {
  initializeSiteIntegrationEnablement,
  registerSiteIntegrationRuntime,
} from '@/src/runtime/site-integration-initialization'

let offscreenInitialized = false
let offscreenInitPromise: Promise<void> | null = null

async function registerOffscreenSiteIntegrations(): Promise<void> {
  if (offscreenInitialized) {
    return
  }

  logger.info('🔌 Initializing offscreen site integrations...')

  await initializeSiteIntegrationEnablement()

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
