import logger from "@/src/runtime/logger"
import { getBackgroundSiteAdapterById } from "@/src/runtime/background-site-integration-initialization"
import type { Chapter } from "@/src/types/chapter"
import type { TaskSettingsSnapshot } from "@/src/types/state-snapshots"
import { getSiteIntegrationManifestById } from "@/src/site-integrations/manifest"

export interface SiteIntegrationDispatchContextInput {
  siteIntegrationId: string
  taskId: string
  seriesKey: string
  chapter: Chapter
  settingsSnapshot: TaskSettingsSnapshot
}

/**
 * Resolve provider-specific context for one offscreen dispatch according to
 * the integration's declared none/optional/required contract.
 */
export async function resolveSiteIntegrationDispatchContext(
  input: SiteIntegrationDispatchContextInput
): Promise<Record<string, unknown> | undefined> {
  const capability =
    getSiteIntegrationManifestById(input.siteIntegrationId)?.runtimes
      .dispatchContext ?? "none"
  if (capability === "none") return undefined

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

    return await prepareDispatchContext({
      taskId: input.taskId,
      seriesKey: input.seriesKey,
      chapter: input.chapter,
      settingsSnapshot: input.settingsSnapshot,
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
}
