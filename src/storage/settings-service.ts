// Centralized settings manager. Single persistent document under STORAGE_KEY.
import logger, { applyAdvancedLoggerSettings } from '@/src/runtime/logger';
import { isRecord } from '@/src/shared/type-guards';
import { z } from 'zod';
import type { RateScopePolicy } from '@/src/types/rate-policy';
import type { AdvancedSettings, DownloadSettings, ExtensionSettings, RetryCounts } from './settings-types';
import { DEFAULT_SETTINGS } from './default-settings';

type ExtensionSettingsPatch = {
  downloads?: Partial<DownloadSettings>;
  globalPolicy?: {
    image?: Partial<RateScopePolicy>;
    chapter?: Partial<RateScopePolicy>;
  };
  globalRetries?: Partial<RetryCounts>;
  notifications?: boolean;
  advanced?: Partial<AdvancedSettings>;
};

// Storage key (exported for tests / potential migrations)
export const SETTINGS_STORAGE_KEY = 'settings:global';

// Constraint constants (avoid magic numbers). Exported for tests & potential UI validation.
export const SETTINGS_LIMITS = Object.freeze({
  MIN_CONCURRENCY: 1,
  MAX_CONCURRENCY: 10,
  MIN_DELAY_MS: 0,
  MIN_RETRIES: 0,
  MAX_RETRIES: 10,
});

// Enumeration allow-lists
const DOWNLOAD_MODES = ['browser', 'custom'] as const;
const ARCHIVE_FORMATS = ['cbz', 'zip', 'none'] as const;
const LOG_LEVELS = ['error', 'warn', 'info', 'debug'] as const;

// Light in-memory cache to avoid repeated deserialize + async call cost during SW hot paths.
// Rationale (validated by research): chrome.storage.local access has non‑trivial latency (can be 1–5ms).
// The cache is authoritative only for the current runtime; onChanged keeps it in sync across contexts.
let cachedSettings: ExtensionSettings | null = null;

const NumberOptionalSchema = z.preprocess(
  (value) => typeof value === 'number' ? value : undefined,
  z.number().optional(),
);

const BooleanOptionalSchema = z.preprocess(
  (value) => typeof value === 'boolean' ? value : undefined,
  z.boolean().optional(),
);

const StringOptionalSchema = z.preprocess(
  (value) => typeof value === 'string' ? value : undefined,
  z.string().optional(),
);

const NullableStringOptionalSchema = z.preprocess(
  (value) => typeof value === 'string' || value === null ? value : undefined,
  z.string().nullable().optional(),
);

const DownloadModeOptionalSchema = z.preprocess(
  (value) => value === 'browser' || value === 'custom' ? value : undefined,
  z.enum(DOWNLOAD_MODES).optional(),
);

const ArchiveFormatOptionalSchema = z.preprocess(
  (value) => value === 'cbz' || value === 'zip' || value === 'none' ? value : undefined,
  z.enum(ARCHIVE_FORMATS).optional(),
);

const ImagePaddingDigitsOptionalSchema = z.preprocess(
  (value) => value === 'auto' || value === 2 || value === 3 || value === 4 || value === 5 ? value : undefined,
  z.union([z.literal('auto'), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).optional(),
);

const LogLevelOptionalSchema = z.preprocess(
  (value) => value === 'error' || value === 'warn' || value === 'info' || value === 'debug' ? value : undefined,
  z.enum(LOG_LEVELS).optional(),
);

const RateScopePolicyPatchSchema = z.preprocess(
  (value) => isRecord(value) ? value : {},
  z.object({
    concurrency: NumberOptionalSchema,
    delayMs: NumberOptionalSchema,
  }).transform((value) => {
    const patch: Partial<RateScopePolicy> = {};
    if (value.concurrency !== undefined) {
      patch.concurrency = value.concurrency;
    }
    if (value.delayMs !== undefined) {
      patch.delayMs = value.delayMs;
    }

    return Object.keys(patch).length > 0 ? patch : undefined;
  }),
);

const RetryCountsPatchSchema = z.preprocess(
  (value) => isRecord(value) ? value : {},
  z.object({
    image: NumberOptionalSchema,
    chapter: NumberOptionalSchema,
  }).transform((value) => {
    const patch: Partial<RetryCounts> = {};
    if (value.image !== undefined) {
      patch.image = value.image;
    }
    if (value.chapter !== undefined) {
      patch.chapter = value.chapter;
    }

    return Object.keys(patch).length > 0 ? patch : undefined;
  }),
);

const AdvancedSettingsPatchSchema = z.preprocess(
  (value) => isRecord(value) ? value : {},
  z.object({
    logLevel: LogLevelOptionalSchema,
    storageCleanupDays: NumberOptionalSchema,
  }).transform((value) => {
    const patch: Partial<AdvancedSettings> = {};
    if (value.logLevel !== undefined) {
      patch.logLevel = value.logLevel;
    }
    if (value.storageCleanupDays !== undefined) {
      patch.storageCleanupDays = value.storageCleanupDays;
    }

    return Object.keys(patch).length > 0 ? patch : undefined;
  }),
);

const DownloadSettingsPatchSchema = z.preprocess(
  (value) => isRecord(value) ? value : {},
  z.object({
    maxConcurrentChapters: NumberOptionalSchema,
    downloadMode: DownloadModeOptionalSchema,
    customDirectoryEnabled: BooleanOptionalSchema,
    customDirectoryHandleId: NullableStringOptionalSchema,
    pathTemplate: StringOptionalSchema,
    defaultFormat: ArchiveFormatOptionalSchema,
    fileNameTemplate: StringOptionalSchema,
    maxConcurrentDownloads: NumberOptionalSchema,
    overwriteExisting: BooleanOptionalSchema,
    includeComicInfo: BooleanOptionalSchema,
    includeCoverImage: BooleanOptionalSchema,
    normalizeImageFilenames: BooleanOptionalSchema,
    imagePaddingDigits: ImagePaddingDigitsOptionalSchema,
  }).transform((value) => {
    const patch: Partial<DownloadSettings> = {};

    if (value.maxConcurrentChapters !== undefined) patch.maxConcurrentChapters = value.maxConcurrentChapters;
    if (value.downloadMode !== undefined) patch.downloadMode = value.downloadMode;
    if (value.customDirectoryEnabled !== undefined) patch.customDirectoryEnabled = value.customDirectoryEnabled;
    if (value.customDirectoryHandleId !== undefined) patch.customDirectoryHandleId = value.customDirectoryHandleId;
    if (value.pathTemplate !== undefined) patch.pathTemplate = value.pathTemplate;
    if (value.defaultFormat !== undefined) patch.defaultFormat = value.defaultFormat;
    if (value.fileNameTemplate !== undefined) patch.fileNameTemplate = value.fileNameTemplate;
    if (value.maxConcurrentDownloads !== undefined) patch.maxConcurrentDownloads = value.maxConcurrentDownloads;
    if (value.overwriteExisting !== undefined) patch.overwriteExisting = value.overwriteExisting;
    if (value.includeComicInfo !== undefined) patch.includeComicInfo = value.includeComicInfo;
    if (value.includeCoverImage !== undefined) patch.includeCoverImage = value.includeCoverImage;
    if (value.normalizeImageFilenames !== undefined) patch.normalizeImageFilenames = value.normalizeImageFilenames;
    if (value.imagePaddingDigits !== undefined) patch.imagePaddingDigits = value.imagePaddingDigits;

    return Object.keys(patch).length > 0 ? patch : undefined;
  }),
);

const GlobalPolicyPatchSchema = z.preprocess(
  (value) => isRecord(value) ? value : {},
  z.object({
    image: RateScopePolicyPatchSchema.optional(),
    chapter: RateScopePolicyPatchSchema.optional(),
  }).transform((value) => (
    value.image || value.chapter
      ? {
          ...(value.image ? { image: value.image } : {}),
          ...(value.chapter ? { chapter: value.chapter } : {}),
        }
      : undefined
  )),
);

const ExtensionSettingsPatchSchema = z.preprocess(
  (value) => isRecord(value) ? value : {},
  z.object({
    downloads: DownloadSettingsPatchSchema.optional(),
    globalPolicy: GlobalPolicyPatchSchema.optional(),
    globalRetries: RetryCountsPatchSchema.optional(),
    notifications: BooleanOptionalSchema,
    advanced: AdvancedSettingsPatchSchema.optional(),
  }).transform((value) => {
    const patch: ExtensionSettingsPatch = {};

    if (value.downloads) {
      patch.downloads = value.downloads;
    }
    if (value.globalPolicy) {
      patch.globalPolicy = value.globalPolicy;
    }
    if (value.globalRetries) {
      patch.globalRetries = value.globalRetries;
    }
    if (typeof value.notifications === 'boolean') {
      patch.notifications = value.notifications;
    }
    if (value.advanced) {
      patch.advanced = value.advanced;
    }

    return patch;
  }),
);

function isChromeLocalStorageAvailable(): boolean {
  try {
    return typeof chrome !== 'undefined' && !!chrome.storage?.local?.get;
  } catch { return false; }
}

/** Normalize + clamp settings (mutates copy) */
function normalizeSettings(settings: ExtensionSettings): ExtensionSettings {
  const s = settings;
  const L = SETTINGS_LIMITS;
  // Concurrency limits
  s.downloads.maxConcurrentChapters = Math.min(L.MAX_CONCURRENCY, Math.max(L.MIN_CONCURRENCY, s.downloads.maxConcurrentChapters));
  // Ensure boolean flags
  if (typeof s.downloads.customDirectoryEnabled !== 'boolean') {
    s.downloads.customDirectoryEnabled = DEFAULT_SETTINGS.downloads.customDirectoryEnabled;
  }
  if (typeof s.downloads.customDirectoryHandleId !== 'string' && s.downloads.customDirectoryHandleId !== null) {
    s.downloads.customDirectoryHandleId = DEFAULT_SETTINGS.downloads.customDirectoryHandleId;
  }
  if (typeof s.downloads.overwriteExisting !== 'boolean') {
    s.downloads.overwriteExisting = DEFAULT_SETTINGS.downloads.overwriteExisting;
  }
  if (typeof s.downloads.includeComicInfo !== 'boolean') {
    s.downloads.includeComicInfo = DEFAULT_SETTINGS.downloads.includeComicInfo;
  }
  if (typeof s.downloads.includeCoverImage !== 'boolean') {
    s.downloads.includeCoverImage = DEFAULT_SETTINGS.downloads.includeCoverImage;
  }
  if (typeof s.downloads.normalizeImageFilenames !== 'boolean') {
    s.downloads.normalizeImageFilenames = DEFAULT_SETTINGS.downloads.normalizeImageFilenames;
  }
  if (typeof s.downloads.pathTemplate !== 'string' || s.downloads.pathTemplate.length === 0) {
    s.downloads.pathTemplate = DEFAULT_SETTINGS.downloads.pathTemplate;
  }
  if (typeof s.downloads.fileNameTemplate !== 'string' || s.downloads.fileNameTemplate.length === 0) {
    s.downloads.fileNameTemplate = DEFAULT_SETTINGS.downloads.fileNameTemplate;
  }
  if (
    s.downloads.imagePaddingDigits !== 'auto'
    && s.downloads.imagePaddingDigits !== 2
    && s.downloads.imagePaddingDigits !== 3
    && s.downloads.imagePaddingDigits !== 4
    && s.downloads.imagePaddingDigits !== 5
  ) {
    s.downloads.imagePaddingDigits = DEFAULT_SETTINGS.downloads.imagePaddingDigits;
  }
  // Global policies
  s.globalPolicy.image.concurrency = Math.min(L.MAX_CONCURRENCY, Math.max(L.MIN_CONCURRENCY, s.globalPolicy.image.concurrency));
  s.globalPolicy.chapter.concurrency = Math.min(L.MAX_CONCURRENCY, Math.max(L.MIN_CONCURRENCY, s.globalPolicy.chapter.concurrency));
  s.globalPolicy.image.delayMs = Math.max(L.MIN_DELAY_MS, s.globalPolicy.image.delayMs);
  s.globalPolicy.chapter.delayMs = Math.max(L.MIN_DELAY_MS, s.globalPolicy.chapter.delayMs);
  // Retry counts
  s.globalRetries.image = Math.min(L.MAX_RETRIES, Math.max(L.MIN_RETRIES, s.globalRetries.image));
  s.globalRetries.chapter = Math.min(L.MAX_RETRIES, Math.max(L.MIN_RETRIES, s.globalRetries.chapter));
  // Enums
  if (!DOWNLOAD_MODES.includes(s.downloads.downloadMode)) s.downloads.downloadMode = DEFAULT_SETTINGS.downloads.downloadMode;
  if (!ARCHIVE_FORMATS.includes(s.downloads.defaultFormat)) s.downloads.defaultFormat = DEFAULT_SETTINGS.downloads.defaultFormat;
  return s;
}

/** Deep-ish merge supporting nested partial updates while preserving unspecified branches. */
function mergeSettings(base: ExtensionSettings, patch: ExtensionSettingsPatch): ExtensionSettings {
  const out: ExtensionSettings = {
    ...base,
    ...patch,
    downloads: { ...base.downloads, ...(patch.downloads || {}) },
    globalPolicy: patch.globalPolicy ? {
      image: { ...base.globalPolicy.image, ...(patch.globalPolicy.image || {}) },
      chapter: { ...base.globalPolicy.chapter, ...(patch.globalPolicy.chapter || {}) },
    } : base.globalPolicy,
    globalRetries: patch.globalRetries ? { ...base.globalRetries, ...patch.globalRetries } : base.globalRetries,
    notifications: typeof patch.notifications === 'boolean' ? patch.notifications : base.notifications,
    advanced: patch.advanced ? { ...base.advanced, ...patch.advanced } : base.advanced,
  };
  return normalizeSettings(out);
}

function toExtensionSettingsPatch(value: Record<string, unknown>): ExtensionSettingsPatch {
  return ExtensionSettingsPatchSchema.parse(value);
}

export function canonicalizeSettingsDocument(value: unknown): ExtensionSettings | null {
  if (!isRecord(value)) {
    return null;
  }

  return mergeSettings(DEFAULT_SETTINGS, toExtensionSettingsPatch(value));
}

async function readFromPersistentStorage(): Promise<ExtensionSettings> {
  if (!isChromeLocalStorageAvailable()) {
    if (!cachedSettings) cachedSettings = { ...DEFAULT_SETTINGS };
    applyAdvancedLoggerSettings(cachedSettings.advanced);
    return cachedSettings;
  }
  const result = await chrome.storage.local.get([SETTINGS_STORAGE_KEY]);
  const stored = canonicalizeSettingsDocument(result[SETTINGS_STORAGE_KEY]);
  if (!stored) {
    await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: DEFAULT_SETTINGS });
    cachedSettings = { ...DEFAULT_SETTINGS };
    applyAdvancedLoggerSettings(cachedSettings.advanced);
    return DEFAULT_SETTINGS;
  }
  cachedSettings = normalizeSettings(stored);
  applyAdvancedLoggerSettings(cachedSettings.advanced);
  return cachedSettings;
}

/** Public API */
export const settingsService = {
  /** Get current settings (cached after first load). */
  async getSettings(): Promise<ExtensionSettings> {
    if (cachedSettings) return cachedSettings; // hot path
    try {
      return await readFromPersistentStorage();
    } catch (e) {
      logger.warn('settingsService.getSettings fallback to defaults', e);
      if (!cachedSettings) cachedSettings = { ...DEFAULT_SETTINGS };
      return cachedSettings;
    }
  },
  /** Apply partial update, persist, return normalized result. */
  async updateSettings(patch: Partial<ExtensionSettings>): Promise<ExtensionSettings> {
    const current = await this.getSettings();
    const merged = mergeSettings(current, patch);
    cachedSettings = merged;
    applyAdvancedLoggerSettings(cachedSettings.advanced);
    if (isChromeLocalStorageAvailable()) {
      await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: merged });
    }
    return merged;
  },
  async getGlobalPolicy(): Promise<{ image: RateScopePolicy; chapter: RateScopePolicy }> {
    const s = await this.getSettings();
    return s.globalPolicy;
  },
  async getGlobalRetries(): Promise<RetryCounts> {
    const s = await this.getSettings();
    return s.globalRetries;
  },
  /** Force reload from backing storage (used in tests or explicit refresh scenarios). */
  async reload(): Promise<ExtensionSettings> {
    cachedSettings = null;
    return readFromPersistentStorage();
  }
};

// Keep cache consistent when other contexts mutate storage.
try {
  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[SETTINGS_STORAGE_KEY]?.newValue) {
        const next = canonicalizeSettingsDocument(changes[SETTINGS_STORAGE_KEY].newValue);
        if (!next) return;
        cachedSettings = next;
        applyAdvancedLoggerSettings(cachedSettings.advanced);
      }
    });
  }
} catch { /* ignore listener registration errors */ }

