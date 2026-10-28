import { beforeEach, describe } from "vitest"
import { registerSiteOverridesCrudCases } from "./site-overrides-service-crud.cases"
import { registerSiteOverridesEdgeCases } from "./site-overrides-service-edge-cases.cases"
import { registerSiteOverridesStructureAndIntegrationCases } from "./site-overrides-service-structure-integration.cases"
import { resetSiteOverridesServiceTestEnvironment } from "./site-overrides-service-test-setup"

describe("site-overrides-service", () => {
  beforeEach(async () => {
    await resetSiteOverridesServiceTestEnvironment()
  })

  registerSiteOverridesCrudCases()
  registerSiteOverridesStructureAndIntegrationCases()
  registerSiteOverridesEdgeCases()
})
