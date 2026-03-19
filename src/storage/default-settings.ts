import type { ExtensionSettings } from './settings-types';

// Ref: https://github.com/vitejs/vite/blob/main/docs/guide/env-and-mode.md
const IS_DEV_BUILD = (import.meta as { env?: { DEV?: boolean } }).env?.DEV ?? false;

// Single source of truth for default settings.
export const DEFAULT_SETTINGS: ExtensionSettings = {
  downloads: {
    maxConcurrentChapters: 2,
    downloadMode: 'browser',
    customDirectoryEnabled: false,
    customDirectoryHandleId: null,
    pathTemplate: 'TMD/<SERIES_TITLE>',
    defaultFormat: 'cbz',
    fileNameTemplate: '<CHAPTER_TITLE>',
    maxConcurrentDownloads: 3,
    overwriteExisting: false,
    includeComicInfo: true,
    includeCoverImage: true, // Cover image inclusion enabled by default
    // Image filename normalization defaults
    normalizeImageFilenames: true,
    imagePaddingDigits: 'auto',
  },
  globalPolicy: {
    image: { concurrency: 2, delayMs: 500 },
    chapter: { concurrency: 2, delayMs: 500 },
  },
  globalRetries: { image: 3, chapter: 3 },
  notifications: true,
  advanced: {
    logLevel: IS_DEV_BUILD ? 'debug' : 'warn',
    storageCleanupDays: 30,
  },
};
