import { siteIntegrationRegistry } from './site-integration-registry';
import {
  initializeSiteIntegrationMetadataOnly,
  registerSiteIntegrationRuntime,
} from './site-integration-initialization';
import { SITE_INTEGRATION_MANIFESTS, getSiteIntegrationManifestById } from '../site-integrations/manifest';
import type { BackgroundSiteAdapter } from '../types/site-integrations';
import { backgroundSiteAdaptersById } from './generated/site-integration-background-registry';

function resolveStaticBackgroundSiteAdapter(siteId: string): BackgroundSiteAdapter | undefined {
  const manifest = getSiteIntegrationManifestById(siteId);
  if (!manifest || manifest.enabled === false) {
    return undefined;
  }

  return backgroundSiteAdaptersById[manifest.id];
}

function registerBackgroundSiteAdapter(integration: BackgroundSiteAdapter): void {
  const manifest = getSiteIntegrationManifestById(integration.id);
  if (!manifest || manifest.enabled === false) {
    return;
  }

  registerSiteIntegrationRuntime(integration);
}

export async function getBackgroundSiteAdapterById(siteId: string): Promise<BackgroundSiteAdapter | undefined> {
  const registeredIntegration = siteIntegrationRegistry.findById(siteId)?.integration;
  if (registeredIntegration?.background) {
    return {
      id: registeredIntegration.id,
      background: registeredIntegration.background,
    };
  }

  await initializeSiteIntegrationMetadataOnly();

  const metadataOnlyRegistration = siteIntegrationRegistry.findById(siteId)?.integration;
  if (metadataOnlyRegistration?.background) {
    return {
      id: metadataOnlyRegistration.id,
      background: metadataOnlyRegistration.background,
    };
  }

  const integration = resolveStaticBackgroundSiteAdapter(siteId);
  if (!integration) {
    return undefined;
  }

  registerBackgroundSiteAdapter(integration);
  return integration;
}

export async function initializeBackgroundSiteIntegrations(): Promise<void> {
  await initializeSiteIntegrationMetadataOnly();

  for (const manifest of SITE_INTEGRATION_MANIFESTS) {
    if (manifest.enabled === false) {
      continue;
    }

    const integration = backgroundSiteAdaptersById[manifest.id];
    if (integration) {
      registerBackgroundSiteAdapter(integration);
    }
  }
}
