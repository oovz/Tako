import type { RuntimeMessageHandlerMap } from "@/src/runtime/runtime-message-dispatcher"
import { clearPersistentError, getPersistentErrors } from "@/src/runtime/errors"
import type { BackgroundRuntimeHandlerDependencies } from "@/entrypoints/background/background-runtime-handler-dependencies"

type SettingsUiMessageType =
  | "GET_SITE_INTEGRATION_ENABLEMENT"
  | "GET_OPTIONS_CONFIGURATION"
  | "SAVE_OPTIONS_CONFIGURATION"
  | "GET_UI_PREFERENCES"
  | "GET_PERSISTENT_ERRORS"
  | "CLEAR_PERSISTED_DOWNLOAD_HISTORY"
  | "ACKNOWLEDGE_ERROR"
  | "OPEN_OPTIONS"

export function createBackgroundSettingsUiMessageHandlers(
  deps: BackgroundRuntimeHandlerDependencies
): Pick<RuntimeMessageHandlerMap<"background">, SettingsUiMessageType> {
  return {
    GET_OPTIONS_CONFIGURATION: async () => ({
      success: true,
      data: await deps.optionsConfigurationService.getOptionsConfiguration(),
    }),
    SAVE_OPTIONS_CONFIGURATION: async (message) => ({
      success: true,
      data: await deps.optionsConfigurationService.saveConfiguration(
        message.payload.configuration
      ),
    }),
    GET_UI_PREFERENCES: async () => {
      const settings = await deps.settingsRepository.getSettings()
      return {
        success: true,
        data: {
          motionPreference: settings.motionPreference,
          uiLanguage: settings.uiLanguage,
        },
      }
    },
    GET_PERSISTENT_ERRORS: async () => ({
      success: true,
      data: await getPersistentErrors(),
    }),
    GET_SITE_INTEGRATION_ENABLEMENT: async () => ({
      success: true,
      enablement: await deps.siteIntegrationEnablementService.getAll(),
    }),
    CLEAR_PERSISTED_DOWNLOAD_HISTORY: async (message) => {
      if (message.payload.scope === "all") {
        await deps.historyRepository.clearAllDownloadHistory()
      } else {
        await deps.historyRepository.clearSeriesDownloadHistory(
          message.payload.siteIntegrationId,
          message.payload.seriesId
        )
      }
      return { success: true }
    },
    ACKNOWLEDGE_ERROR: async (message) => {
      await clearPersistentError(message.payload.code)
      return { success: true }
    },
    OPEN_OPTIONS: async (message) => {
      const page = message.payload.page
      const tabParam = page ? `?tab=${encodeURIComponent(page)}` : ""
      const url = chrome.runtime.getURL(`options.html${tabParam}`)
      const tabs = await chrome.tabs.query({
        url: chrome.runtime.getURL("options.html*"),
      })
      const existing = tabs[0]
      if (typeof existing?.id === "number") {
        await chrome.tabs.update(existing.id, { active: true, url })
        if (typeof existing.windowId === "number") {
          await chrome.windows.update(existing.windowId, { focused: true })
        }
      } else {
        await chrome.tabs.create({ url, active: true })
      }
      return { success: true }
    },
  }
}
