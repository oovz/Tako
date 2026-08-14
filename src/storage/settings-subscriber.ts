import { applyUiLanguagePreference } from "@/src/runtime/i18n"
import logger, { applyAdvancedLoggerSettings } from "@/src/runtime/logger"
import {
  SETTINGS_STORAGE_KEY,
  type SettingsRepository,
} from "./settings-repository"
import type { ExtensionSettings } from "@/src/domain/settings/types"

export class SettingsSubscriber {
  private registered = false
  constructor(private readonly repository: SettingsRepository) {}
  register(): void {
    if (this.registered) return
    const onChanged = chrome.storage?.onChanged
    if (!onChanged?.addListener)
      throw new Error(
        "Required extension capability is unavailable: chrome.storage.onChanged"
      )
    onChanged.addListener((changes, areaName) => {
      if (areaName !== "local" || !(SETTINGS_STORAGE_KEY in changes)) return
      try {
        this.repository.acceptExternalDocument(
          changes[SETTINGS_STORAGE_KEY]?.newValue
        )
      } catch (error) {
        this.repository.invalidateCache()
        logger.error("Stored settings change is invalid", error)
        return
      }
      const settings = this.repository.getCachedSettings()
      if (!settings) return
      void applySettingsSideEffects(settings).catch((error) =>
        logger.warn("Failed to apply external settings side effects", error)
      )
    })
    this.registered = true
  }
}

/** Apply projections that must follow a durable settings write. */
export async function applySettingsSideEffects(
  settings: ExtensionSettings
): Promise<void> {
  applyAdvancedLoggerSettings(settings.advanced)
  await applyUiLanguagePreference(settings.uiLanguage)
}
