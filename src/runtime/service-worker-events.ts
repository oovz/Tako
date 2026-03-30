/**
 * Service Worker Event Wrapper Module
 * 
 * Implements the pattern recommended in Chrome extension documentation:
 * - Robust state hydration from chrome.storage.session
 * - Wrapped event listeners that wait for initialization
 * - Eliminates race conditions in Service Worker lifecycle
 */

import { createInitializationBarrier } from '@/entrypoints/background/initialization-barrier';
import logger from '@/src/runtime/logger';

let initialized = false;

async function configureSessionAccessLevel(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome?.storage?.session) {
    initialized = true;
    return;
  }

  try {
    const session = chrome.storage.session as chrome.storage.StorageArea & {
      setAccessLevel?: (options: { accessLevel: string }) => Promise<void>;
    };

    if (session.setAccessLevel) {
      await session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
      logger.info('✅ Storage access level set to TRUSTED_CONTEXTS');
    } else {
      logger.debug('ℹ️ storage.session.setAccessLevel unavailable; skipping');
    }
  } catch (accessError) {
    logger.warn('⚠️ Storage access level setting failed:', accessError);
  } finally {
    initialized = true;
  }
}

const initializationBarrier = createInitializationBarrier({
  isInitialized: () => initialized,
  initialize: configureSessionAccessLevel,
});

/**
 * Wait for initialization to complete
 */
export async function waitForInitialization(): Promise<void> {
  await initializationBarrier.ensureInitialized();
}

