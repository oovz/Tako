import { getDefinition } from "@/src/site-integrations/catalog"

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
