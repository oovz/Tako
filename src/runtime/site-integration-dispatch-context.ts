import logger from "@/src/runtime/logger"
import { getBackgroundSiteAdapterById } from "@/src/runtime/background-site-integration-initialization"
import type { Chapter } from "@/src/types/chapter"
import type { TaskSettingsSnapshot } from "@/src/types/state-snapshots"
import type { SiteIntegrationSettingsReader } from "@/src/types/site-integrations"
import { getDefinition } from "@/src/site-integrations/catalog"
import type { SiteIntegrationDispatchContextEnvelope } from "@/src/runtime/site-integration-dispatch-context-envelope"

export interface SiteIntegrationDispatchContextInput {
  siteIntegrationId: string
  taskId: string
  seriesKey: string
  chapter: Chapter
  settingsSnapshot: TaskSettingsSnapshot
  siteIntegrationSettingsReader: SiteIntegrationSettingsReader
}

/**
 * Resolve provider-specific context for one offscreen dispatch according to
 * the integration's declared none/optional/required contract.
 */
export async function resolveSiteIntegrationDispatchContext(
  input: SiteIntegrationDispatchContextInput
): Promise<SiteIntegrationDispatchContextEnvelope | undefined> {
  const definition = getDefinition(input.siteIntegrationId)
  const dispatchContext = definition?.runtimes.dispatchContext
  const capability = dispatchContext?.mode ?? "none"
  if (capability === "none") return undefined
  const schemaVersion = dispatchContext?.schemaVersion
  if (!schemaVersion) {
    throw new Error(
      `Dispatch context schema version is missing for ${input.siteIntegrationId}`
    )
  }

  let data: SiteIntegrationDispatchContextEnvelope["data"] | undefined
  try {
    const integration = await getBackgroundSiteAdapterById(
      input.siteIntegrationId
    )
    const prepareDispatchContext =
      integration?.background.prepareDispatchContext
    if (!prepareDispatchContext) {
      if (capability === "required") {
        throw new Error(
          `Required dispatch context resolver is unavailable for ${input.siteIntegrationId}`
        )
      }
      return undefined
    }

    data = await prepareDispatchContext({
      taskId: input.taskId,
      seriesKey: input.seriesKey,
      chapter: input.chapter,
      settingsSnapshot: input.settingsSnapshot,
      siteIntegrationSettingsReader: input.siteIntegrationSettingsReader,
    })
  } catch (error) {
    if (capability === "required") {
      throw error
    }
    logger.debug("[Queue]", {
      event: "PREPARE_DISPATCH_CONTEXT_FAILED",
      taskId: input.taskId,
      chapterId: input.chapter.id,
      siteIntegrationId: input.siteIntegrationId,
      error,
    })
    return undefined
  }

  if (data === undefined) return undefined
  return { schemaVersion, data }
}
