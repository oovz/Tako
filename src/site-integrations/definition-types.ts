import type { RateScopePolicy } from "@/src/types/rate-policy"

export const SITE_INTEGRATION_DEFINITION_SCHEMA_VERSION = 1 as const

export type SiteIntegrationMaturity = "experimental" | "stable"
export type SiteIntegrationImplementationType =
  "official-api" | "unofficial-api" | "dom-scraping" | "hybrid"
export type SiteIntegrationPageProbe = "none" | "optional" | "required"
/**
 * Determines whether retry classification and backoff are managed by the
 * platform or owned by the provider adapter. Providers needing richer control
 * set `retryOwner: "provider"` and implement it in-adapter; schema extensions
 * require a `schemaVersion` bump.
 */
export type SiteIntegrationRetryOwner = "platform" | "provider"
export type SiteIntegrationRedirectMode = "error" | "follow" | "manual"
export type SiteIntegrationResponseType = "json" | "text" | "bytes" | "html"
export type SiteIntegrationCredentialMode = "omit" | "include"
export type SiteIntegrationOriginKind = "fixed" | "provider-issued"
export type SiteIntegrationVolatility = "low" | "medium" | "high"
export type SiteIntegrationAuthentication = "anonymous" | "browser-session"

export interface SiteIntegrationPatterns {
  domains: string[]
  seriesMatches: string[]
  excludeMatches?: string[]
}

export interface SiteIntegrationEndpointPolicy {
  id: string
  purpose: string
  origins: string[]
  originKind: SiteIntegrationOriginKind
  credentials: SiteIntegrationCredentialMode
  redirect: SiteIntegrationRedirectMode
  responseType: SiteIntegrationResponseType
  maxResponseBytes: number
}

export interface SiteIntegrationDynamicOrigin {
  endpointId: string
  sourceEndpointId: string
  allowedOriginPattern: string
  validator: "public-https"
}

export interface SiteIntegrationSessionRefererRule {
  id: number
  priority?: number
  requestDomains: string[]
  resourceTypes: ("xmlhttprequest" | "other")[]
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

export interface SiteIntegrationRuntimeSurface {
  background: boolean
  offscreen: boolean
  dispatchContext: {
    mode: "none" | "optional" | "required"
    schemaVersion?: number
  }
}

export interface SiteIntegrationImageTransform {
  kind: "none" | "integrated-descramble"
  estimatedCostMs: number
}

export interface SiteIntegrationFixtures {
  paths: string[]
  liveFreshnessDays: number
}

export interface SiteIntegrationDefinition {
  schemaVersion: typeof SITE_INTEGRATION_DEFINITION_SCHEMA_VERSION
  id: string
  name: string
  author: string
  version: string
  maturity: SiteIntegrationMaturity
  shipped: boolean
  enabledByDefault: boolean
  implementationType: SiteIntegrationImplementationType
  volatility: SiteIntegrationVolatility
  authentication: SiteIntegrationAuthentication
  regions: string[]
  accountConstraints: string[]
  patterns: SiteIntegrationPatterns
  requiredOrigins: string[]
  optionalOrigins: string[]
  policyDefaults: {
    image: RateScopePolicy
    chapter: RateScopePolicy
  }
  retryOwner: SiteIntegrationRetryOwner
  pageProbe: SiteIntegrationPageProbe
  runtimes: SiteIntegrationRuntimeSurface
  imageTransform: SiteIntegrationImageTransform
  endpointPolicies: SiteIntegrationEndpointPolicy[]
  dynamicOrigins: SiteIntegrationDynamicOrigin[]
  sessionRefererRules: SiteIntegrationSessionRefererRule[]
  customSettings: SiteIntegrationSettingsField[]
  fixtures: SiteIntegrationFixtures
}

export type SiteIntegrationId = SiteIntegrationDefinition["id"]
