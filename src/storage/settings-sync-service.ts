/**
 * Settings Synchronization Service
 *
 * Handles real-time synchronization between storage.local and storage.session
 * to ensure settings changes propagate immediately across all extension components.
 */

import logger from "@/src/runtime/logger"
import { t } from "@/src/runtime/i18n"
import {
  canonicalizeSettingsDocument,
  settingsService,
  SETTINGS_STORAGE_KEY,
} from "./settings-service"
import { loadDownloadRootHandle, verifyPermission } from "./fs-access"
import type { ExtensionSettings } from "./settings-types"
import { SyncSettingsToStateMessage } from "../types/runtime-command-messages"
import { isRecord } from "@/src/shared/type-guards"
import { createCommandEnvelope } from "@/src/runtime/command-envelope"

export interface SettingsSyncNotification {
  type: "SETTINGS_CHANGED"
  settings: ExtensionSettings
  changedKeys: string[]
}

/**
 * Settings synchronization service that ensures all storage layers stay in sync
 */
export class SettingsSyncService {
  private listeners: Set<(notification: SettingsSyncNotification) => void> =
    new Set()
  private isInitialized = false

  /**
   * Initialize the sync service with storage change listeners
   */
  initialize(): void {
    if (this.isInitialized) return

    try {
      const onStorageChanged = chrome.storage?.onChanged
      if (!onStorageChanged?.addListener) {
        this.isInitialized = true
        logger.debug(
          "Settings sync service skipped: chrome.storage.onChanged unavailable in this context"
        )
        return
      }

      // Listen for changes to the settings key in storage.local
      onStorageChanged.addListener((changes, areaName) => {
        if (areaName === "local" && changes[SETTINGS_STORAGE_KEY]) {
          const newSettings = canonicalizeSettingsDocument(
            changes[SETTINGS_STORAGE_KEY].newValue
          )
          const oldSettings = canonicalizeSettingsDocument(
            changes[SETTINGS_STORAGE_KEY].oldValue
          )

          if (newSettings) {
            this.notifySettingsChange(newSettings, oldSettings ?? undefined)
          }
        }
      })

      this.isInitialized = true
      logger.info("Settings sync service initialized")
    } catch (error) {
      logger.error("Failed to initialize settings sync service:", error)
    }
  }

  /**
   * Validate download mode configuration
   */
  async validateDestination(
    destination: string
  ): Promise<{ isValid: boolean; error?: string }> {
    if (destination === "downloads-api") {
      return { isValid: true }
    }

    if (destination === "file-system-access") {
      try {
        const handle = await loadDownloadRootHandle()
        if (!handle) {
          return {
            isValid: false,
            error: t("settings_customFolderRequired"),
          }
        }

        const hasPermission = await verifyPermission(handle, true)
        if (!hasPermission) {
          return {
            isValid: false,
            error: t("settings_customFolderPermissionDenied"),
          }
        }

        return { isValid: true }
      } catch (error) {
        return {
          isValid: false,
          error: t("settings_validateCustomFolderFailed", [
            error instanceof Error ? error.message : t("settings_unknownError"),
          ]),
        }
      }
    }

    return { isValid: false, error: t("settings_invalidDownloadMode") }
  }

  /**
   * Update settings with validation and immediate sync
   */
  async updateSettingsWithSync(updates: Partial<ExtensionSettings>): Promise<{
    success: boolean
    error?: string
    settings?: ExtensionSettings
  }> {
    try {
      // Validate destination if it is being changed.
      if (updates.downloads?.destination) {
        const validation = await this.validateDestination(
          updates.downloads.destination
        )
        if (!validation.isValid) {
          return { success: false, error: validation.error }
        }
      }

      // Update settings using the existing service
      const newSettings = await settingsService.updateSettings(updates)
      await this.triggerCentralizedStateUpdate(newSettings)

      return { success: true, settings: newSettings }
    } catch (error) {
      logger.error("Failed to update settings with sync:", error)
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to update settings",
      }
    }
  }

  /**
   * Trigger centralized state update via action message
   */
  private async triggerCentralizedStateUpdate(
    settings: ExtensionSettings
  ): Promise<void> {
    try {
      // Send a message to the background script to update centralized state
      await chrome.runtime.sendMessage<SyncSettingsToStateMessage>({
        type: "SYNC_SETTINGS_TO_STATE",
        ...createCommandEnvelope(),
        payload: { settings },
      })
    } catch (error) {
      // This might fail if background script isn't ready, which is OK
      logger.debug(
        "Could not send settings sync message to background (may not be ready):",
        error
      )
    }
  }

  /**
   * Notify listeners about storage changes observed in this runtime.
   */
  private notifySettingsChange(
    newSettings: ExtensionSettings,
    oldSettings?: ExtensionSettings
  ): void {
    const changedKeys: string[] = []

    if (oldSettings) {
      this.findChangedKeys("", newSettings, oldSettings, changedKeys)
    } else {
      changedKeys.push("*") // All keys changed (first time)
    }

    const notification: SettingsSyncNotification = {
      type: "SETTINGS_CHANGED",
      settings: newSettings,
      changedKeys,
    }

    this.listeners.forEach((listener) => {
      try {
        listener(notification)
      } catch (error) {
        logger.error("Settings sync listener error:", error)
      }
    })
  }

  /**
   * Deep compare objects to find changed keys
   */
  private findChangedKeys(
    prefix: string,
    newObj: object,
    oldObj: object | undefined,
    changedKeys: string[]
  ): void {
    const oldEntries = new Map<string, unknown>(Object.entries(oldObj ?? {}))

    for (const [key, newValue] of Object.entries(newObj)) {
      const oldValue = oldEntries.get(key)
      const fullKey = prefix ? `${prefix}.${key}` : key

      if (isRecord(newValue) && isRecord(oldValue)) {
        this.findChangedKeys(fullKey, newValue, oldValue, changedKeys)
      } else if (newValue !== oldValue) {
        changedKeys.push(fullKey)
      }
    }
  }

  /**
   * Add a listener for settings changes
   */
  addListener(
    listener: (notification: SettingsSyncNotification) => void
  ): void {
    this.listeners.add(listener)
  }

  /**
   * Remove a listener for settings changes
   */
  removeListener(
    listener: (notification: SettingsSyncNotification) => void
  ): void {
    this.listeners.delete(listener)
  }

  /**
   * Check if custom folder is configured and valid
   */
  async isCustomFolderConfigured(): Promise<boolean> {
    try {
      const handle = await loadDownloadRootHandle()
      if (!handle) return false

      return await verifyPermission(handle, true)
    } catch (error) {
      logger.error("Failed to check custom folder configuration:", error)
      return false
    }
  }
}

// Singleton instance
export const settingsSyncService = new SettingsSyncService()
