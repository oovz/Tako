/**
 * Unit Tests: Download Queue Manager
 * 
 * Tests task orchestration, queue processing with global single-active-task
 * semantics, same-tab/same-series queuing behavior, and state transitions.
 */

import { beforeEach, describe } from 'vitest';
import { registerDownloadQueueBehaviorCases } from './download-queue-queue-behavior.cases';
import { registerDownloadQueueFinalizationCases } from './download-queue-finalization.cases';
import { registerDownloadQueueStartAndProcessCases } from './download-queue-start-process.cases';
import { resetDownloadQueueTestEnvironment } from './download-queue-test-setup';

describe('Download Queue Manager', () => {
  beforeEach(async () => {
    await resetDownloadQueueTestEnvironment();
  });

  registerDownloadQueueStartAndProcessCases();
  registerDownloadQueueBehaviorCases();
  registerDownloadQueueFinalizationCases();
});

