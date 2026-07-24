// Centralized settings manager. Single persistent document under STORAGE_KEY.
import logger, { applyAdvancedLoggerSettings } from "@/src/runtime/logger"
import {
  ARCHIVE_FORMATS,
  ArchiveFormatSchema,
  CONFLICT_POLICIES,
  ConflictPolicySchema,
  DOWNLOAD_DESTINATIONS,
  DownloadDestinationSchema,
  IMAGE_PADDING_DIGITS,
  ImagePaddingDigitsSchema,
  LOG_LEVELS,
  LogLevelSchema,
} from "@/src/shared/download-contract"
import { isRecord } from "@/src/shared/type-guards"
import {
  UI_LANGUAGE_PREFERENCES,
  type UiLanguagePreference,
} from "@/src/shared/ui-language"
import {
  MOTION_PREFERENCES,
  type MotionPreference,
} from "@/src/shared/motion-preference"
import { z } from "zod"
import type { RateScopePolicy } from "@/src/types/rate-policy"
import type {
  AdvancedSettings,
  DownloadSettings,
  ExtensionSettings,
  RetryCounts,
} from "./settings-types"
import { DEFAULT_SETTINGS } from "./default-settings"
import { DOWNLOAD_ROOT_HANDLE_ID } from "./fs-access"
import { StorageMutationQueue } from "./storage-mutation-queue"
import {
  clampRatePolicyInteger,
  RATE_POLICY_LIMITS,
} from "@/src/shared/rate-policy-limits"

type ExtensionSettingsPatch = {
  downloads?: Partial<DownloadSettings>
  globalPolicy?: {
    image?: Partial<RateScopePolicy>
    chapter?: Partial<RateScopePolicy>
  }
  globalRetries?: Partial<RetryCounts>
  notifications?: boolean
  motionPreference?: MotionPreference
  uiLanguage?: UiLanguagePreference
  advanced?: Partial<AdvancedSettings>
}

// Storage key (exported for tests / potential migrations)
export const SETTINGS_STORAGE_KEY = "settings:global"

// Constraint constants (avoid magic numbers). Exported for tests & potential UI validation.
export const SETTINGS_LIMITS = Object.freeze({
  MIN_CONCURRENCY: RATE_POLICY_LIMITS.MIN_CONCURRENCY,
  MAX_CONCURRENCY: RATE_POLICY_LIMITS.MAX_CONCURRENCY,
  MIN_DELAY_MS: RATE_POLICY_LIMITS.MIN_DELAY_MS,
  MAX_DELAY_MS: RATE_POLICY_LIMITS.MAX_DELAY_MS,
  MIN_RETRIES: 0,
  MAX_RETRIES: 10,
})

// Light in-memory cache to avoid repeated deserialize + async call cost during SW hot paths.
// Rationale (validated by research): chrome.storage.local access has non‑trivial latency (can be 1–5ms).
// The cache is authoritative only for the current runtime; onChanged keeps it in sync across contexts.
let cachedSettings: ExtensionSettings | null = null
let settingsLoadPromise: Promise<ExtensionSettings> | null = null
const mutationQueue = new StorageMutationQueue()

const NumberOptionalSchema = z.preprocess(
  (value) => (typeof value === "number" ? value : undefined),
  z.number().optional()
)

const BooleanOptionalSchema = z.preprocess(
  (value) => (typeof value === "boolean" ? value : undefined),
  z.boolean().optional()
)

const StringOptionalSchema = z.preprocess(
  (value) => (typeof value === "string" ? value : undefined),
  z.string().optional()
)

const NullableStringOptionalSchema = z.preprocess(
  (value) => (typeof value === "string" || value === null ? value : undefined),
  z.string().nullable().optional()
)

const DownloadDestinationOptionalSchema = z.preprocess(
  (value) =>
    typeof value === "string" &&
    DOWNLOAD_DESTINATIONS.includes(
      value as (typeof DOWNLOAD_DESTINATIONS)[number]
    )
      ? value
      : undefined,
  DownloadDestinationSchema.optional()
)

const ArchiveFormatOptionalSchema = z.preprocess(
  (value) =>
    typeof value === "string" &&
    ARCHIVE_FORMATS.includes(value as (typeof ARCHIVE_FORMATS)[number])
      ? value
      : undefined,
  ArchiveFormatSchema.optional()
)

const ImagePaddingDigitsOptionalSchema = z.preprocess(
  (value) =>
    IMAGE_PADDING_DIGITS.some((candidate) => candidate === value)
      ? value
      : undefined,
  ImagePaddingDigitsSchema.optional()
)

const ConflictPolicyOptionalSchema = z.preprocess(
  (value) =>
    typeof value === "string" &&
    CONFLICT_POLICIES.includes(value as (typeof CONFLICT_POLICIES)[number])
      ? value
      : undefined,
  ConflictPolicySchema.optional()
)

function migrateDownloadSettingsRecord(
  value: unknown
): Record<string, unknown> {
  if (!isRecord(value)) return {}
  const migrated = { ...value }
  const canonicalDestination = DOWNLOAD_DESTINATIONS.includes(
    value.destination as (typeof DOWNLOAD_DESTINATIONS)[number]
  )
    ? value.destination
    : undefined
  const legacyDestination =
    value.downloadMode === "custom" || value.customDirectoryEnabled === true
      ? "file-system-access"
      : value.downloadMode === "browser" ||
          value.customDirectoryEnabled === false
        ? "downloads-api"
        : undefined
  const destination = canonicalDestination ?? legacyDestination
  if (destination) migrated.destination = destination

  if (!CONFLICT_POLICIES.includes(value.conflictPolicy as never)) {
    const legacyPolicy =
      destination === "file-system-access"
        ? value.fsaCollisionPolicy === "overwrite"
          ? "overwrite"
          : value.fsaCollisionPolicy === "skip"
            ? "uniquify"
            : undefined
        : typeof value.overwriteExisting === "boolean"
          ? value.overwriteExisting
            ? "overwrite"
            : "uniquify"
          : value.fsaCollisionPolicy === "overwrite"
            ? "overwrite"
            : value.fsaCollisionPolicy === "skip"
              ? "uniquify"
              : undefined
    if (legacyPolicy) migrated.conflictPolicy = legacyPolicy
  }
  return migrated
}

const UiLanguagePreferenceOptionalSchema = z.preprocess(
  (value) =>
    UI_LANGUAGE_PREFERENCES.some((candidate) => candidate === value)
      ? value
      : undefined,
  z.enum(UI_LANGUAGE_PREFERENCES).optional()
)

const MotionPreferenceOptionalSchema = z.preprocess(
  (value) =>
    MOTION_PREFERENCES.some((candidate) => candidate === value)
      ? value
      : undefined,
  z.enum(MOTION_PREFERENCES).optional()
)

const LogLevelOptionalSchema = z.preprocess(
  (value) =>
    typeof value === "string" &&
    LOG_LEVELS.includes(value as (typeof LOG_LEVELS)[number])
      ? value
      : undefined,
  LogLevelSchema.optional()
)

const RateScopePolicyPatchSchema = z.preprocess(
  (value) => (isRecord(value) ? value : {}),
  z
    .object({
      concurrency: NumberOptionalSchema,
      delayMs: NumberOptionalSchema,
    })
    .transform((value) => {
      const patch: Partial<RateScopePolicy> = {}
      if (value.concurrency !== undefined) {
        patch.concurrency = value.concurrency
      }
      if (value.delayMs !== undefined) {
        patch.delayMs = value.delayMs
      }

      return Object.keys(patch).length > 0 ? patch : undefined
    })
)

const RetryCountsPatchSchema = z.preprocess(
  (value) => (isRecord(value) ? value : {}),
  z
    .object({
      image: NumberOptionalSchema,
      chapter: NumberOptionalSchema,
    })
    .transform((value) => {
      const patch: Partial<RetryCounts> = {}
      if (value.image !== undefined) {
        patch.image = value.image
      }
      if (value.chapter !== undefined) {
        patch.chapter = value.chapter
      }

      return Object.keys(patch).length > 0 ? patch : undefined
    })
)

const AdvancedSettingsPatchSchema = z.preprocess(
  (value) => (isRecord(value) ? value : {}),
  z
    .object({
      logLevel: LogLevelOptionalSchema,
      storageCleanupDays: NumberOptionalSchema,
    })
    .transform((value) => {
      const patch: Partial<AdvancedSettings> = {}
      if (value.logLevel !== undefined) {
        patch.logLevel = value.logLevel
      }
      if (value.storageCleanupDays !== undefined) {
        patch.storageCleanupDays = value.storageCleanupDays
      }

      return Object.keys(patch).length > 0 ? patch : undefined
    })
)

const DownloadSettingsPatchSchema = z.preprocess(
  migrateDownloadSettingsRecord,
  z
    .object({
      destination: DownloadDestinationOptionalSchema,
      customDirectoryHandleId: NullableStringOptionalSchema,
      pathTemplate: StringOptionalSchema,
      defaultFormat: ArchiveFormatOptionalSchema,
      fileNameTemplate: StringOptionalSchema,
      conflictPolicy: ConflictPolicyOptionalSchema,
      suppressSaveAsDialog: BooleanOptionalSchema,
      includeComicInfo: BooleanOptionalSchema,
      includeCoverImage: BooleanOptionalSchema,
      normalizeImageFilenames: BooleanOptionalSchema,
      imagePaddingDigits: ImagePaddingDigitsOptionalSchema,
    })
    .transform((value) => {
      const patch: Partial<DownloadSettings> = {}

      if (value.destination !== undefined) patch.destination = value.destination
      if (value.customDirectoryHandleId !== undefined)
        patch.customDirectoryHandleId = value.customDirectoryHandleId
      if (value.pathTemplate !== undefined)
        patch.pathTemplate = value.pathTemplate
      if (value.defaultFormat !== undefined)
        patch.defaultFormat = value.defaultFormat
      if (value.fileNameTemplate !== undefined)
        patch.fileNameTemplate = value.fileNameTemplate
      if (value.conflictPolicy !== undefined)
        patch.conflictPolicy = value.conflictPolicy
      if (value.suppressSaveAsDialog !== undefined)
        patch.suppressSaveAsDialog = value.suppressSaveAsDialog
      if (value.includeComicInfo !== undefined)
        patch.includeComicInfo = value.includeComicInfo
      if (value.includeCoverImage !== undefined)
        patch.includeCoverImage = value.includeCoverImage
      if (value.normalizeImageFilenames !== undefined)
        patch.normalizeImageFilenames = value.normalizeImageFilenames
      if (value.imagePaddingDigits !== undefined)
        patch.imagePaddingDigits = value.imagePaddingDigits

      return Object.keys(patch).length > 0 ? patch : undefined
    })
)

const GlobalPolicyPatchSchema = z.preprocess(
  (value) => (isRecord(value) ? value : {}),
  z
    .object({
      image: RateScopePolicyPatchSchema.optional(),
      chapter: RateScopePolicyPatchSchema.optional(),
    })
    .transform((value) =>
      value.image || value.chapter
        ? {
            ...(value.image ? { image: value.image } : {}),
            ...(value.chapter ? { chapter: value.chapter } : {}),
          }
        : undefined
    )
)

const ExtensionSettingsPatchSchema = z.preprocess(
  (value) => (isRecord(value) ? value : {}),
  z
    .object({
      downloads: DownloadSettingsPatchSchema.optional(),
      globalPolicy: GlobalPolicyPatchSchema.optional(),
      globalRetries: RetryCountsPatchSchema.optional(),
      notifications: BooleanOptionalSchema,
      motionPreference: MotionPreferenceOptionalSchema,
      uiLanguage: UiLanguagePreferenceOptionalSchema,
      advanced: AdvancedSettingsPatchSchema.optional(),
    })
    .transform((value) => {
      const patch: ExtensionSettingsPatch = {}

      if (value.downloads) {
        patch.downloads = value.downloads
      }
      if (value.globalPolicy) {
        patch.globalPolicy = value.globalPolicy
      }
      if (value.globalRetries) {
        patch.globalRetries = value.globalRetries
      }
      if (typeof value.notifications === "boolean") {
        patch.notifications = value.notifications
      }
      if (value.motionPreference !== undefined) {
        patch.motionPreference = value.motionPreference
      }
      if (value.uiLanguage !== undefined) {
        patch.uiLanguage = value.uiLanguage
      }
      if (value.advanced) {
        patch.advanced = value.advanced
      }

      return patch
    })
)

function isChromeLocalStorageAvailable(): boolean {
  try {
    return typeof chrome !== "undefined" && !!chrome.storage?.local?.get
  } catch {
    return false
  }
}

/** Normalize + clamp settings. Mutates the passed object; callers must pass a fresh copy. */
function normalizeSettings(settings: ExtensionSettings): ExtensionSettings {
  const s = settings
  const L = SETTINGS_LIMITS
  if (
    typeof s.downloads.customDirectoryHandleId !== "string" &&
    s.downloads.customDirectoryHandleId !== null
  ) {
    s.downloads.customDirectoryHandleId =
      DEFAULT_SETTINGS.downloads.customDirectoryHandleId
  }
  if (
    s.downloads.destination === "file-system-access" &&
    s.downloads.customDirectoryHandleId === null
  ) {
    s.downloads.customDirectoryHandleId = DOWNLOAD_ROOT_HANDLE_ID
  }
  if (typeof s.downloads.suppressSaveAsDialog !== "boolean") {
    s.downloads.suppressSaveAsDialog =
      DEFAULT_SETTINGS.downloads.suppressSaveAsDialog
  }
  if (typeof s.downloads.includeComicInfo !== "boolean") {
    s.downloads.includeComicInfo = DEFAULT_SETTINGS.downloads.includeComicInfo
  }
  if (typeof s.downloads.includeCoverImage !== "boolean") {
    s.downloads.includeCoverImage = DEFAULT_SETTINGS.downloads.includeCoverImage
  }
  if (typeof s.downloads.normalizeImageFilenames !== "boolean") {
    s.downloads.normalizeImageFilenames =
      DEFAULT_SETTINGS.downloads.normalizeImageFilenames
  }
  if (
    typeof s.downloads.pathTemplate !== "string" ||
    s.downloads.pathTemplate.length === 0
  ) {
    s.downloads.pathTemplate = DEFAULT_SETTINGS.downloads.pathTemplate
  }
  if (
    typeof s.downloads.fileNameTemplate !== "string" ||
    s.downloads.fileNameTemplate.length === 0
  ) {
    s.downloads.fileNameTemplate = DEFAULT_SETTINGS.downloads.fileNameTemplate
  }
  if (
    s.downloads.imagePaddingDigits !== "auto" &&
    s.downloads.imagePaddingDigits !== 2 &&
    s.downloads.imagePaddingDigits !== 3 &&
    s.downloads.imagePaddingDigits !== 4 &&
    s.downloads.imagePaddingDigits !== 5
  ) {
    s.downloads.imagePaddingDigits =
      DEFAULT_SETTINGS.downloads.imagePaddingDigits
  }
  // Global policies
  s.globalPolicy.image.concurrency = clampRatePolicyInteger(
    s.globalPolicy.image.concurrency,
    L.MIN_CONCURRENCY,
    L.MAX_CONCURRENCY
  )
  // Retain the shared chapter policy shape for snapshots, but keep dispatch
  // concurrency fixed until scheduler/offscreen reentrancy work is done.
  s.globalPolicy.chapter.concurrency = 1
  s.globalPolicy.image.delayMs = clampRatePolicyInteger(
    s.globalPolicy.image.delayMs,
    L.MIN_DELAY_MS,
    L.MAX_DELAY_MS
  )
  s.globalPolicy.chapter.delayMs = clampRatePolicyInteger(
    s.globalPolicy.chapter.delayMs,
    L.MIN_DELAY_MS,
    L.MAX_DELAY_MS
  )
  // Retry counts
  s.globalRetries.image = Math.min(
    L.MAX_RETRIES,
    Math.max(L.MIN_RETRIES, s.globalRetries.image)
  )
  s.globalRetries.chapter = Math.min(
    L.MAX_RETRIES,
    Math.max(L.MIN_RETRIES, s.globalRetries.chapter)
  )
  // Enums
  if (!DOWNLOAD_DESTINATIONS.includes(s.downloads.destination))
    s.downloads.destination = DEFAULT_SETTINGS.downloads.destination
  if (!CONFLICT_POLICIES.includes(s.downloads.conflictPolicy))
    s.downloads.conflictPolicy = DEFAULT_SETTINGS.downloads.conflictPolicy
  if (!ARCHIVE_FORMATS.includes(s.downloads.defaultFormat))
    s.downloads.defaultFormat = DEFAULT_SETTINGS.downloads.defaultFormat
  return s
}

/** Deep-ish merge supporting nested partial updates while preserving unspecified branches. */
function mergeSettings(
  base: ExtensionSettings,
  patch: ExtensionSettingsPatch
): ExtensionSettings {
  const out: ExtensionSettings = {
    ...base,
    ...patch,
    downloads: { ...base.downloads, ...(patch.downloads || {}) },
    globalPolicy: {
      image: {
        ...base.globalPolicy.image,
        ...(patch.globalPolicy?.image || {}),
      },
      chapter: {
        ...base.globalPolicy.chapter,
        ...(patch.globalPolicy?.chapter || {}),
      },
    },
    globalRetries: { ...base.globalRetries, ...(patch.globalRetries || {}) },
    notifications:
      typeof patch.notifications === "boolean"
        ? patch.notifications
        : base.notifications,
    motionPreference: patch.motionPreference ?? base.motionPreference,
    uiLanguage: patch.uiLanguage ?? base.uiLanguage,
    advanced: { ...base.advanced, ...(patch.advanced || {}) },
  }
  return normalizeSettings(out)
}

function toExtensionSettingsPatch(
  value: Record<string, unknown>
): ExtensionSettingsPatch {
  return ExtensionSettingsPatchSchema.parse(value)
}

export function canonicalizeSettingsDocument(
  value: unknown
): ExtensionSettings | null {
  if (!isRecord(value)) {
    return null
  }

  return mergeSettings(DEFAULT_SETTINGS, toExtensionSettingsPatch(value))
}

function hasLegacyDownloadSettings(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.downloads)) return false
  const downloads = value.downloads
  return (
    !("destination" in downloads) ||
    !("conflictPolicy" in downloads) ||
    "downloadMode" in downloads ||
    "customDirectoryEnabled" in downloads ||
    "fsaCollisionPolicy" in downloads ||
    "overwriteExisting" in downloads
  )
}

async function readFromPersistentStorage(): Promise<ExtensionSettings> {
  if (!isChromeLocalStorageAvailable()) {
    if (!cachedSettings) cachedSettings = mergeSettings(DEFAULT_SETTINGS, {})
    applyAdvancedLoggerSettings(cachedSettings.advanced)
    return cachedSettings
  }
  const result = await chrome.storage.local.get([SETTINGS_STORAGE_KEY])
  const rawStored = result[SETTINGS_STORAGE_KEY]
  const stored = canonicalizeSettingsDocument(rawStored)
  if (!stored) {
    const defaults = mergeSettings(DEFAULT_SETTINGS, {})
    await chrome.storage.local.set({
      [SETTINGS_STORAGE_KEY]: defaults,
    })
    cachedSettings = defaults
    applyAdvancedLoggerSettings(cachedSettings.advanced)
    return DEFAULT_SETTINGS
  }
  if (hasLegacyDownloadSettings(rawStored)) {
    await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: stored })
  }
  cachedSettings = normalizeSettings(stored)
  applyAdvancedLoggerSettings(cachedSettings.advanced)
  return cachedSettings
}

/** Public API */
export const settingsService = {
  /** Get current settings (cached after first load). */
  async getSettings(): Promise<ExtensionSettings> {
    if (cachedSettings) return cachedSettings // hot path
    if (!settingsLoadPromise) {
      settingsLoadPromise = readFromPersistentStorage()
        .catch((error) => {
          logger.warn(
            "settingsService.getSettings temporary fallback to defaults",
            error
          )
          return mergeSettings(DEFAULT_SETTINGS, {})
        })
        .finally(() => {
          settingsLoadPromise = null
        })
    }
    return settingsLoadPromise
  },
  /** Apply partial update, persist, return normalized result. */
  async updateSettings(
    patch: Partial<ExtensionSettings>
  ): Promise<ExtensionSettings> {
    return mutationQueue.run(async () => {
      // Mutations must start from a durable document. The read-only API may
      // temporarily return defaults during a storage outage, but merging a
      // write into those defaults could erase valid persisted preferences.
      const current = cachedSettings ?? (await readFromPersistentStorage())
      const validatedPatch = toExtensionSettingsPatch(
        isRecord(patch) ? patch : {}
      )
      const merged = mergeSettings(current, validatedPatch)
      if (isChromeLocalStorageAvailable()) {
        await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: merged })
      }
      cachedSettings = merged
      applyAdvancedLoggerSettings(cachedSettings.advanced)
      return merged
    })
  },
  async getGlobalPolicy(): Promise<{
    image: RateScopePolicy
    chapter: RateScopePolicy
  }> {
    const s = await this.getSettings()
    return s.globalPolicy
  },
  async getGlobalRetries(): Promise<RetryCounts> {
    const s = await this.getSettings()
    return s.globalRetries
  },
  /** Force reload from backing storage (used in tests or explicit refresh scenarios). */
  async reload(): Promise<ExtensionSettings> {
    cachedSettings = null
    settingsLoadPromise = null
    return readFromPersistentStorage()
  },
}

// Keep cache consistent when other contexts mutate storage.
try {
  if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes[SETTINGS_STORAGE_KEY]?.newValue) {
        const next = canonicalizeSettingsDocument(
          changes[SETTINGS_STORAGE_KEY].newValue
        )
        if (!next) return
        cachedSettings = next
        applyAdvancedLoggerSettings(cachedSettings.advanced)
      }
    })
  }
} catch {
  /* ignore listener registration errors */
}
