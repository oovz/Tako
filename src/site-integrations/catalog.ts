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
/** Replace cached enablement overrides; unset entries keep their definition defaults. */
export function setEnablementMap(next: SiteIntegrationEnablementMap): void {
  enablement = { ...next }
}

export function getEnablementMap(): SiteIntegrationEnablementMap {
  return { ...enablement }
}

/** Apply explicit overrides to shipped integrations, then fall back to defaults. */
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

function isValidOptionSelection(
  schema: Extract<
    SiteIntegrationSettingsField,
    { type: "select" | "multiselect" }
  >,
  value: unknown
): boolean {
  const allowedValues = new Set(schema.options.map((option) => option.value))
  if (schema.type === "select") {
    return typeof value === "string" && allowedValues.has(value)
  }
  return (
    Array.isArray(value) &&
    value.every(
      (entry) => typeof entry === "string" && allowedValues.has(entry)
    ) &&
    new Set(value).size === value.length
  )
}

function isValidSettingsFieldValue(
  schema: SiteIntegrationSettingsField,
  value: unknown
): boolean {
  switch (schema.type) {
    case "boolean":
      return typeof value === "boolean"
    case "string":
      return typeof value === "string"
    case "number":
      return typeof value === "number" && Number.isFinite(value)
    case "select":
    case "multiselect":
      return isValidOptionSelection(schema, value)
  }
}

export function assertValidSettingsFieldValue(
  schema: SiteIntegrationSettingsField,
  value: unknown
): void {
  if (!isValidSettingsFieldValue(schema, value)) {
    throw new Error(
      `Invalid value for site integration setting "${schema.id}" (${schema.type})`
    )
  }
}

function assertValidSettingsOptions(
  schema: Extract<
    SiteIntegrationSettingsField,
    { type: "select" | "multiselect" }
  >
): void {
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

export function assertValidSettingsFieldSchema(
  schema: SiteIntegrationSettingsField
): void {
  if (!schema.id.trim() || !schema.labelKey.trim()) {
    throw new Error("Site integration setting fields require id and labelKey")
  }

  if (schema.type === "select" || schema.type === "multiselect") {
    assertValidSettingsOptions(schema)
  }

  assertValidSettingsFieldValue(schema, schema.defaultValue)
}
