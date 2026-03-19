// Shared types for settings to avoid circular imports
import type { RateScopePolicy } from '@/src/types/rate-policy'

export interface RetryCounts { image: number; chapter: number }

export interface AdvancedSettings {
  /** Log verbosity level. 'debug' = most verbose, 'error' = least verbose */
  logLevel: 'error' | 'warn' | 'info' | 'debug';
  storageCleanupDays: number;
}

// All download-related settings (both engine and behavior)
export interface DownloadSettings {
  // Engine settings
  maxConcurrentChapters: number;
  downloadMode: 'browser' | 'custom';
  customDirectoryEnabled: boolean;
  customDirectoryHandleId: string | null;
  /** Directory path template for downloads. */
  pathTemplate: string;
  // Format and behavior settings
  defaultFormat: 'cbz' | 'zip' | 'none';
  /** Optional template for the final chapter filename (without extension when using archives; used as chapter directory name when format is 'none').
   * Supported macros are the same as pathTemplate plus numeric pads like <CHAPTER_NUMBER_PAD2>, <CHAPTER_NUMBER_PAD3>, <VOLUME_NUMBER_PAD2>.
   * Defaults to <CHAPTER_TITLE>.
   */
  fileNameTemplate?: string;
  maxConcurrentDownloads: number;
  overwriteExisting: boolean;
  includeComicInfo: boolean; // whether to embed ComicInfo.xml in archives
  includeCoverImage?: boolean; // whether to include series cover image in archives
  // Image filename normalization
  normalizeImageFilenames: boolean; // whether to rename images to numeric indices (001.jpg, 002.jpg, etc.)
  imagePaddingDigits: 'auto' | 2 | 3 | 4 | 5; // zero-padding for image filenames ('auto' = based on total count)
}

export interface ExtensionSettings {
  // All download-related settings
  downloads: DownloadSettings;
  // Global default policy when no site override or site integration default exists
  globalPolicy: {
    image: RateScopePolicy;
    chapter: RateScopePolicy;
  };
  // Global default retries; can be overridden per-site
  globalRetries: RetryCounts;
  // Notification preferences
  notifications: boolean;
  // Advanced preferences
  advanced: AdvancedSettings;
}
