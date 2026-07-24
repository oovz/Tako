import { describe, expect, it, vi } from "vitest"
import { DEFAULT_SETTINGS } from "@/src/storage/default-settings"
import { SETTINGS_STORAGE_KEY } from "@/src/storage/settings-service"
import {
  mockOnChangedListeners,
  mockStorageData,
  settingsService,
} from "./settings-service-test-setup"

export function registerSettingsServiceCacheAndErrorCases(): void {
  describe("Cache Management", () => {
    it("should reload settings from storage", async () => {
      await settingsService.getSettings()

      mockStorageData[SETTINGS_STORAGE_KEY] = {
        ...DEFAULT_SETTINGS,
        downloads: {
          ...DEFAULT_SETTINGS.downloads,
          defaultFormat: "zip",
        },
      }

      const settings = await settingsService.reload()
      expect(settings.downloads.defaultFormat).toBe("zip")
    })

    it("should sync cache when storage changes externally", async () => {
      await settingsService.getSettings()

      const updatedSettings = {
        ...DEFAULT_SETTINGS,
        downloads: {
          ...DEFAULT_SETTINGS.downloads,
          defaultFormat: "zip",
        },
      }

      const changes = {
        [SETTINGS_STORAGE_KEY]: {
          oldValue: DEFAULT_SETTINGS,
          newValue: updatedSettings,
        },
      }

      mockOnChangedListeners.forEach((listener) => listener(changes, "local"))

      const settings = await settingsService.getSettings()
      expect(settings.downloads.defaultFormat).toBe("zip")
    })
  })

  describe("Error Handling", () => {
    it("should return defaults for a storage error without caching them", async () => {
      vi.mocked(chrome.storage.local.get).mockRejectedValueOnce(
        new Error("Storage error")
      )

      const settings = await settingsService.getSettings()
      expect(settings).toEqual(DEFAULT_SETTINGS)

      mockStorageData[SETTINGS_STORAGE_KEY] = {
        ...DEFAULT_SETTINGS,
        downloads: {
          ...DEFAULT_SETTINGS.downloads,
          defaultFormat: "zip",
        },
      }

      const recovered = await settingsService.getSettings()
      expect(recovered.downloads.defaultFormat).toBe("zip")
      expect(chrome.storage.local.get).toHaveBeenCalledTimes(2)
    })

    it("keeps the last durable cache value when persistence fails", async () => {
      const initial = await settingsService.getSettings()
      vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(
        new Error("Write failed")
      )

      await expect(
        settingsService.updateSettings({
          downloads: { defaultFormat: "zip" },
        })
      ).rejects.toThrow("Write failed")

      const current = await settingsService.getSettings()
      expect(current).toEqual(initial)
      expect(current.downloads.defaultFormat).toBe(
        DEFAULT_SETTINGS.downloads.defaultFormat
      )
    })

    it("does not overwrite persisted settings when an update cannot read them", async () => {
      mockStorageData[SETTINGS_STORAGE_KEY] = {
        ...DEFAULT_SETTINGS,
        downloads: {
          ...DEFAULT_SETTINGS.downloads,
          defaultFormat: "zip",
        },
      }
      vi.mocked(chrome.storage.local.get).mockRejectedValueOnce(
        new Error("Read failed")
      )

      await expect(
        settingsService.updateSettings({ notifications: false })
      ).rejects.toThrow("Read failed")
      expect(chrome.storage.local.set).not.toHaveBeenCalled()
      expect(mockStorageData[SETTINGS_STORAGE_KEY]).toEqual(
        expect.objectContaining({
          downloads: expect.objectContaining({ defaultFormat: "zip" }),
        })
      )
    })
  })
}
