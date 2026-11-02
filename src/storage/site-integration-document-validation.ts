import { getDefinition } from "@/src/site-integrations/catalog"
import type { z } from "zod"

/** Missing current integration documents start as a validated empty map. */
export async function readSiteIntegrationDocument<T>(
  storageKey: string,
  parse: (value: unknown) => T
): Promise<T> {
  const stored = await chrome.storage.local.get(storageKey)
  return parse(storageKey in stored ? stored[storageKey] : {})
}

export function parseKnownSiteIntegrationDocument<
  T extends Record<string, unknown>,
>(schema: z.ZodType<T>, value: unknown, documentName: string): T {
  const parsed = schema.parse(value)
  assertKnownSiteIntegrationIds(parsed, documentName)
  return parsed
}

/**
 * Validate provider-keyed storage documents against the generated catalog.
 * The catalog remains the only provider capability authority; this helper
 * merely applies that authority at the durable document boundary.
 */
export function assertKnownSiteIntegrationIds(
  document: Record<string, unknown>,
  documentName: string
): void {
  for (const siteIntegrationId of Object.keys(document)) {
    if (!getDefinition(siteIntegrationId)) {
      throw new Error(
        `Unknown site integration ID in ${documentName}: ${siteIntegrationId}`
      )
    }
  }
}
