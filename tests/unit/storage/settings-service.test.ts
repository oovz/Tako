/**
 * Unit Tests: Settings Service
 * 
 * Tests settings persistence, default initialization, validation/normalization,
 * partial updates, and chrome.storage.local integration.
 */

import { beforeEach, describe } from 'vitest';
import { registerSettingsServiceCacheAndErrorCases } from './settings-service-cache-errors.cases';
import { registerSettingsServicePersistenceAndValidationCases } from './settings-service-persistence-validation.cases';
import { registerSettingsServiceUpdatesAndHelpersCases } from './settings-service-updates-helpers.cases';
import { resetSettingsServiceTestEnvironment } from './settings-service-test-setup';

describe('Settings Service', () => {
  beforeEach(async () => {
    await resetSettingsServiceTestEnvironment();
  });

  registerSettingsServicePersistenceAndValidationCases();
  registerSettingsServiceUpdatesAndHelpersCases();
  registerSettingsServiceCacheAndErrorCases();
});

