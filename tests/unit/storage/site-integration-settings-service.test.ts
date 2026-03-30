import { beforeEach } from 'vitest'

import { registerSiteIntegrationSettingsResolutionCases } from './site-integration-settings-service-resolution.cases'
import { registerSiteIntegrationSettingsStorageCases } from './site-integration-settings-service-storage.cases'
import { resetSiteIntegrationSettingsServiceTestEnvironment } from './site-integration-settings-service-test-setup'

beforeEach(async () => {
  await resetSiteIntegrationSettingsServiceTestEnvironment()
})

registerSiteIntegrationSettingsStorageCases()
registerSiteIntegrationSettingsResolutionCases()
