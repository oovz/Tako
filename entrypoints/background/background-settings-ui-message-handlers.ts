import type { RuntimeMessageHandlerMap } from "@/src/runtime/runtime-message-dispatcher"
import { persistentErrorsRepository } from "@/src/storage/persistent-errors-repository"
import type { BackgroundRuntimeHandlerDependencies } from "@/entrypoints/background/background-runtime-handler-dependencies"
import { reconcileFsaDestinationActionItem } from "./options-action-item-reconcile"
import { openOptionsTab } from "./open-options-tab"

type SettingsUiMessageType =
  | "GET_SITE_INTEGRATION_ENABLEMENT"
  | "GET_OPTIONS_CONFIGURATION"
  | "SAVE_OPTIONS_CONFIGURATION"
  | "GET_UI_PREFERENCES"
  | "REFRESH_FOLDER_ACTION_ITEM"
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
    REFRESH_FOLDER_ACTION_ITEM: async () => {
      await reconcileFsaDestinationActionItem({
        settingsRepository: deps.settingsRepository,
      })
      return { success: true }
    },
    GET_PERSISTENT_ERRORS: async () => ({
      success: true,
      data: await persistentErrorsRepository.getAll(),
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
      await persistentErrorsRepository.clear(message.payload.code)
      return { success: true }
    },
    OPEN_OPTIONS: async (message) => {
      await openOptionsTab(message.payload)
      return { success: true }
    },
  }
}
