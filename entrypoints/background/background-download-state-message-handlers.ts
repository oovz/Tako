import type { BackgroundRuntimeHandlerDependencies } from "@/entrypoints/background/background-runtime-handler-dependencies"
import type { RuntimeMessageHandlerMap } from "@/src/runtime/runtime-message-dispatcher"

type DownloadStateMessageType =
  "GET_OPTIONS_DOWNLOAD_STATE" | "GET_SIDEPANEL_DOWNLOAD_STATE"

export function createBackgroundDownloadStateMessageHandlers(
  deps: BackgroundRuntimeHandlerDependencies
): Pick<RuntimeMessageHandlerMap<"background">, DownloadStateMessageType> {
  return {
    GET_OPTIONS_DOWNLOAD_STATE: async () => ({
      success: true,
      data: await deps.downloadStateQueryService.getOptionsDownloadState(),
    }),
    GET_SIDEPANEL_DOWNLOAD_STATE: async () => ({
      success: true,
      data: await deps.downloadStateQueryService.getSidepanelDownloadState(),
    }),
  }
}
