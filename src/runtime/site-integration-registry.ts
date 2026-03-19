/**
 * Site Integration Registry - Site Integration Management System
 *
 * Role:
 * - Authoritative store for site integration metadata and optional runtime implementations.
 * - Resolves SiteIntegrationInfo by URL via centralized UrlMatcher metadata.
 * - Validates site integration shape when full implementations are registered.
 *
 * Note: Initialization/loading of site integrations is performed by site-integration-initialization.ts.
 */

import type { SiteIntegration } from '../types/site-integrations';
import type { SettingsFieldSchema } from '@/src/site-integrations/manifest';
import { matchUrl } from '../site-integrations/url-matcher'
import logger from '@/src/runtime/logger';

export interface SiteIntegrationInfo {
  id: string;
  name: string;
  version: string;
  author: string;
  integration?: SiteIntegration; // Optional for metadata-only registration in background context
  // Optional site integration-level default policy (second tier after site override)
  policyDefaults?: {
    image?: { concurrency?: number; delayMs?: number };
    chapter?: { concurrency?: number; delayMs?: number };
  };
  /**
   * Site integration retry override
   * When true, the extension's default retry wrapper is skipped.
   * The site integration implements internal retry logic (e.g., MangaDex parses X-RateLimit-Retry-After).
   * Default: false (extension's exponential backoff applies)
   */
  handlesOwnRetries?: boolean;
  customSettings?: SettingsFieldSchema[];
}

/**
 * Global site integration registry
 */
class SiteIntegrationRegistry {
  private integrations = new Map<string, SiteIntegrationInfo>();

  /**
   * Register a new site integration
   * 
   * Idempotent: If site integration with same ID is already registered with full implementation,
   * skip re-registration to avoid duplicate logs. If existing is metadata-only and new
   * registration has full implementation, upgrade the registration.
   */
  register(info: SiteIntegrationInfo): void {
    const existing = this.integrations.get(info.id);

    // Skip if already fully registered with same version
    if (existing && existing.integration && existing.version === info.version) {
      logger.debug(`⏭️ Site integration ${info.id} already registered, skipping`);
      return;
    }

    // Skip if re-registering metadata-only when we already have it
    if (existing && !info.integration && !existing.integration) {
      logger.debug(`⏭️ Site integration metadata ${info.id} already registered, skipping`);
      return;
    }

    logger.info(`📝 Registering site integration: ${info.name} v${info.version}`);

    // Validate site integration structure
    this.validateIntegration(info);

    // Register site integration (URL patterns handled separately via constants)
    this.integrations.set(info.id, info);

    logger.info(`✅ Site integration ${info.id} registered successfully`);
  }

  /**
   * Find site integration by URL
   */
  findByUrl(url: string): SiteIntegrationInfo | null {
    const m = matchUrl(url)
    if (!m) return null
    return this.integrations.get(m.integrationId) ?? null
  }

  /**
   * Find site integration by ID
   */
  findById(id: string): SiteIntegrationInfo | null {
    return this.integrations.get(id) || null;
  }

  /**
   * Get all registered site integrations
   */
  getAll(): SiteIntegrationInfo[] {
    return Array.from(this.integrations.values());
  }



  /**
   * Check if URL is supported
   */
  isSupported(url: string): boolean {
    return this.findByUrl(url) !== null;
  }

  /**
   * Validate site integration structure
   */
  private validateIntegration(info: SiteIntegrationInfo): void {
    if (!info.id || !info.name) {
      throw new Error('Site integration must have id and name properties');
    }
    // Skip validation if it's metadata-only registration
    if (!info.integration) {
      logger.debug(`📋 Registering metadata-only for site integration: ${info.id}`);
      return;
    }
    // Validate full site integration if present
    if (!info.integration.content || !info.integration.background) {
      throw new Error('Site integration must have both content and background implementations');
    }
    // Validate content integration
    const content = info.integration.content;
    if (!content.series) {
      throw new Error('Content integration must have series implementation');
    }
    // Validate background integration
    const background = info.integration.background;
    if (!background.chapter) {
      throw new Error('Background integration must have chapter implementation');
    }
  }

  /**
   * Clear all site integrations (for testing)
   */
  clear(): void {
    this.integrations.clear();
  }
}

// Export singleton instance
export const siteIntegrationRegistry = new SiteIntegrationRegistry();

/**
 * Helper function to register a site integration
 */
export function registerSiteIntegration(info: SiteIntegrationInfo): void {
  siteIntegrationRegistry.register(info);
}

/**
 * Helper function to find site integration by URL
 */
export function findSiteIntegrationForUrl(url: string): SiteIntegrationInfo | null {
  return siteIntegrationRegistry.findByUrl(url);
}

/**
 * Helper function to check if URL is supported
 */
export function isUrlSupported(url: string): boolean {
  return siteIntegrationRegistry.isSupported(url);
}


