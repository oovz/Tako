import type { BackgroundRuntimeHandlerDependencies } from "@/entrypoints/background/background-runtime-handler-dependencies"
import { createBackgroundOffscreenEventMessageHandlers } from "@/entrypoints/background/background-offscreen-event-message-handlers"
import { createBackgroundQueueMessageHandlers } from "@/entrypoints/background/background-queue-message-handlers"
import { createBackgroundDownloadStateMessageHandlers } from "@/entrypoints/background/background-download-state-message-handlers"
import { createBackgroundSettingsUiMessageHandlers } from "@/entrypoints/background/background-settings-ui-message-handlers"
import { createBackgroundTabContextMessageHandlers } from "@/entrypoints/background/background-tab-context-message-handlers"
import type { RuntimeMessageHandlerMap } from "@/src/runtime/runtime-message-dispatcher"
import { getDeviceToken } from "@/src/site-integrations/mangamillion/api"
import { isEnabled } from "@/src/site-integrations/catalog"
import { SiteRequestDeniedError } from "@/src/site-integrations/site-request-denied-error"
import type { RateLimitService } from "@/src/runtime/rate-limit"

export function createBackgroundRuntimeMessageHandlers(
  deps: BackgroundRuntimeHandlerDependencies & {
    rateLimitService: RateLimitService
  }
): RuntimeMessageHandlerMap<"background"> {
  return {
    GET_MANGAMILLION_DEVICE_TOKEN: async ({ rejectedToken }) => {
      const enablement = await deps.siteIntegrationEnablementService.getAll()
      if (!isEnabled("mangamillion", enablement)) {
        return { success: false, error: "MangaMillion is disabled." }
      }
      try {
        const deviceToken = await getDeviceToken(
          deps.rateLimitService,
          undefined,
          rejectedToken
        )
        return { success: true, deviceToken }
      } catch (error) {
        if (error instanceof SiteRequestDeniedError) {
          return { success: false, error: error.message, status: 403 }
        }
        throw error
      }
    },
    ...deps.coverPreviewHandlers,
    ...createBackgroundQueueMessageHandlers(deps),
    ...createBackgroundDownloadStateMessageHandlers(deps),
    ...createBackgroundTabContextMessageHandlers(deps),
    ...createBackgroundSettingsUiMessageHandlers(deps),
    ...createBackgroundOffscreenEventMessageHandlers(deps),
  }
}
