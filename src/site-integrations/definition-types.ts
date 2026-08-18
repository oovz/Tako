import type { RateScopePolicy } from "@/src/types/rate-policy"

/** Current version of the site integration definition schema specification. */
export const SITE_INTEGRATION_DEFINITION_SCHEMA_VERSION = 1 as const

/**
 * Determines whether the integration requires an in-page DOM probe
 * (content script execution) to extract reader configuration or state.
 */
export type SiteIntegrationPageProbe = "none" | "optional" | "required"

/**
 * Determines whether retry classification and backoff are managed by the
 * platform or owned by the provider adapter. Providers needing custom control
 * set `retryOwner: "provider"` and implement it in-adapter.
 */
export type SiteIntegrationRetryOwner = "platform" | "provider"

/** HTTP redirect handling mode for hardened network requests. */
export type SiteIntegrationRedirectMode = "error" | "follow" | "manual"

/** Expected response payload format for hardened network requests. */
export type SiteIntegrationResponseType = "json" | "text" | "bytes" | "html"

/** Credential transmission policy (cookies / auth headers) for hardened network requests. */
export type SiteIntegrationCredentialMode = "omit" | "include"

/** Distinguishes fixed known origins from dynamically issued CDN/media origins. */
export type SiteIntegrationOriginKind = "fixed" | "provider-issued"
/** URL matching rules for recognizing manga series and chapter pages. */
export interface SiteIntegrationPatterns {
  /** Hostnames supported by this integration (e.g. ["mangadex.org"]). */
  domains: string[]
  /** URL pathname patterns for series pages (e.g. ["/title/*"]). */
  seriesMatches: string[]
  /** URL pathname patterns explicitly excluded from series matching. */
  excludeMatches?: string[]
}

/** Hardened network policy declaration for a specific API or resource endpoint. */
export interface SiteIntegrationEndpointPolicy {
  /** Unique kebab-case endpoint identifier. */
  id: string
  /** Human-readable explanation of why this endpoint is accessed. */
  purpose: string
  /** Allowed URL origin patterns for this endpoint. */
  origins: string[]
  /** Whether origins are static/fixed or dynamically issued by the provider. */
  originKind: SiteIntegrationOriginKind
  /** Credential policy for requests to this endpoint. */
  credentials: SiteIntegrationCredentialMode
  /** Redirect policy for requests to this endpoint. */
  redirect: SiteIntegrationRedirectMode
  /** Expected response content type. */
  responseType: SiteIntegrationResponseType
  /** Maximum response payload size allowed in bytes. */
  maxResponseBytes: number
}

/** Dynamic origin binding linking an API endpoint to runtime-issued media origins. */
export interface SiteIntegrationDynamicOrigin {
  /** Target media endpoint id receiving dynamic origins. */
  endpointId: string
  /** Source API endpoint id returning media host URLs. */
  sourceEndpointId: string
  /** Origin pattern template permitted for dynamic registration. */
  allowedOriginPattern: string
  /** Validation rule applied to issued dynamic URLs (e.g. "public-https"). */
  validator: "public-https"
}

/** Declarative Net Request rule declaration for setting required Referer headers. */
export interface SiteIntegrationSessionRefererRule {
  /** Managed rule id within the 41000-41999 range. */
  id: number
  /** Optional rule evaluation priority. */
  priority?: number
  /** Target request domain names where Referer headers will be injected. */
  requestDomains: string[]
  /** Web request resource types affected by this rule. */
  resourceTypes: ("xmlhttprequest" | "other")[]
  /** Absolute HTTPS Referer header value to attach. */
  referer: string
}

export interface SiteIntegrationSettingsFieldOption {
  labelKey: string
  value: string
}

interface SiteIntegrationSettingsFieldBase {
  id: string
  /** i18n message key; resolved through the extension's locale catalogs. */
  labelKey: string
  descriptionKey?: string
}

export type SiteIntegrationSettingsField =
  | (SiteIntegrationSettingsFieldBase & {
      type: "boolean"
      defaultValue: boolean
      options?: never
    })
  | (SiteIntegrationSettingsFieldBase & {
      type: "string"
      defaultValue: string
      options?: never
    })
  | (SiteIntegrationSettingsFieldBase & {
      type: "number"
      defaultValue: number
      options?: never
    })
  | (SiteIntegrationSettingsFieldBase & {
      type: "select"
      defaultValue: string
      options: [
        SiteIntegrationSettingsFieldOption,
        ...SiteIntegrationSettingsFieldOption[],
      ]
    })
  | (SiteIntegrationSettingsFieldBase & {
      type: "multiselect"
      defaultValue: string[]
      options: [
        SiteIntegrationSettingsFieldOption,
        ...SiteIntegrationSettingsFieldOption[],
      ]
    })

/** Surface declaration of extension runtime contexts implemented by the provider. */
export interface SiteIntegrationRuntimeSurface {
  /** Whether the background adapter is implemented. */
  background: boolean
  /** Whether the offscreen adapter is implemented. */
  offscreen: boolean
  /** Configuration for passing parsed context from active page to offscreen worker. */
  dispatchContext: {
    /** Dispatch context requirement mode. */
    mode: "none" | "optional" | "required"
    /** Schema version for the dispatch context payload. */
    schemaVersion?: number
  }
}

/** Image transformation specification, such as canvas descrambling. */
export interface SiteIntegrationImageTransform {
  /** Type of image transformation algorithm. */
  kind: "none" | "integrated-descramble"
  /** Estimated CPU time in milliseconds per image transform. */
  estimatedCostMs: number
}

/** Deterministic test fixture declarations and freshness verification policy. */
export interface SiteIntegrationFixtures {
  /** Repository-relative file paths to fixture JSON files. */
  paths: string[]
  /** Maximum days before live smoke re-verification is advised. */
  liveFreshnessDays: number
}

/**
 * Static manifest and policy declaration for a site integration provider.
 * Validated at build time against `definition.schema.json`.
 */
export interface SiteIntegrationDefinition {
  /** Fixed schema version number (currently 1). */
  schemaVersion: typeof SITE_INTEGRATION_DEFINITION_SCHEMA_VERSION
  /** Unique kebab-case provider identifier (e.g. "mangadex"). */
  id: string
  /** Human-readable display name for the manga site (e.g. "MangaDex"). */
  name: string
  /** List of contributor names or handles who authored or maintain this site integration. */
  contributors: string[]
  /** Semantic version string for the provider implementation (e.g. "1.0.0"). */
  version: string
  /** Whether this integration is bundled and active in runtime builds. */
  shipped: boolean
  /** Default enablement state before explicit user override in Options. */
  enabledByDefault: boolean
  /** URL match patterns for identifying series and chapter pages. */
  patterns: SiteIntegrationPatterns
  /** Required origin permission patterns for core functionality. */
  requiredOrigins: string[]
  /** Optional origin permission patterns requested on demand. */
  optionalOrigins: string[]
  /** Default rate-limiting and concurrency policies for images and chapters. */
  policyDefaults: {
    image: RateScopePolicy
    chapter: RateScopePolicy
  }
  /** Whether retry handling is delegated to the platform or owned by the provider. */
  retryOwner: SiteIntegrationRetryOwner
  /** Whether in-page DOM probing is required, optional, or not used. */
  pageProbe: SiteIntegrationPageProbe
  /** Surface flags declaring which runtime contexts are implemented. */
  runtimes: SiteIntegrationRuntimeSurface
  /** Image transformation specifications, such as descrambling canvas operations. */
  imageTransform: SiteIntegrationImageTransform
  /** Hardened network endpoint policies declaring allowed origins, credentials, and limits. */
  endpointPolicies: SiteIntegrationEndpointPolicy[]
  /** Dynamic origin bindings connecting API endpoints with issued media hosts. */
  dynamicOrigins: SiteIntegrationDynamicOrigin[]
  /** Declarative Net Request (DNR) session rules for attaching required HTTP headers. */
  sessionRefererRules: SiteIntegrationSessionRefererRule[]
  /** Custom settings definitions exposed in the Options UI for this integration. */
  customSettings: SiteIntegrationSettingsField[]
  /** Deterministic test fixture paths and live freshness validation policy. */
  fixtures: SiteIntegrationFixtures
}

/** Unique identifier type for site integration providers. */
export type SiteIntegrationId = SiteIntegrationDefinition["id"]
