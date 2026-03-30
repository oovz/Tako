import { beforeEach, describe } from 'vitest';
import { registerCentralizedStateGlobalQueueCases } from './centralized-state-global-queue.cases';
import { registerCentralizedStateInitializationCases } from './centralized-state-initialization.cases';
import { registerCentralizedStateLockAndErrorCases } from './centralized-state-locks-errors.cases';
import { resetCentralizedStateTestEnvironment } from './centralized-state-test-setup';
import { registerCentralizedStateTabUpdateCases } from './centralized-state-tab-updates.cases';

describe('Centralized State Management', () => {
  beforeEach(() => {
    resetCentralizedStateTestEnvironment();
  });

  registerCentralizedStateInitializationCases();
  registerCentralizedStateGlobalQueueCases();
  registerCentralizedStateTabUpdateCases();
  registerCentralizedStateLockAndErrorCases();
});

