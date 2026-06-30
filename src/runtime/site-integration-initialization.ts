/**
 * Site integration metadata initialization.
 *
 * This module intentionally imports metadata only. Context-specific runtime
 * implementations are statically registered from separate content/background/
 * offscreen modules so bundlers do not pull wrong-context code into another
 * browser extension context.
 */

import { registerSiteIntegration } from './site-integration-registry';
import logger from '@/src/runtime/logger';
import { getSiteIntegrationManifestById, SITE_INTEGRATION_MANIFESTS } from '../site-integrations/manifest';
import { setUserSiteIntegrationEnablement } from '../site-integrations/registry';
import {
  normalizeEnablementMap,
  SITE_INTEGRATION_ENABLEMENT_STORAGE_KEY,
  siteIntegrationEnablementService,
  type SiteIntegrationEnablementMap,
} from '@/src/storage/site-integration-enablement-service';
import type { RuntimeSiteIntegration } from '../types/site-integrations';

// Singleton guard to prevent duplicate site integration metadata registration
// Ref: Best practice for idempotent initialization
let metadataInitialized = false;
let metadataInitPromise: Promise<void> | null = null;
let integrationEnablementInitialized = false;

/**
 * Default enablement loader: reads `chrome.storage.local` directly.
 *
 * Valid in background service worker and content script contexts, which both
 * have access to `chrome.storage`. MUST NOT be used in the offscreen document,
 * where only `chrome.runtime` is available (see `offscreenEnablementLoader`).
 */
async function defaultEnablementLoader(): Promise<SiteIntegrationEnablementMap> {
  return siteIntegrationEnablementService.getAll();
}

export type SiteIntegrationEnablementLoader = () => Promise<SiteIntegrationEnablementMap>;

export async function initializeSiteIntegrationEnablement(
  loader: SiteIntegrationEnablementLoader = defaultEnablementLoader,
): Promise<void> {
  if (integrationEnablementInitialized) {
    return;
  }

  try {
    const enablement = await loader();
    setUserSiteIntegrationEnablement(enablement);
  } catch (error) {
    logger.warn('Failed to load site integration enablement; using defaults', error);
    setUserSiteIntegrationEnablement({});
  }

  // chrome.storage.onChanged is only available in contexts with the storage API
  // (background, content). The offscreen document only exposes chrome.runtime,
  // so it must not register a storage change listener here; it re-initializes
  // from the background-sourced enablement on each offscreen lifecycle.
  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local' || !(SITE_INTEGRATION_ENABLEMENT_STORAGE_KEY in changes)) {
        return;
      }

      const nextValue: unknown = changes[SITE_INTEGRATION_ENABLEMENT_STORAGE_KEY]?.newValue;
      setUserSiteIntegrationEnablement(normalizeEnablementMap(nextValue));
    });
  }

  integrationEnablementInitialized = true;
}

export function registerSiteIntegrationRuntime(integration: RuntimeSiteIntegration): void {
  const manifest = getSiteIntegrationManifestById(integration.id);
  if (!manifest || manifest.enabled === false) {
    return;
  }

  registerSiteIntegration({
    id: manifest.id,
    name: manifest.name,
    author: manifest.author,
    policyDefaults: manifest.policyDefaults,
    handlesOwnRetries: manifest.handlesOwnRetries,
    customSettings: manifest.customSettings,
    integration,
  });
}

/**
 * Register metadata-only for background context (service worker)
 * Derives all data from SITE_INTEGRATION_MANIFESTS (SSOT)
 */
async function registerSiteIntegrationMetadata(): Promise<void> {
  if (metadataInitialized) {
    return;
  }

  await initializeSiteIntegrationEnablement();

  logger.debug('📋 Registering site integration metadata for background context...');

  for (const manifest of SITE_INTEGRATION_MANIFESTS) {
    if (manifest.enabled === false) {
      continue;
    }

    registerSiteIntegration({
      id: manifest.id,
      name: manifest.name,
      author: manifest.author,
      policyDefaults: manifest.policyDefaults,
      handlesOwnRetries: manifest.handlesOwnRetries,
      customSettings: manifest.customSettings,
    });
  }

  logger.debug('📋 Site integration metadata registered');
  metadataInitialized = true;
}

/**
 * Initialize only site integration metadata and UrlMatcher (no heavy imports).
 * Safe to call from popup/background.
 * Uses singleton pattern to prevent duplicate calls.
 */
export function initializeSiteIntegrationMetadataOnly(): Promise<void> {
  if (metadataInitPromise) {
    return metadataInitPromise;
  }

  metadataInitPromise = registerSiteIntegrationMetadata();
  return metadataInitPromise;
}
