import type { ExtensionSettings } from "./types"
import type { LogLevel } from "@/src/shared/download-contract"

export function createDefaultSettings(
  logLevel: LogLevel = "warn"
): ExtensionSettings {
  return {
    downloads: {
      destination: "downloads-api",
      customDirectoryHandleId: null,
      pathTemplate: "TMD/<SERIES_TITLE>",
      defaultFormat: "cbz",
      fileNameTemplate: "<CHAPTER_TITLE>",
      conflictPolicy: "uniquify",
      suppressSaveAsDialog: true,
      includeComicInfo: true,
      includeCoverImage: true,
      normalizeImageFilenames: true,
      imagePaddingDigits: "auto",
    },
    globalPolicy: {
      image: { concurrency: 2, delayMs: 500 },
      chapter: { concurrency: 1, delayMs: 500 },
    },
    globalRetries: { image: 3, chapter: 3 },
    notifications: true,
    motionPreference: "system",
    uiLanguage: "auto",
    advanced: {
      logLevel,
      storageCleanupDays: 30,
    },
  }
}

export const DEFAULT_SETTINGS: ExtensionSettings = createDefaultSettings()

export function cloneDefaultSettings(): ExtensionSettings {
  return structuredClone(DEFAULT_SETTINGS)
}
