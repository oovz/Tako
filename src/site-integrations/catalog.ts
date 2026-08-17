import {
  siteIntegrationCatalog,
  siteIntegrationCatalogById,
} from "@/src/runtime/generated/site-integration-catalog"
import type {
  SiteIntegrationDefinition,
  SiteIntegrationPatterns,
  SiteIntegrationSettingsField,
} from "@/src/site-integrations/definition-types"
import type { SiteIntegrationEnablementMap } from "@/src/domain/site-integrations/storage-schemas"

/**
 * The generated provider catalog is the only metadata authority at runtime.
 * This module contains only pure lookups and the disposable enablement
 * projection shared by background-side callers.
 */
export { siteIntegrationCatalog, siteIntegrationCatalogById }
export type { SiteIntegrationDefinition, SiteIntegrationPatterns }

export type SiteIntegrationId = (typeof siteIntegrationCatalog)[number]["id"]

let enablement: SiteIntegrationEnablementMap = {}

export function getDefinition(
  id: string
): SiteIntegrationDefinition | undefined {
  return siteIntegrationCatalogById[id]
}

export function getDefinitions(): readonly SiteIntegrationDefinition[] {
  return siteIntegrationCatalog
}

export function getDisplayName(siteIntegrationId: string): string {
  return getDefinition(siteIntegrationId)?.name ?? siteIntegrationId
}

export function getPatterns(
  siteIntegrationId: string
): SiteIntegrationPatterns {
  const definition = getDefinition(siteIntegrationId)
  if (!definition) {
    throw new Error(`Unknown site integration ID: ${siteIntegrationId}`)
  }
  return definition.patterns
}

export function getAllSupportedDomains(): string[] {
  return [
    ...new Set(
      siteIntegrationCatalog
        .filter((definition) => definition.shipped)
        .flatMap((definition) => definition.patterns.domains)
    ),
  ]
}
/**
 * Sets the module-scoped in-memory site integration enablement map.
 *
 * Production call sites are restricted by architecture boundaries to the
 * background kernel initialization phase, the storage change listener and
 * initialization loader (`src/runtime/site-integration-initialization.ts`),
 * and the compile-time-gated E2E state seed.
 *
 * Callers that query {@link isEnabled} before this map is hydrated will
 * safely fall back to each definition's `enabledByDefault` configuration.
 */
export function setEnablementMap(next: SiteIntegrationEnablementMap): void {
  enablement = { ...next }
}

export function getEnablementMap(): SiteIntegrationEnablementMap {
  return { ...enablement }
}

/**
 * Determines whether a site integration is enabled.
 *
 * Evaluation order:
 * 1. Returns `false` if the integration definition is unknown or not `shipped`.
 * 2. Returns the explicit boolean override from the provided or module-scoped
 *    `enablement` map if present.
 * 3. Falls back to `definition.enabledByDefault` when the map has not yet been
 *    hydrated or contains no explicit user override for this integration.
 */
export function isEnabled(
  siteIntegrationId: string,
  overrides: SiteIntegrationEnablementMap = enablement
): boolean {
  const definition = getDefinition(siteIntegrationId)
  if (!definition || !definition.shipped) return false
  const override = overrides[siteIntegrationId]
  return typeof override === "boolean" ? override : definition.enabledByDefault
}

export function requiresBroadHttpsPermission(
  siteIntegrationId: string
): boolean {
  const definition = getDefinition(siteIntegrationId)
  return Boolean(
    definition?.shipped && definition.optionalOrigins.includes("https://*/*")
  )
}

export function getCustomSettings(
  siteIntegrationId: string
): readonly SiteIntegrationSettingsField[] {
  return getDefinition(siteIntegrationId)?.customSettings ?? []
}

export function assertValidSettingsFieldValue(
  schema: SiteIntegrationSettingsField,
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
  schema: SiteIntegrationSettingsField
): void {
  if (!schema.id.trim() || !schema.labelKey.trim()) {
    throw new Error("Site integration setting fields require id and labelKey")
  }

  if (schema.type === "select" || schema.type === "multiselect") {
    if (!Array.isArray(schema.options) || schema.options.length === 0) {
      throw new Error(
        `Site integration setting "${schema.id}" requires non-empty options`
      )
    }
    const values = new Set<string>()
    for (const option of schema.options) {
      if (!option.labelKey.trim() || !option.value.trim()) {
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
  }

  assertValidSettingsFieldValue(schema, schema.defaultValue)
}
