import logger from '@/src/runtime/logger'
import { contentSiteAdapters } from '@/src/runtime/generated/site-integration-content-registry'
import {
  initializeSiteIntegrationEnablement,
  registerSiteIntegrationRuntime,
} from '@/src/runtime/site-integration-initialization'

let contentInitialized = false
let contentInitPromise: Promise<void> | null = null

async function registerContentSiteIntegrations(): Promise<void> {
  if (contentInitialized) {
    return
  }

  logger.info('🔌 Initializing content site integrations...')

  await initializeSiteIntegrationEnablement()

  for (const integration of contentSiteAdapters) {
    registerSiteIntegrationRuntime(integration)
  }

  contentInitialized = true
  logger.info('✅ Content site integrations initialized')
}

export function initializeContentSiteIntegrations(): Promise<void> {
  contentInitPromise ??= registerContentSiteIntegrations()
  return contentInitPromise
}
