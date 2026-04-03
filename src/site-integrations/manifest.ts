/**
 * Unified Site Integration Manifest - Single Source of Truth (SSOT)
 * 
 * This file is the authoritative source for all site integration metadata including:
 * - Site integration identification (id, name, version, author)
 * - URL patterns (domains, seriesMatches, excludeMatches)
 * - Rate limit policies
 * - Behavioral flags (handlesOwnRetries)
 * 
 * All other systems (site-integration-initialization, url-matcher, WXT content scripts)
 * derive their configuration from this manifest.
 * 
 * To add a new site integration:
 * 1. Add entry to SITE_INTEGRATION_MANIFESTS below
 * 2. Create implementation in src/site-integrations/
 * 3. Add dynamic import in site-integration-initialization.ts
 */

import type { RateScopePolicy } from '../types/rate-policy';

export interface SiteIntegrationUrlPatterns {
  domains: string[];
  seriesMatches: string[];
  excludeMatches?: string[];
}

const MANGADEX_DOMAINS: string[] = Array.from(
  new Set<string>(['mangadex.org'])
);

const PIXIV_COMIC_DOMAINS: string[] = ['comic.pixiv.net'];
const SHONEN_JUMP_PLUS_DOMAINS: string[] = ['shonenjumpplus.com'];

export type SettingsFieldType = 'boolean' | 'string' | 'number' | 'select' | 'multiselect';

export interface SettingsFieldSchema {
  id: string;
  label: string;
  description?: string;
  type: SettingsFieldType;
  defaultValue: string | number | boolean | string[];
  options?: Array<{ label: string; value: string }>;
}

/**
 * Complete site integration manifest - all metadata in one place
 */
export interface SiteIntegrationManifest {
  // Identity
  id: string;
  name: string;
  version: string;
  author: string;

  // URL Patterns
  patterns: SiteIntegrationUrlPatterns;

  // Rate limiting policies (site integration defaults, can be overridden by user settings)
  policyDefaults: {
    image: RateScopePolicy;
    chapter: RateScopePolicy;
  };

  // Behavioral flags
  /**
   * When true, the extension's default retry wrapper is skipped.
   * The site integration implements internal retry logic (e.g., MangaDex parses X-RateLimit-Retry-After).
   */
  handlesOwnRetries?: boolean;

  /**
   * Developer-level integration toggle. Defaults to true when omitted.
   */
  enabled?: boolean;

  /**
   * Optional integration-specific custom settings shown in Options.
   * Values are persisted in chrome.storage.local under siteIntegrationSettings[siteId][fieldId].
   */
  customSettings?: SettingsFieldSchema[];

  // Dynamic import path for the site integration implementation
  // Used by site-integration-initialization to lazily load site integrations
  importPath: string;
  exportName: string;
}

/**
 * All site integration manifests - THE SINGLE SOURCE OF TRUTH
 * 
 * This is the only place where site integration configuration is defined.
 * All other files must derive their data from this array.
 */
export const SITE_INTEGRATION_MANIFESTS: readonly SiteIntegrationManifest[] = [
  {
    id: 'mangadex',
    name: 'MangaDex API',
    version: '1.0.0',
    author: 'TMD Team',
    patterns: {
      domains: MANGADEX_DOMAINS,
      seriesMatches: ['/title/*'],
      excludeMatches: ['/chapter/*'],
    },
    policyDefaults: {
      image: { concurrency: 2, delayMs: 500 },
      chapter: { concurrency: 1, delayMs: 500 },
    },
    handlesOwnRetries: true,
    customSettings: [
      {
        id: 'imageQuality',
        label: 'Image quality',
        description: 'Choose MangaDex image quality preference.',
        type: 'select',
        defaultValue: 'data-saver',
        options: [
          { label: 'Data saver', value: 'data-saver' },
          { label: 'Full quality', value: 'data' },
        ],
      },
      {
        id: 'chapterLanguageFilter',
        label: 'Chapter language filter',
        description: 'Preferred chapter languages (BCP-47 codes).',
        type: 'multiselect',
        defaultValue: [],
        options: [
          { label: 'English (en)', value: 'en' },
          { label: 'Japanese (ja)', value: 'ja' },
          { label: 'Korean (ko)', value: 'ko' },
          { label: 'Chinese (zh)', value: 'zh' },
        ],
      },
      {
        id: 'autoReadMangaDexSettings',
        label: 'Auto-read MangaDex website settings',
        description: 'Use MangaDex website local settings when available.',
        type: 'boolean',
        defaultValue: true,
      },
    ],
    importPath: '../site-integrations/mangadex/runtime',
    exportName: 'mangadexIntegration',
  },
  {
    id: 'pixiv-comic',
    name: 'Pixiv Comic',
    version: '1.0.0',
    author: 'TMD Team',
    patterns: {
      domains: PIXIV_COMIC_DOMAINS,
      seriesMatches: ['/works/*', '/viewer/stories/*', '/episodes/*'],
    },
    policyDefaults: {
      image: { concurrency: 2, delayMs: 1000 },
      chapter: { concurrency: 1, delayMs: 2000 },
    },
    importPath: '../site-integrations/pixiv-comic/runtime',
    exportName: 'pixivComicIntegration',
  },
  {
    id: 'shonenjumpplus',
    name: 'Shonen Jump+',
    version: '1.0.0',
    author: 'TMD Team',
    patterns: {
      domains: SHONEN_JUMP_PLUS_DOMAINS,
      seriesMatches: ['/episode/*'],
    },
    policyDefaults: {
      image: { concurrency: 2, delayMs: 1000 },
      chapter: { concurrency: 1, delayMs: 2000 },
    },
    importPath: '../site-integrations/shonenjumpplus/runtime',
    exportName: 'shonenJumpPlusIntegration',
  },

  // Keep literal types for site integration IDs
];

// Type for site integration IDs (derived from manifest)
export type SiteIntegrationId = typeof SITE_INTEGRATION_MANIFESTS[number]['id'];

/**
 * Get manifest by site integration ID
 */
export function getSiteIntegrationManifestById(id: string): SiteIntegrationManifest | undefined {
  return SITE_INTEGRATION_MANIFESTS.find(m => m.id === id);
}

/**
 * Get user-friendly display name for a site integration ID.
 * Returns the manifest name if found, otherwise returns the ID as-is.
 * Used in UI components to show readable names instead of raw IDs.
 */
export function getSiteIntegrationDisplayName(siteId: string): string {
  const manifest = getSiteIntegrationManifestById(siteId);
  return manifest?.name ?? siteId;
}

/**
 * Get all supported domains across all site integrations
 */
export function getAllSupportedDomains(): string[] {
  const domains = new Set<string>();
  for (const manifest of SITE_INTEGRATION_MANIFESTS) {
    if (manifest.enabled === false) {
      continue;
    }

    for (const domain of manifest.patterns.domains) {
      domains.add(domain);
    }
  }
  return [...domains];
}

/**
 * Get pattern data for a specific site integration (backward compatible with site-patterns.ts)
 */
export function getPatternBySiteIntegrationId(siteIntegrationId: string): SiteIntegrationUrlPatterns {
  const manifest = getSiteIntegrationManifestById(siteIntegrationId);
  if (!manifest) {
    throw new Error(`Unknown site integration ID: ${siteIntegrationId}`);
  }
  return manifest.patterns;
}

/**
 * Get all patterns as a record (backward compatible with SITE_PATTERNS)
 */
export function getAllSiteIntegrationPatterns(): Record<string, SiteIntegrationUrlPatterns> {
  const patterns: Record<string, SiteIntegrationUrlPatterns> = {};
  for (const manifest of SITE_INTEGRATION_MANIFESTS) {
    if (manifest.enabled === false) {
      continue;
    }

    patterns[manifest.id] = manifest.patterns;
  }
  return patterns;
}

/**
 * Generate content script match patterns for WXT/Chrome manifest
 * Format: *://{domain}{path}
 */
export function generateContentScriptMatches(): string[] {
  const matches: string[] = [];
  for (const manifest of SITE_INTEGRATION_MANIFESTS) {
    if (manifest.enabled === false) {
      continue;
    }

    for (const domain of manifest.patterns.domains) {
      for (const path of manifest.patterns.seriesMatches) {
        const pattern = `*://${domain}${path}`;
        if (!matches.includes(pattern)) {
          matches.push(pattern);
        }
      }
    }
  }
  return matches;
}

/**
 * Generate content script exclude_matches patterns for WXT/Chrome manifest
 */
export function generateContentScriptExcludeMatches(): string[] {
  const excludes: string[] = [];
  for (const manifest of SITE_INTEGRATION_MANIFESTS) {
    if (manifest.enabled === false) {
      continue;
    }

    const excludeMatches = manifest.patterns.excludeMatches ?? [];
    for (const domain of manifest.patterns.domains) {
      for (const path of excludeMatches) {
        const pattern = `*://${domain}${path}`;
        if (!excludes.includes(pattern)) {
          excludes.push(pattern);
        }
      }
    }
  }
  return excludes;
}
