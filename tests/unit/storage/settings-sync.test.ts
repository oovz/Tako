import { beforeEach } from 'vitest'

import { resetSettingsSyncTestEnvironment } from './settings-sync-test-setup'
import { registerSettingsSyncStateCases } from './settings-sync-state.cases'
import { registerSettingsSyncValidationCases } from './settings-sync-validation.cases'

beforeEach(() => {
  resetSettingsSyncTestEnvironment()
})

registerSettingsSyncStateCases()
registerSettingsSyncValidationCases()

