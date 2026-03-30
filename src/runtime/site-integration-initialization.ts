/**
 * Site Integration Registration / Loader - Initialize all site integrations
 *
 * Role:
 * - In background (service worker): register metadata-only (no DOM access) so we can resolve
 *   site integrations by URL without importing heavy DOM-dependent modules.
 * - In content/offscreen contexts: import full site integration implementations and register them
 *   with the registry so content extraction and network logic are available.
 *
 * All site integration metadata is derived from the unified manifest (SSOT):
 * @see src/site-integrations/manifest.ts
 */

import { registerSiteIntegration, siteIntegrationRegistry } from './site-integration-registry';
import logger from '@/src/runtime/logger';
import { SITE_INTEGRATION_MANIFESTS, getSiteIntegrationManifestById, type SiteIntegrationManifest } from '../site-integrations/manifest';
import { setUserSiteIntegrationEnablement } from '../site-integrations/registry';
import {
  normalizeEnablementMap,
  SITE_INTEGRATION_ENABLEMENT_STORAGE_KEY,
  siteIntegrationEnablementService,
} from '@/src/storage/site-integration-enablement-service';
import type { SiteIntegration } from '../types/site-integrations';

const siteIntegrationModuleLoaders = import.meta.glob<Record<string, unknown>>('../site-integrations/*/runtime.ts');

// Singleton guard to prevent duplicate site integration metadata registration
// Ref: Best practice for idempotent initialization
let metadataInitialized = false;
let metadataInitPromise: Promise<void> | null = null;
let integrationEnablementInitialized = false;

async function initializeSiteIntegrationEnablement(): Promise<void> {
  if (integrationEnablementInitialized) {
    return;
  }

  try {
    const enablement = await siteIntegrationEnablementService.getAll();
    setUserSiteIntegrationEnablement(enablement);
  } catch (error) {
    logger.warn('Failed to load site integration enablement; using defaults', error);
    setUserSiteIntegrationEnablement({});
  }

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
      version: manifest.version,
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

/**
 * Dynamically import a site integration module based on manifest configuration
 */
async function importSiteIntegration(manifest: SiteIntegrationManifest): Promise<SiteIntegration> {
  const modulePath = manifest.importPath.endsWith('.ts')
    ? manifest.importPath
    : `${manifest.importPath}.ts`;
  const loader = siteIntegrationModuleLoaders[modulePath];

  if (!loader) {
    throw new Error(`Unknown site integration module: ${manifest.id}`);
  }

  const loadedModule = await loader();
  const integration = loadedModule[manifest.exportName];
  if (!integration) {
    throw new Error(`Site integration export not found: ${manifest.id}.${manifest.exportName}`);
  }

  return integration as SiteIntegration;
}

export async function getSiteIntegrationById(siteId: string): Promise<SiteIntegration | undefined> {
  const registeredIntegration = siteIntegrationRegistry.findById(siteId)?.integration;
  if (registeredIntegration) {
    return registeredIntegration;
  }

  await initializeSiteIntegrationMetadataOnly();

  const metadataOnlyRegistration = siteIntegrationRegistry.findById(siteId)?.integration;
  if (metadataOnlyRegistration) {
    return metadataOnlyRegistration;
  }

  const manifest = getSiteIntegrationManifestById(siteId);
  if (!manifest || manifest.enabled === false) {
    return undefined;
  }

  const integration = await importSiteIntegration(manifest);
  registerSiteIntegration({
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    author: manifest.author,
    policyDefaults: manifest.policyDefaults,
    handlesOwnRetries: manifest.handlesOwnRetries,
    customSettings: manifest.customSettings,
    integration,
  });

  return integration;
}

/**
 * Initialize all site integrations
 * Derives all configuration from SITE_INTEGRATION_MANIFESTS (SSOT)
 */
export async function initializeSiteIntegrations(): Promise<void> {
  logger.info('🔌 Initializing site integrations...');

  try {
    await initializeSiteIntegrationEnablement();

    const isServiceWorkerContext = (
      typeof importScripts === 'function' ||
      (typeof self !== 'undefined' && self.constructor?.name === 'ServiceWorkerGlobalScope') ||
      (typeof globalThis !== 'undefined' && globalThis.constructor?.name === 'ServiceWorkerGlobalScope')
    );

    let hasDocument = false;
    let hasWindow = false;

    try {
      hasDocument = typeof document !== 'undefined' && document !== null;
    } catch {
      hasDocument = false;
    }

    try {
      hasWindow = typeof window !== 'undefined' && window !== null;
    } catch {
      hasWindow = false;
    }

    if (isServiceWorkerContext || (!hasDocument && !hasWindow)) {
      logger.warn('⚠️ Detected service worker/background context - registering metadata only');
      await registerSiteIntegrationMetadata();
      return;
    }

    logger.info('📦 Loading site integration modules...');

    for (const manifest of SITE_INTEGRATION_MANIFESTS) {
      if (manifest.enabled === false) {
        continue;
      }

      const integration = await importSiteIntegration(manifest);
      registerSiteIntegration({
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        author: manifest.author,
        policyDefaults: manifest.policyDefaults,
        handlesOwnRetries: manifest.handlesOwnRetries,
        customSettings: manifest.customSettings,
        integration,
      });
    }

    logger.info('✅ All site integrations initialized');
  } catch (error) {
    logger.error('❌ Failed to initialize site integrations:', error);
    throw error;
  }
}

