/**
 * Unit Tests: Chapter Persistence Service
 * 
 * Tests download history tracking, NEW badge logic,
 * CRUD operations, series history, and storage cleanup.
 */

import { beforeEach, describe } from 'vitest';
import { registerChapterPersistenceCrudCases } from './chapter-persistence-service-crud.cases';
import { registerChapterPersistenceMaintenanceCases } from './chapter-persistence-service-maintenance.cases';
import { registerChapterPersistenceStatusAndErrorCases } from './chapter-persistence-service-status-errors.cases';
import { resetChapterPersistenceServiceTestEnvironment } from './chapter-persistence-service-test-setup';

describe('Chapter Persistence Service', () => {
  beforeEach(async () => {
    await resetChapterPersistenceServiceTestEnvironment();
  });

  registerChapterPersistenceCrudCases();
  registerChapterPersistenceMaintenanceCases();
  registerChapterPersistenceStatusAndErrorCases();
});

