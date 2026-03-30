import { beforeEach } from 'vitest'

import { registerSiteIntegrationEnablementServiceCases } from './site-integration-enablement-service.cases'
import { resetSiteIntegrationEnablementServiceTestEnvironment } from './site-integration-enablement-service-test-setup'

beforeEach(async () => {
  await resetSiteIntegrationEnablementServiceTestEnvironment()
})

registerSiteIntegrationEnablementServiceCases()
