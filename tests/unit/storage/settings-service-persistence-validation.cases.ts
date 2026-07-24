import { describe, expect, it } from "vitest"
import { DEFAULT_SETTINGS } from "@/src/storage/default-settings"
import { DOWNLOAD_ROOT_HANDLE_ID } from "@/src/storage/fs-access"
import type { ExtensionSettings } from "@/src/storage/settings-types"
import {
  SETTINGS_LIMITS,
  SETTINGS_STORAGE_KEY,
} from "@/src/storage/settings-service"
import { mockStorageData, settingsService } from "./settings-service-test-setup"

export function registerSettingsServicePersistenceAndValidationCases(): void {
  describe("Default Initialization", () => {
    it("should initialize with default settings on first load", async () => {
      const settings = await settingsService.getSettings()

      expect(settings).toEqual(DEFAULT_SETTINGS)
      expect(mockStorageData[SETTINGS_STORAGE_KEY]).toEqual(DEFAULT_SETTINGS)
    })

    it("should return cached settings on subsequent calls", async () => {
      const settings1 = await settingsService.getSettings()
      const settings2 = await settingsService.getSettings()

      expect(settings1).toStrictEqual(settings2)
      expect(chrome.storage.local.get).toHaveBeenCalledTimes(1)
    })
  })

  describe("Settings Persistence", () => {
    it("should load existing settings from storage", async () => {
      const customSettings: ExtensionSettings = {
        ...DEFAULT_SETTINGS,
        downloads: {
          ...DEFAULT_SETTINGS.downloads,
          defaultFormat: "zip",
        },
      }

      mockStorageData[SETTINGS_STORAGE_KEY] = customSettings

      const settings = await settingsService.reload()

      expect(settings.downloads.defaultFormat).toBe("zip")
    })

    it("should canonicalize partial persisted settings documents on reload", async () => {
      mockStorageData[SETTINGS_STORAGE_KEY] = {
        downloads: {
          defaultFormat: "zip",
        },
      }

      const settings = await settingsService.reload()

      expect(settings.downloads.defaultFormat).toBe("zip")
      expect(settings.downloads.suppressSaveAsDialog).toBe(
        DEFAULT_SETTINGS.downloads.suppressSaveAsDialog
      )
      expect(settings.downloads.pathTemplate).toBe(
        DEFAULT_SETTINGS.downloads.pathTemplate
      )
      expect(settings.globalPolicy).toEqual(DEFAULT_SETTINGS.globalPolicy)
      expect(settings.notifications).toBe(DEFAULT_SETTINGS.notifications)
      expect(settings.motionPreference).toBe("system")
      expect("alwaysReduceMotion" in settings).toBe(false)
      expect(settings.uiLanguage).toBe("auto")
    })

    it("should recover the fixed persisted folder handle id for legacy custom-folder settings on reload", async () => {
      mockStorageData[SETTINGS_STORAGE_KEY] = {
        downloads: {
          downloadMode: "custom",
          customDirectoryEnabled: true,
          customDirectoryHandleId: null,
        },
      }

      const settings = await settingsService.reload()

      expect(settings.downloads.destination).toBe("file-system-access")
      expect(settings.downloads.customDirectoryHandleId).toBe(
        DOWNLOAD_ROOT_HANDLE_ID
      )
    })

    it("should ignore malformed nested persisted branches while preserving valid typed leaves on reload", async () => {
      mockStorageData[SETTINGS_STORAGE_KEY] = {
        downloads: "bad-branch",
        globalPolicy: {
          image: "bad-image-policy",
          chapter: { concurrency: 7, delayMs: 250 },
        },
        globalRetries: {
          image: 4,
          chapter: "bad-retry-count",
        },
        notifications: false,
        alwaysReduceMotion: true,
        motionPreference: "bad-motion-preference",
        uiLanguage: "unsupported-locale",
        advanced: {
          logLevel: "debug",
          storageCleanupDays: "bad-cleanup-days",
        },
      }

      const settings = await settingsService.reload()

      expect(settings.downloads).toEqual(DEFAULT_SETTINGS.downloads)
      expect(settings.globalPolicy.image).toEqual(
        DEFAULT_SETTINGS.globalPolicy.image
      )
      expect(settings.globalPolicy.chapter).toEqual({
        concurrency: 1,
        delayMs: 250,
      })
      expect(settings.globalRetries.image).toBe(4)
      expect(settings.globalRetries.chapter).toBe(
        DEFAULT_SETTINGS.globalRetries.chapter
      )
      expect(settings.notifications).toBe(false)
      expect(settings.motionPreference).toBe("system")
      expect("alwaysReduceMotion" in settings).toBe(false)
      expect(settings.uiLanguage).toBe("auto")
      expect(settings.advanced.logLevel).toBe("debug")
      expect(settings.advanced.storageCleanupDays).toBe(
        DEFAULT_SETTINGS.advanced.storageCleanupDays
      )
    })

    it("should persist settings updates to storage", async () => {
      await settingsService.updateSettings({
        downloads: {
          defaultFormat: "zip",
        },
      })

      expect(
        (mockStorageData[SETTINGS_STORAGE_KEY] as ExtensionSettings).downloads
          .defaultFormat
      ).toBe("zip")
    })

    it("should merge partial updates with existing settings", async () => {
      await settingsService.updateSettings({
        downloads: {
          conflictPolicy: "overwrite",
        },
      })

      const settings = await settingsService.getSettings()

      expect(settings.downloads.conflictPolicy).toBe("overwrite")
      expect(settings.downloads.defaultFormat).toBe(
        DEFAULT_SETTINGS.downloads.defaultFormat
      )
      expect(settings.globalPolicy).toEqual(DEFAULT_SETTINGS.globalPolicy)
    })
  })

  describe("Settings Validation and Normalization", () => {
    // Note: `as any` casts in this block are intentional — they inject invalid runtime
    // values to exercise the settings service's validation/normalization paths against
    // data that could come from corrupted storage or malformed extension messages.
    it("should clamp global policy concurrency within limits", async () => {
      await settingsService.updateSettings({
        globalPolicy: {
          image: { concurrency: 999, delayMs: 100 },
        },
      })

      const settings = await settingsService.getSettings()
      expect(settings.globalPolicy.image.concurrency).toBe(
        SETTINGS_LIMITS.MAX_CONCURRENCY
      )
    })

    it("should enforce minimum global policy concurrency", async () => {
      await settingsService.updateSettings({
        globalPolicy: {
          image: { concurrency: 0, delayMs: 100 },
        },
      })

      const settings = await settingsService.getSettings()
      expect(settings.globalPolicy.image.concurrency).toBe(
        SETTINGS_LIMITS.MIN_CONCURRENCY
      )
    })

    it("should normalize concurrency and delay to bounded integers", async () => {
      await settingsService.updateSettings({
        globalPolicy: {
          image: { concurrency: 3.9, delayMs: 9000.8 },
          chapter: { concurrency: 9, delayMs: 9000.8 },
        },
      })

      const settings = await settingsService.getSettings()
      expect(settings.globalPolicy.image.concurrency).toBe(3)
      expect(settings.globalPolicy.image.delayMs).toBe(
        SETTINGS_LIMITS.MAX_DELAY_MS
      )
      expect(settings.globalPolicy.chapter.concurrency).toBe(1)
      expect(settings.globalPolicy.chapter.delayMs).toBe(
        SETTINGS_LIMITS.MAX_DELAY_MS
      )
    })

    it("should ignore stale download-level concurrency settings", async () => {
      await settingsService.updateSettings({
        downloads: {
          maxConcurrentChapters: 999,
          maxConcurrentDownloads: 999,
        } as any,
      })

      const settings = await settingsService.getSettings()
      expect("maxConcurrentChapters" in settings.downloads).toBe(false)
      expect("maxConcurrentDownloads" in settings.downloads).toBe(false)
    })

    it("should enforce minimum delay", async () => {
      await settingsService.updateSettings({
        globalPolicy: {
          image: { concurrency: 2, delayMs: -100 },
        },
      })

      const settings = await settingsService.getSettings()
      expect(settings.globalPolicy.image.delayMs).toBeGreaterThanOrEqual(
        SETTINGS_LIMITS.MIN_DELAY_MS
      )
    })

    it("should clamp retry counts", async () => {
      await settingsService.updateSettings({
        globalRetries: {
          image: 999,
          chapter: -1,
        },
      })

      const settings = await settingsService.getSettings()
      expect(settings.globalRetries.image).toBe(SETTINGS_LIMITS.MAX_RETRIES)
      expect(settings.globalRetries.chapter).toBe(SETTINGS_LIMITS.MIN_RETRIES)
    })

    it("should validate destination enum", async () => {
      await settingsService.updateSettings({
        downloads: {
          destination: "invalid-destination" as any,
        },
      })

      const settings = await settingsService.getSettings()
      expect(settings.downloads.destination).toBe(
        DEFAULT_SETTINGS.downloads.destination
      )
    })

    it("should validate archive format enum", async () => {
      await settingsService.updateSettings({
        downloads: {
          defaultFormat: "invalid-format" as any,
        },
      })

      const settings = await settingsService.getSettings()
      expect(settings.downloads.defaultFormat).toBe(
        DEFAULT_SETTINGS.downloads.defaultFormat
      )
    })

    it("should ensure boolean flags", async () => {
      await settingsService.updateSettings({
        downloads: {
          includeComicInfo: "not-a-boolean" as any,
        },
      })

      const settings = await settingsService.getSettings()
      expect(typeof settings.downloads.includeComicInfo).toBe("boolean")
      expect(settings.downloads.includeComicInfo).toBe(
        DEFAULT_SETTINGS.downloads.includeComicInfo
      )
    })

    it("should normalize malformed includeCoverImage values to the default boolean", async () => {
      await settingsService.updateSettings({
        downloads: {
          includeCoverImage: "not-a-boolean" as any,
        },
      })

      const settings = await settingsService.getSettings()
      expect(typeof settings.downloads.includeCoverImage).toBe("boolean")
      expect(settings.downloads.includeCoverImage).toBe(
        DEFAULT_SETTINGS.downloads.includeCoverImage
      )
    })

    it("should normalize malformed download scalar settings to canonical defaults", async () => {
      await settingsService.updateSettings({
        downloads: {
          conflictPolicy: "not-a-policy" as any,
          pathTemplate: "" as any,
          fileNameTemplate: "" as any,
          suppressSaveAsDialog: "not-a-boolean" as any,
          normalizeImageFilenames: "not-a-boolean" as any,
          imagePaddingDigits: "invalid-padding" as any,
        },
      })

      const settings = await settingsService.getSettings()
      expect(settings.downloads.conflictPolicy).toBe(
        DEFAULT_SETTINGS.downloads.conflictPolicy
      )
      expect(settings.downloads.suppressSaveAsDialog).toBe(
        DEFAULT_SETTINGS.downloads.suppressSaveAsDialog
      )
      expect(settings.downloads.pathTemplate).toBe(
        DEFAULT_SETTINGS.downloads.pathTemplate
      )
      expect(settings.downloads.fileNameTemplate).toBe(
        DEFAULT_SETTINGS.downloads.fileNameTemplate
      )
      expect(settings.downloads.normalizeImageFilenames).toBe(
        DEFAULT_SETTINGS.downloads.normalizeImageFilenames
      )
      expect(settings.downloads.imagePaddingDigits).toBe(
        DEFAULT_SETTINGS.downloads.imagePaddingDigits
      )
    })

    it("should normalize malformed custom destination settings to canonical types", async () => {
      await settingsService.updateSettings({
        downloads: {
          destination: 42 as any,
          customDirectoryHandleId: 42 as any,
        },
      })

      const settings = await settingsService.getSettings()
      expect(settings.downloads.destination).toBe(
        DEFAULT_SETTINGS.downloads.destination
      )
      expect(settings.downloads.customDirectoryHandleId).toBe(
        DEFAULT_SETTINGS.downloads.customDirectoryHandleId
      )
    })

    it("should preserve a valid conflict policy and default malformed values", async () => {
      await settingsService.updateSettings({
        downloads: { conflictPolicy: "overwrite" },
      })
      expect(
        (await settingsService.getSettings()).downloads.conflictPolicy
      ).toBe("overwrite")

      await settingsService.updateSettings({
        downloads: { conflictPolicy: "rename" as never },
      })
      expect(
        (await settingsService.getSettings()).downloads.conflictPolicy
      ).toBe("overwrite")

      mockStorageData[SETTINGS_STORAGE_KEY] = {
        downloads: { conflictPolicy: "rename" },
      }
      expect((await settingsService.reload()).downloads.conflictPolicy).toBe(
        DEFAULT_SETTINGS.downloads.conflictPolicy
      )
    })
  })
}
