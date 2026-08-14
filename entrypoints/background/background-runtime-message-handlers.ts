import type { BackgroundRuntimeHandlerDependencies } from "@/entrypoints/background/background-runtime-handler-dependencies"
import { createBackgroundOffscreenEventMessageHandlers } from "@/entrypoints/background/background-offscreen-event-message-handlers"
import { createBackgroundQueueMessageHandlers } from "@/entrypoints/background/background-queue-message-handlers"
import { createBackgroundDownloadStateMessageHandlers } from "@/entrypoints/background/background-download-state-message-handlers"
import { createBackgroundSettingsUiMessageHandlers } from "@/entrypoints/background/background-settings-ui-message-handlers"
import { createBackgroundTabContextMessageHandlers } from "@/entrypoints/background/background-tab-context-message-handlers"
import type { RuntimeMessageHandlerMap } from "@/src/runtime/runtime-message-dispatcher"

export function createBackgroundRuntimeMessageHandlers(
  deps: BackgroundRuntimeHandlerDependencies
): RuntimeMessageHandlerMap<"background"> {
  return {
    ...createBackgroundQueueMessageHandlers(deps),
    ...createBackgroundDownloadStateMessageHandlers(deps),
    ...createBackgroundTabContextMessageHandlers(deps),
    ...createBackgroundSettingsUiMessageHandlers(deps),
    ...createBackgroundOffscreenEventMessageHandlers(deps),
  }
}
