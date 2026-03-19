/**
 * Background Script - Refactored with Focused Modules
 * 
 * Simple orchestrator that delegates to focused modules:
 * - State management → state-manager.ts
 * - Download queue → download-queue.ts  
 * - Offscreen lifecycle → offscreen-lifecycle.ts
 */

import { defineBackground } from 'wxt/utils/define-background';
import type {
  ExtensionMessage,
  ExtensionMessageResponse,
} from '@/src/types/extension-messages';
import logger from '@/src/runtime/logger';

// Import focused modules
import type { CentralizedStateManager } from '@/src/runtime/centralized-state';
import {
  configurePixivImageRefererRewriteRule,
  initializeBackgroundRuntime,
} from '@/entrypoints/background/background-startup';
import {
  backgroundHandledMessages,
  handleBackgroundMessage,
  offscreenOnlyMessages,
} from '@/entrypoints/background/background-message-router';
import { registerBackgroundNavigationListeners } from '@/entrypoints/background/background-navigation-listeners';
import { registerBackgroundRuntimeListeners } from '@/entrypoints/background/background-runtime-listeners';
import {
  ensureOffscreenDocumentReady,
  LIVENESS_ALARM_NAME,
  ensureLivenessAlarm,
} from '@/entrypoints/background/offscreen-lifecycle';
import { createPendingDownloadsStore } from '@/entrypoints/background/pending-downloads';
import { tabContextCache } from '@/entrypoints/background/tab-cache';
import { createTabUiCoordinator } from '@/entrypoints/background/tab-ui-coordinator';
import { createInitializationBarrier } from '@/entrypoints/background/initialization-barrier';

// Global state manager instance
let stateManager!: CentralizedStateManager; // set during initializeExtensionRuntime()
const pendingDownloadsStore = createPendingDownloadsStore();
const tabUiCoordinator = createTabUiCoordinator()
const initializationBarrier = createInitializationBarrier({
  isInitialized: () => Boolean(stateManager),
  initialize: async () => {
    await initializeExtensionRuntime();
  },
});

async function requestBlobRevocation(blobUrl: string): Promise<void> {
  try {
    await chrome.runtime.sendMessage({
      type: 'REVOKE_BLOB_URL',
      payload: { blobUrl },
    } as ExtensionMessage);
  } catch (error) {
    logger.debug('Failed to request blob URL revocation (non-fatal):', error);
  }
}

/**
 * Ensure state manager is initialized (lazy initialization)
 */
async function ensureStateManagerInitialized(): Promise<void> {
  await initializationBarrier.ensureInitialized();
}

/**
 * Initialize extension runtime services and state
 */
async function initializeExtensionRuntime(): Promise<void> {
  stateManager = await initializeBackgroundRuntime({
    pendingDownloadsStore,
    ensureLivenessAlarm,
    ensureOffscreenDocumentReady,
  })
}

/**
 * Handle state action messages from other components
 */
async function handleMessage(message: ExtensionMessage, sender: chrome.runtime.MessageSender): Promise<ExtensionMessageResponse | null> {
  return await handleBackgroundMessage(message, sender, {
    ensureStateManagerInitialized,
    getStateManager: () => stateManager,
    ensureOffscreenDocumentReady,
    pendingDownloadsStore,
    requestBlobRevocation,
  })
}

export default defineBackground({
  type: 'module',
  main() {
    logger.info('Background script starting');

    // Initialize architecture
    ensureStateManagerInitialized().catch((error) => {
      logger.error('Failed to initialize architecture:', error);
    });

    void configurePixivImageRefererRewriteRule();

    // Configure side panel behavior: open on action click
    try {
      chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => { });
    } catch (e) {
      logger.debug('sidePanel.setPanelBehavior unavailable', e);
    }

    // Set up message listener
    chrome.runtime.onMessage.addListener((
      message: ExtensionMessage,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: ExtensionMessageResponse) => void,
    ) => {
      // CRITICAL: Synchronously return false for offscreen-targeted messages
      // This allows the offscreen document's listener to receive and handle them
      // Ref: https://developer.chrome.com/docs/extensions/develop/concepts/messaging
      if (offscreenOnlyMessages.includes(message.type as (typeof offscreenOnlyMessages)[number])) {
        return false; // Don't handle - let offscreen document receive it
      }

      // Only keep channel open for message types background is responsible for.
      // Avoids "listener indicated an asynchronous response" errors for pass-through messages.
      if (!backgroundHandledMessages.has(message.type)) {
        logger.debug(`Background skipping unowned message type: ${message.type}`);
        return false;
      }

      ensureStateManagerInitialized()
        .then(() => handleMessage(message, sender))
        .then((response) => {
          if (response === null) {
            sendResponse({ success: false, error: `Unhandled message type in background: ${message.type}` });
            return;
          }
          sendResponse(response);
        })
        .catch((error) => {
          const msg = error instanceof Error ? error.message : 'Unknown error';
          logger.error('Message handler error:', error);
          sendResponse({ success: false, error: msg });
        });
      return true; // Keep message channel open for async response
    });

    registerBackgroundRuntimeListeners({
      ensureStateManagerInitialized,
      isStateManagerReady: () => Boolean(stateManager),
      getStateManager: () => stateManager,
      pendingDownloadsStore,
      requestBlobRevocation,
      tabContextCache,
      ensureOffscreenDocumentReady,
      livenessAlarmName: LIVENESS_ALARM_NAME,
    })

    // Removed keyboard shortcut open: per user stories, only extension icon opens the Side Panel

    // REMOVED: setInterval polling (violates Chrome service worker guidelines)
    // Queue processing is now event-driven:
    // - Triggered immediately when tasks are added
    // - Triggered when tasks complete/fail
    // - Service worker can sleep when idle (30s timeout)
    // See: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle

    registerBackgroundNavigationListeners({
      ensureStateManagerInitialized,
      getStateManager: () => stateManager,
      tabContextCache,
      tabUiCoordinator,
    })

    logger.info('Background script initialized');

  },
});

