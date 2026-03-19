// Centralized settings manager. Single persistent document under STORAGE_KEY.
import logger, { applyAdvancedLoggerSettings } from '@/src/runtime/logger';
import type { RateScopePolicy } from '@/src/types/rate-policy';
import type { ExtensionSettings, RetryCounts } from './settings-types';
import { DEFAULT_SETTINGS } from './default-settings';

type StorageValue = string | number | boolean | null | StorageValue[] | { [key: string]: StorageValue };

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

// Light in-memory cache to avoid repeated deserialize + async call cost during SW hot paths.
// Rationale (validated by research): chrome.storage.local access has non‑trivial latency (can be 1–5ms).
// The cache is authoritative only for the current runtime; onChanged keeps it in sync across contexts.
let cachedSettings: ExtensionSettings | null = null;

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
  if (typeof s.downloads.includeComicInfo !== 'boolean') {
    s.downloads.includeComicInfo = DEFAULT_SETTINGS.downloads.includeComicInfo;
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
function mergeSettings(base: ExtensionSettings, patch: Partial<ExtensionSettings>): ExtensionSettings {
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

async function readFromPersistentStorage(): Promise<ExtensionSettings> {
  if (!isChromeLocalStorageAvailable()) {
    if (!cachedSettings) cachedSettings = { ...DEFAULT_SETTINGS };
    applyAdvancedLoggerSettings(cachedSettings.advanced);
    return cachedSettings;
  }
  const result = await chrome.storage.local.get([SETTINGS_STORAGE_KEY]);
  const stored = result[SETTINGS_STORAGE_KEY] as ExtensionSettings | undefined;
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
        const next = changes[SETTINGS_STORAGE_KEY].newValue as StorageValue | undefined;
        if (!next || typeof next !== 'object' || Array.isArray(next)) return;
        cachedSettings = normalizeSettings(next as unknown as ExtensionSettings);
        applyAdvancedLoggerSettings(cachedSettings.advanced);
      }
    });
  }
} catch { /* ignore listener registration errors */ }

