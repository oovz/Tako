/**
 * Unified Site Integration Manifest - Declarative Integration Registry
 *
 * This file is the authoritative source for declared site integration
 * metadata including:
 * - Site integration identification (id, name, author)
 * - URL patterns (domains, seriesMatches, excludeMatches)
 * - Rate limit policies
 * - Behavioral flags (handlesOwnRetries)
 *
 * Initialization, URL matching, permissions, and static runtime registries
 * derive their configuration from this manifest. Provider request call sites
 * remain responsible for enforcing their declared network behavior.
 *
 * To add a new site integration:
 * 1. Add entry to SITE_INTEGRATION_MANIFESTS below
 * 2. Create implementation in src/site-integrations/
 * 3. Add the site runtime exports to the static per-context registries under src/runtime/
 */

import type { RateScopePolicy } from "../types/rate-policy"
import {
  MANHUAGUI_CREDENTIAL_POLICY,
  MANHUAGUI_IMAGE_HOST_NAMES,
  MANHUAGUI_IMAGE_REFERER,
  MANHUAGUI_PAGE_HOST_NAMES,
} from "./manhuagui/policy"

export interface SiteIntegrationUrlPatterns {
  domains: string[]
  seriesMatches: string[]
  excludeMatches?: string[]
}

export type SessionRuleResourceType = "xmlhttprequest" | "other"

export interface SessionRefererRuleDeclaration {
  /** Stable extension-owned DNR rule ID. Must be unique across integrations. */
  id: number
  priority?: number
  /**
   * Chrome's requestDomains condition includes subdomains. Runtime request URL
   * allowlists remain the exact authority for provider fetch destinations.
   */
  requestDomains: string[]
  resourceTypes: SessionRuleResourceType[]
  referer: string
}

export interface SiteIntegrationNetworkCapabilities {
  /**
   * Session-scoped request-header policies required by the provider. The
   * runtime manager limits them to extension-initiated requests and installs
   * them only while the integration is enabled.
   */
  sessionRefererRules?: SessionRefererRuleDeclaration[]
  /**
   * Descriptive credential modes for externally visible provider request
   * roles. Runtime request call sites are independently tested until request
   * roles are enforced by a shared provider request factory.
   */
  credentialPolicies?: Array<{
    purpose: string
    mode: "include" | "omit"
  }>
}

const MANGADEX_DOMAINS: string[] = Array.from(new Set<string>(["mangadex.org"]))

const PIXIV_COMIC_DOMAINS: string[] = ["comic.pixiv.net"]
const SHONEN_JUMP_PLUS_DOMAINS: string[] = ["shonenjumpplus.com"]
const MANHUAGUI_DOMAINS: string[] = [...MANHUAGUI_PAGE_HOST_NAMES]
const COMICNETTAI_DOMAINS: string[] = ["www.comicnettai.com"]

export type SettingsFieldType =
  "boolean" | "string" | "number" | "select" | "multiselect"

export type SiteIntegrationMaturity = "experimental" | "stable"
export type SiteIntegrationImplementationType =
  "official-api" | "unofficial-api" | "dom-scraping" | "hybrid"

interface SettingsFieldBase {
  id: string
  label: string
  description?: string
}

export interface SettingsFieldOption {
  label: string
  value: string
}

export type SettingsFieldSchema =
  | (SettingsFieldBase & {
      type: "boolean"
      defaultValue: boolean
      options?: never
    })
  | (SettingsFieldBase & {
      type: "string"
      defaultValue: string
      options?: never
    })
  | (SettingsFieldBase & {
      type: "number"
      defaultValue: number
      options?: never
    })
  | (SettingsFieldBase & {
      type: "select"
      defaultValue: string
      options: [SettingsFieldOption, ...SettingsFieldOption[]]
    })
  | (SettingsFieldBase & {
      type: "multiselect"
      defaultValue: string[]
      options: [SettingsFieldOption, ...SettingsFieldOption[]]
    })

/**
 * Complete site integration manifest - all metadata in one place
 */
export interface SiteIntegrationManifest {
  // Identity
  id: string
  name: string
  author: string
  version: string
  maturity: SiteIntegrationMaturity
  shipped: boolean
  enabledByDefault: boolean
  implementationType: SiteIntegrationImplementationType

  // URL Patterns
  patterns: SiteIntegrationUrlPatterns

  // Rate limiting policies (site integration defaults, can be overridden by user settings)
  policyDefaults: {
    image: RateScopePolicy
    chapter: RateScopePolicy
  }

  // Behavioral flags
  /**
   * When true, the extension's default retry wrapper is skipped.
   * The site integration implements internal retry logic (e.g., MangaDex parses X-RateLimit-Retry-After).
   */
  handlesOwnRetries?: boolean

  /** Whether the resolver must read live page state through a one-shot probe. */
  requiresPageProbe: boolean

  /** Exact HTTPS origins used by provider APIs and fixed asset hosts. */
  requiredOrigins: string[]

  /** Whether this integration needs the optional HTTPS-wide asset permission. */
  requiresBroadHttpsPermission?: boolean

  /** Provider-specific browser networking capabilities. */
  network?: SiteIntegrationNetworkCapabilities

  /**
   * Optional integration-specific custom settings shown in Options.
   * Values are persisted in chrome.storage.local under siteIntegrationSettings[siteId][fieldId].
   */
  customSettings?: SettingsFieldSchema[]

  /**
   * Runtime surfaces implemented by this integration.
   *
   * Generated static registries use these flags to import only the site
   * runtime files required by each browser extension context.
   */
  runtimes: {
    background: boolean
    offscreen: boolean
    dispatchContext: "none" | "optional" | "required"
  }
}

/**
 * All declarative site integration manifests.
 *
 * Runtime request implementations remain provider-owned and must agree with
 * the capabilities declared here.
 */
export const SITE_INTEGRATION_MANIFESTS: readonly SiteIntegrationManifest[] = [
  {
    id: "mangadex",
    name: "MangaDex API",
    author: "TMD Team",
    version: "1.1.0",
    maturity: "stable",
    shipped: true,
    enabledByDefault: false,
    implementationType: "official-api",
    requiresPageProbe: true,
    requiredOrigins: [
      "https://mangadex.org/*",
      "https://*.mangadex.org/*",
      "https://api.mangadex.network/*",
    ],
    requiresBroadHttpsPermission: true,
    patterns: {
      domains: MANGADEX_DOMAINS,
      seriesMatches: ["/title/*"],
      excludeMatches: ["/chapter/*"],
    },
    policyDefaults: {
      image: { concurrency: 2, delayMs: 500 },
      chapter: { concurrency: 1, delayMs: 500 },
    },
    handlesOwnRetries: true,
    customSettings: [
      {
        id: "imageQuality",
        label: "Image quality",
        description: "Choose MangaDex image quality preference.",
        type: "select",
        defaultValue: "data-saver",
        options: [
          { label: "Data saver", value: "data-saver" },
          { label: "Full quality", value: "data" },
        ],
      },
      {
        id: "chapterLanguageFilter",
        label: "Chapter language filter",
        description: "Preferred chapter languages (BCP-47 codes).",
        type: "multiselect",
        defaultValue: [],
        options: [
          { label: "English (en)", value: "en" },
          { label: "Japanese (ja)", value: "ja" },
          { label: "Korean (ko)", value: "ko" },
          { label: "Chinese (zh)", value: "zh" },
        ],
      },
      {
        id: "autoReadMangaDexSettings",
        label: "Auto-read MangaDex website settings",
        description: "Use MangaDex website local settings when available.",
        type: "boolean",
        defaultValue: true,
      },
    ],
    runtimes: {
      background: true,
      offscreen: true,
      dispatchContext: "optional",
    },
  },
  {
    id: "pixiv-comic",
    name: "Pixiv Comic",
    author: "TMD Team",
    version: "1.1.0",
    maturity: "stable",
    shipped: true,
    enabledByDefault: true,
    implementationType: "unofficial-api",
    requiresPageProbe: false,
    requiredOrigins: [
      "https://comic.pixiv.net/*",
      "https://pximg.net/*",
      "https://*.pximg.net/*",
    ],
    patterns: {
      domains: PIXIV_COMIC_DOMAINS,
      seriesMatches: ["/works/*"],
    },
    policyDefaults: {
      image: { concurrency: 2, delayMs: 1000 },
      chapter: { concurrency: 1, delayMs: 2000 },
    },
    network: {
      sessionRefererRules: [
        {
          id: 41001,
          priority: 1,
          requestDomains: ["img-comic.pximg.net"],
          resourceTypes: ["xmlhttprequest", "other"],
          referer: "https://comic.pixiv.net/",
        },
      ],
    },
    runtimes: {
      background: true,
      offscreen: true,
      dispatchContext: "optional",
    },
  },
  {
    id: "shonenjumpplus",
    name: "Shonen Jump+",
    author: "TMD Team",
    version: "1.1.0",
    maturity: "stable",
    shipped: true,
    enabledByDefault: true,
    implementationType: "hybrid",
    requiresPageProbe: false,
    requiredOrigins: [
      "https://shonenjumpplus.com/*",
      "https://cdn-ak-img.shonenjumpplus.com/*",
      "https://cdn-ak.shonenjumpplus.com/*",
    ],
    patterns: {
      domains: SHONEN_JUMP_PLUS_DOMAINS,
      // Only episode pages expose the SSR episode payload and pagination data
      // used by the fetched-HTML resolver. Homepage and /series* catalog routes
      // are intentionally unsupported.
      seriesMatches: ["/episode/*"],
    },
    policyDefaults: {
      image: { concurrency: 2, delayMs: 1000 },
      chapter: { concurrency: 1, delayMs: 2000 },
    },
    runtimes: {
      background: true,
      offscreen: true,
      dispatchContext: "none",
    },
  },
  {
    id: "manhuagui",
    name: "Manhuagui",
    author: "TMD Team",
    version: "1.1.0",
    maturity: "stable",
    shipped: true,
    enabledByDefault: true,
    implementationType: "dom-scraping",
    requiresPageProbe: true,
    requiredOrigins: [
      "https://www.manhuagui.com/*",
      "https://manhuagui.com/*",
      "https://cf.mhgui.com/*",
      "https://hamreus.com/*",
      "https://*.hamreus.com/*",
    ],
    patterns: {
      domains: MANHUAGUI_DOMAINS,
      seriesMatches: ["/comic/*"],
      excludeMatches: ["/comic/*/*.html"],
    },
    policyDefaults: {
      image: { concurrency: 2, delayMs: 1000 },
      chapter: { concurrency: 1, delayMs: 1000 },
    },
    network: {
      credentialPolicies: [
        {
          purpose: "provider page HTML",
          mode: MANHUAGUI_CREDENTIAL_POLICY.pageHtml,
        },
        {
          purpose: "reader configuration",
          mode: MANHUAGUI_CREDENTIAL_POLICY.configuration,
        },
        {
          purpose: "image CDN bytes",
          mode: MANHUAGUI_CREDENTIAL_POLICY.image,
        },
      ],
      sessionRefererRules: [
        {
          id: 41002,
          priority: 1,
          requestDomains: [...MANHUAGUI_IMAGE_HOST_NAMES],
          resourceTypes: ["xmlhttprequest", "other"],
          referer: MANHUAGUI_IMAGE_REFERER,
        },
      ],
    },
    runtimes: {
      background: true,
      offscreen: true,
      dispatchContext: "none",
    },
  },
  {
    id: "comicnettai",
    name: "Comic Nettai",
    author: "TMD Team",
    version: "1.1.0",
    maturity: "stable",
    shipped: true,
    enabledByDefault: true,
    implementationType: "hybrid",
    requiresPageProbe: false,
    requiredOrigins: [
      "https://www.comicnettai.com/*",
      "https://cdn.comicnettai.com/*",
    ],
    patterns: {
      domains: COMICNETTAI_DOMAINS,
      seriesMatches: ["/book/*"],
      excludeMatches: ["/publus/*"],
    },
    policyDefaults: {
      image: { concurrency: 2, delayMs: 1000 },
      chapter: { concurrency: 1, delayMs: 1000 },
    },
    runtimes: {
      background: true,
      offscreen: true,
      dispatchContext: "none",
    },
  },

  // Keep literal types for site integration IDs
]

export function assertValidSettingsFieldValue(
  schema: SettingsFieldSchema,
  value: unknown
): void {
  const invalid = () => {
    throw new Error(
      `Invalid value for site integration setting "${schema.id}" (${schema.type})`
    )
  }

  if (schema.type === "boolean") {
    if (typeof value !== "boolean") invalid()
    return
  }
  if (schema.type === "string") {
    if (typeof value !== "string") invalid()
    return
  }
  if (schema.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) invalid()
    return
  }

  const allowedValues = new Set(schema.options.map((option) => option.value))
  if (schema.type === "select") {
    if (typeof value !== "string" || !allowedValues.has(value)) invalid()
    return
  }

  if (
    !Array.isArray(value) ||
    value.some(
      (entry) => typeof entry !== "string" || !allowedValues.has(entry)
    ) ||
    new Set(value).size !== value.length
  ) {
    invalid()
  }
}

export function assertValidSettingsFieldSchema(
  schema: SettingsFieldSchema
): void {
  const runtimeSchema = schema as SettingsFieldBase & {
    type: SettingsFieldType
    options?: unknown
  }
  if (!schema.id.trim() || !schema.label.trim()) {
    throw new Error("Site integration setting fields require id and label")
  }

  if (schema.type === "select" || schema.type === "multiselect") {
    if (!Array.isArray(schema.options) || schema.options.length === 0) {
      throw new Error(
        `Site integration setting "${schema.id}" requires non-empty options`
      )
    }
    const values = new Set<string>()
    for (const option of schema.options) {
      if (!option.label.trim() || !option.value.trim()) {
        throw new Error(
          `Site integration setting "${schema.id}" has an invalid option`
        )
      }
      if (values.has(option.value)) {
        throw new Error(
          `Site integration setting "${schema.id}" has duplicate option value "${option.value}"`
        )
      }
      values.add(option.value)
    }
  } else if (runtimeSchema.options !== undefined) {
    throw new Error(
      `Site integration setting "${runtimeSchema.id}" cannot declare options for type "${runtimeSchema.type}"`
    )
  }

  assertValidSettingsFieldValue(schema, schema.defaultValue)
}

for (const manifest of SITE_INTEGRATION_MANIFESTS) {
  const fieldIds = new Set<string>()
  for (const field of manifest.customSettings ?? []) {
    assertValidSettingsFieldSchema(field)
    if (fieldIds.has(field.id)) {
      throw new Error(
        `Site integration "${manifest.id}" has duplicate setting id "${field.id}"`
      )
    }
    fieldIds.add(field.id)
  }
}

// Type for site integration IDs (derived from manifest)
export type SiteIntegrationId =
  (typeof SITE_INTEGRATION_MANIFESTS)[number]["id"]

/**
 * Get manifest by site integration ID
 */
export function getSiteIntegrationManifestById(
  id: string
): SiteIntegrationManifest | undefined {
  return SITE_INTEGRATION_MANIFESTS.find((m) => m.id === id)
}

/**
 * Get user-friendly display name for a site integration ID.
 * Returns the manifest name if found, otherwise returns the ID as-is.
 * Used in UI components to show readable names instead of raw IDs.
 */
export function getSiteIntegrationDisplayName(siteId: string): string {
  const manifest = getSiteIntegrationManifestById(siteId)
  return manifest?.name ?? siteId
}

/**
 * Get all supported domains across all site integrations
 */
export function getAllSupportedDomains(): string[] {
  const domains = new Set<string>()
  for (const manifest of SITE_INTEGRATION_MANIFESTS) {
    if (!manifest.shipped) {
      continue
    }

    for (const domain of manifest.patterns.domains) {
      domains.add(domain)
    }
  }
  return [...domains]
}

/**
 * Get pattern data for a specific site integration (backward compatible with site-patterns.ts)
 */
export function getPatternBySiteIntegrationId(
  siteIntegrationId: string
): SiteIntegrationUrlPatterns {
  const manifest = getSiteIntegrationManifestById(siteIntegrationId)
  if (!manifest) {
    throw new Error(`Unknown site integration ID: ${siteIntegrationId}`)
  }
  return manifest.patterns
}

/**
 * Get all patterns as a record (backward compatible with SITE_PATTERNS)
 */
export function getAllSiteIntegrationPatterns(): Record<
  string,
  SiteIntegrationUrlPatterns
> {
  const patterns: Record<string, SiteIntegrationUrlPatterns> = {}
  for (const manifest of SITE_INTEGRATION_MANIFESTS) {
    if (!manifest.shipped) {
      continue
    }

    patterns[manifest.id] = manifest.patterns
  }
  return patterns
}

/**
 * Host permissions required at installation for integrations that are enabled
 * by default. Integrations that need broad, optional access are deliberately
 * excluded and must request that access from a user gesture when enabled.
 */
export function generateRequiredHostPermissions(): string[] {
  const origins = new Set<string>()
  for (const manifest of SITE_INTEGRATION_MANIFESTS) {
    if (
      !manifest.shipped ||
      !manifest.enabledByDefault ||
      manifest.requiresBroadHttpsPermission
    ) {
      continue
    }

    for (const origin of manifest.requiredOrigins) {
      origins.add(origin)
    }
  }
  return [...origins]
}
