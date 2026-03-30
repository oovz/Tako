/**
 * @file settings.ts
 * @description Settings configuration mock data factories and predefined datasets for E2E tests
 * 
 * Provides semantic, reusable settings presets for testing different
 * configuration scenarios.
 */

import type { ExtensionSettings } from '@/src/storage/settings-types';

// Note: Type annotations removed - these are flexible test fixtures
// These settings presets are used for E2E tests with the Side Panel UI

// =============================================================================
// DEFAULT BASE SETTINGS
// =============================================================================

/**
 * Base default settings matching production defaults
 * All other presets extend from this base
 */
export const BASE_DEFAULT_SETTINGS: ExtensionSettings = {
  downloads: {
    maxConcurrentChapters: 2,
    downloadMode: 'browser',
    customDirectoryEnabled: false,
    customDirectoryHandleId: null,
    pathTemplate: '<SERIES_TITLE>/<VOLUME_LABEL>',
    defaultFormat: 'cbz',
    fileNameTemplate: 'Chapter <CHAPTER_NUMBER_PAD3> - <CHAPTER_TITLE>',
    maxConcurrentDownloads: 3,
    overwriteExisting: false,
    includeComicInfo: true,
    includeCoverImage: true,
    normalizeImageFilenames: true,
    imagePaddingDigits: 'auto',
  },
  globalPolicy: {
    image: { concurrency: 5, delayMs: 100 },
    chapter: { concurrency: 2, delayMs: 500 },
  },
  globalRetries: {
    image: 3,
    chapter: 2,
  },
  notifications: true,
  advanced: {
    logLevel: 'info',
    storageCleanupDays: 30,
  },
} as const;

// =============================================================================
// PREDEFINED DATASETS - ARCHIVE FORMATS
// =============================================================================

/**
 * CBZ format settings (default)
 * Use for: CBZ download tests, comic reader compatibility tests
 */
export const CBZ_SETTINGS = {
  name: 'CBZ_SETTINGS',
  description: 'Settings configured for CBZ format downloads',
  settings: {
    downloads: {
      ...BASE_DEFAULT_SETTINGS.downloads,
      defaultFormat: 'cbz',
      includeComicInfo: true,
    },
  },
} as const;

/**
 * ZIP format settings
 * Use for: ZIP download tests, generic archive tests
 */
export const ZIP_SETTINGS = {
  name: 'ZIP_SETTINGS',
  description: 'Settings configured for ZIP format downloads',
  settings: {
    downloads: {
      ...BASE_DEFAULT_SETTINGS.downloads,
      defaultFormat: 'zip',
      includeComicInfo: false, // ComicInfo.xml typically not used with ZIP
    },
  },
} as const;

/**
 * No archive settings (folder with images)
 * Use for: No-archive download tests, folder structure tests
 */
export const NO_ARCHIVE_SETTINGS = {
  name: 'NO_ARCHIVE_SETTINGS',
  description: 'Settings configured for no-archive (folder) downloads',
  settings: {
    downloads: {
      ...BASE_DEFAULT_SETTINGS.downloads,
      defaultFormat: 'none',
      includeComicInfo: false,
      normalizeImageFilenames: true,
    },
  },
} as const;

// =============================================================================
// PREDEFINED DATASETS - RATE LIMITING
// =============================================================================

/**
 * Aggressive rate limiting (slow downloads)
 * Use for: Rate limit enforcement tests, slow download simulation
 */
export const RATE_LIMITED_SETTINGS = {
  name: 'RATE_LIMITED_SETTINGS',
  description: 'Conservative rate limiting for testing throttling',
  settings: {
    globalPolicy: {
      image: { concurrency: 2, delayMs: 500 }, // Slow: 2 concurrent, 500ms delay
      chapter: { concurrency: 1, delayMs: 1000 }, // Very slow: 1 at a time, 1s delay
    },
  },
} as const;

/**
 * Fast rate limiting (maximum speed)
 * Use for: Performance tests, maximum throughput tests
 */
export const FAST_RATE_LIMIT_SETTINGS = {
  name: 'FAST_RATE_LIMIT_SETTINGS',
  description: 'Aggressive rate limiting for maximum speed',
  settings: {
    globalPolicy: {
      image: { concurrency: 10, delayMs: 0 }, // Fast: 10 concurrent, no delay
      chapter: { concurrency: 5, delayMs: 0 }, // Fast: 5 concurrent, no delay
    },
    downloads: {
      ...BASE_DEFAULT_SETTINGS.downloads,
      maxConcurrentChapters: 5,
      maxConcurrentDownloads: 10,
    },
  },
} as const;

/**
 * Balanced rate limiting (default production settings)
 * Use for: Standard download tests, realistic scenarios
 */
export const BALANCED_RATE_LIMIT_SETTINGS = {
  name: 'BALANCED_RATE_LIMIT_SETTINGS',
  description: 'Balanced rate limiting (production defaults)',
  settings: {
    globalPolicy: BASE_DEFAULT_SETTINGS.globalPolicy,
    downloads: {
      ...BASE_DEFAULT_SETTINGS.downloads,
      maxConcurrentChapters: 2,
      maxConcurrentDownloads: 3,
    },
  },
} as const;

// =============================================================================
// PREDEFINED DATASETS - FILENAME TEMPLATES
// =============================================================================

/**
 * Simple filename template
 * Use for: Basic filename tests
 */
export const SIMPLE_FILENAME_SETTINGS = {
  name: 'SIMPLE_FILENAME_SETTINGS',
  description: 'Simple filename template without padding',
  settings: {
    downloads: {
      ...BASE_DEFAULT_SETTINGS.downloads,
      fileNameTemplate: 'Chapter <CHAPTER_NUMBER> - <CHAPTER_TITLE>',
    },
  },
} as const;

/**
 * Complex filename template with all macros
 * Use for: Template resolution tests, macro expansion tests
 */
export const COMPLEX_FILENAME_SETTINGS = {
  name: 'COMPLEX_FILENAME_SETTINGS',
  description: 'Complex filename template with all macros',
  settings: {
    downloads: {
      ...BASE_DEFAULT_SETTINGS.downloads,
      fileNameTemplate: '[<VOLUME_NUMBER_PAD2>] Chapter <CHAPTER_NUMBER_PAD3> - <CHAPTER_TITLE>',
    },
  },
} as const;

/**
 * Custom path template
 * Use for: Custom path tests, directory structure tests
 */
export const CUSTOM_PATH_SETTINGS = {
  name: 'CUSTOM_PATH_SETTINGS',
  description: 'Custom download path template',
  settings: {
    downloads: {
      ...BASE_DEFAULT_SETTINGS.downloads,
      pathTemplate: 'Manga/<SERIES_TITLE>/Vol <VOLUME_NUMBER>',
      downloadMode: 'custom',
    },
  },
} as const;

// =============================================================================
// PREDEFINED DATASETS - UI SETTINGS
// =============================================================================

/**
 * Notifications disabled
 * Use for: Silent operation tests
 */
export const NO_NOTIFICATIONS_SETTINGS = {
  name: 'NO_NOTIFICATIONS_SETTINGS',
  description: 'Settings with notifications disabled',
  settings: {
    notifications: false,
  },
} as const;

// =============================================================================
// PREDEFINED DATASETS - ADVANCED SETTINGS
// =============================================================================

/**
 * Debug mode enabled
 * Use for: Debug logging tests, troubleshooting scenarios
 */
export const DEBUG_MODE_SETTINGS = {
  name: 'DEBUG_MODE_SETTINGS',
  description: 'Settings with debug mode and verbose logging',
  settings: {
    advanced: {
      ...BASE_DEFAULT_SETTINGS.advanced,
      logLevel: 'debug',
    },
  },
} as const;

/**
 * Production mode (minimal logging)
 * Use for: Production-like tests, performance tests
 */
export const PRODUCTION_MODE_SETTINGS = {
  name: 'PRODUCTION_MODE_SETTINGS',
  description: 'Production settings with minimal logging',
  settings: {
    advanced: {
      ...BASE_DEFAULT_SETTINGS.advanced,
      logLevel: 'error',
    },
  },
} as const;

// =============================================================================
// PREDEFINED DATASETS - COMBINED SCENARIOS
// =============================================================================

/**
 * Power user settings: Fast, debug mode, custom paths
 * Use for: Advanced user workflow tests
 */
export const POWER_USER_SETTINGS = {
  name: 'POWER_USER_SETTINGS',
  description: 'Power user configuration with fast downloads and debug mode',
  settings: {
    downloads: {
      ...BASE_DEFAULT_SETTINGS.downloads,
      maxConcurrentChapters: 5,
      maxConcurrentDownloads: 10,
      downloadMode: 'custom',
      overwriteExisting: true,
    },
    globalPolicy: {
      image: { concurrency: 10, delayMs: 0 },
      chapter: { concurrency: 5, delayMs: 0 },
    },
    advanced: {
      ...BASE_DEFAULT_SETTINGS.advanced,
      logLevel: 'debug',
    },
  },
} as const;

/**
 * Minimal settings: Conservative, safe defaults
 * Use for: First-time user tests, conservative workflow tests
 */
export const MINIMAL_SETTINGS = {
  name: 'MINIMAL_SETTINGS',
  description: 'Conservative settings for new users',
  settings: {
    downloads: {
      ...BASE_DEFAULT_SETTINGS.downloads,
      maxConcurrentChapters: 1,
      maxConcurrentDownloads: 1,
      overwriteExisting: false,
    },
    globalPolicy: {
      image: { concurrency: 3, delayMs: 200 },
      chapter: { concurrency: 1, delayMs: 1000 },
    },
  },
} as const;

// =============================================================================
// EXPORTS
// =============================================================================

/**
 * All predefined settings datasets grouped by category
 */
export const ALL_SETTINGS_DATASETS = {
  FORMATS: [
    CBZ_SETTINGS,
    ZIP_SETTINGS,
    NO_ARCHIVE_SETTINGS,
  ],
  RATE_LIMITING: [
    RATE_LIMITED_SETTINGS,
    FAST_RATE_LIMIT_SETTINGS,
    BALANCED_RATE_LIMIT_SETTINGS,
  ],
  FILENAMES: [
    SIMPLE_FILENAME_SETTINGS,
    COMPLEX_FILENAME_SETTINGS,
    CUSTOM_PATH_SETTINGS,
  ],
  UI: [
    NO_NOTIFICATIONS_SETTINGS,
  ],
  ADVANCED: [
    DEBUG_MODE_SETTINGS,
    PRODUCTION_MODE_SETTINGS,
  ],
  SCENARIOS: [
    POWER_USER_SETTINGS,
    MINIMAL_SETTINGS,
  ],
} as const;
