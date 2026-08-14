import { getDefinition } from "@/src/site-integrations/catalog"
import { offscreenSiteAdaptersById } from "@/src/runtime/generated/site-integration-offscreen-registry"
import type { JsonObject } from "@/src/types/site-integrations"

export interface SiteIntegrationDispatchContextEnvelope {
  schemaVersion: number
  data: JsonObject
}

/**
 * Validate provider context before an offscreen job is admitted. Context
 * versions are current-only and must exactly match the generated definition.
 */
export function readSiteIntegrationDispatchContext(
  siteIntegrationId: string,
  envelope: SiteIntegrationDispatchContextEnvelope | undefined
): JsonObject | undefined {
  const definition = getDefinition(siteIntegrationId)
  if (!definition) {
    throw new Error(`Unknown site integration ID: ${siteIntegrationId}`)
  }

  const contract = definition.runtimes.dispatchContext
  if (contract.mode === "none") {
    if (envelope) {
      throw new Error(
        `Dispatch context is not supported for ${siteIntegrationId}`
      )
    }
    return undefined
  }

  if (!envelope) {
    if (contract.mode === "required") {
      throw new Error(
        `Required dispatch context is missing for ${siteIntegrationId}`
      )
    }
    return undefined
  }

  if (envelope.schemaVersion !== contract.schemaVersion) {
    throw new Error(
      `Unsupported dispatch context schema version ${envelope.schemaVersion} for ${siteIntegrationId}; expected ${contract.schemaVersion}`
    )
  }

  const adapter = offscreenSiteAdaptersById[siteIntegrationId]?.offscreen
  const dispatchContextCodec = adapter?.dispatchContext
  if (!dispatchContextCodec) {
    throw new Error(
      `Dispatch context parser is unavailable for ${siteIntegrationId}`
    )
  }
  return dispatchContextCodec.parse(envelope.data)
}
