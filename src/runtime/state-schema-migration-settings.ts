import { createDefaultSettings } from "@/src/domain/settings/defaults"
import {
  ARCHIVE_FORMATS,
  CONFLICT_POLICIES,
  DOWNLOAD_DESTINATIONS,
  IMAGE_PADDING_DIGITS,
  LOG_LEVELS,
} from "@/src/shared/download-contract"
import { MOTION_PREFERENCES } from "@/src/shared/motion-preference"
import {
  clampRatePolicyInteger,
  RATE_POLICY_LIMITS,
} from "@/src/shared/rate-policy-limits"
import { UI_LANGUAGE_PREFERENCES } from "@/src/shared/ui-language"
import { isRecord } from "@/src/shared/type-guards"
import { DOWNLOAD_ROOT_HANDLE_ID } from "@/src/storage/fs-access"
import {
  parseSettingsDocument,
  SETTINGS_LIMITS,
} from "./state-schema-migration-settings-schema"

type Settings = ReturnType<typeof parseSettingsDocument>
type Downloads = Settings["downloads"]

export function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? clampRatePolicyInteger(value, minimum, maximum)
    : fallback
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function nonemptyString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback
}

function booleanOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

function supportedValue<T>(values: readonly T[], raw: unknown, fallback: T): T {
  return values.find((candidate) => candidate === raw) ?? fallback
}

function legacyDestination(
  downloads: Record<string, unknown>
): Downloads["destination"] | undefined {
  if (
    downloads.downloadMode === "custom" ||
    downloads.customDirectoryEnabled === true
  )
    return "file-system-access"
  if (
    downloads.downloadMode === "browser" ||
    downloads.customDirectoryEnabled === false
  )
    return "downloads-api"
  return undefined
}

function legacyConflictPolicy(
  downloads: Record<string, unknown>,
  destination: Downloads["destination"]
) {
  if (destination === "file-system-access") {
    if (downloads.fsaCollisionPolicy === "overwrite") return "overwrite"
    if (downloads.fsaCollisionPolicy === "skip") return "uniquify"
    return undefined
  }
  if (typeof downloads.overwriteExisting === "boolean")
    return downloads.overwriteExisting ? "overwrite" : "uniquify"
  return undefined
}

function directoryHandle(
  downloads: Record<string, unknown>,
  destination: Downloads["destination"],
  defaults: Downloads
) {
  if (
    typeof downloads.customDirectoryHandleId === "string" &&
    downloads.customDirectoryHandleId.length > 0
  )
    return downloads.customDirectoryHandleId
  return destination === "file-system-access"
    ? DOWNLOAD_ROOT_HANDLE_ID
    : defaults.customDirectoryHandleId
}

function canonicalDownloads(
  downloads: Record<string, unknown>,
  defaults: Downloads
): Downloads {
  const destination = supportedValue(
    DOWNLOAD_DESTINATIONS,
    downloads.destination,
    legacyDestination(downloads) ?? defaults.destination
  )
  return {
    destination,
    customDirectoryHandleId: directoryHandle(downloads, destination, defaults),
    pathTemplate: nonemptyString(downloads.pathTemplate, defaults.pathTemplate),
    defaultFormat: supportedValue(
      ARCHIVE_FORMATS,
      downloads.defaultFormat,
      defaults.defaultFormat
    ),
    fileNameTemplate: nonemptyString(
      downloads.fileNameTemplate,
      defaults.fileNameTemplate
    ),
    conflictPolicy: supportedValue(
      CONFLICT_POLICIES,
      downloads.conflictPolicy,
      legacyConflictPolicy(downloads, destination) ?? defaults.conflictPolicy
    ),
    suppressSaveAsDialog: booleanOrDefault(
      downloads.suppressSaveAsDialog,
      defaults.suppressSaveAsDialog
    ),
    includeComicInfo: booleanOrDefault(
      downloads.includeComicInfo,
      defaults.includeComicInfo
    ),
    includeCoverImage: booleanOrDefault(
      downloads.includeCoverImage,
      defaults.includeCoverImage
    ),
    normalizeImageFilenames: booleanOrDefault(
      downloads.normalizeImageFilenames,
      defaults.normalizeImageFilenames
    ),
    imagePaddingDigits: supportedValue(
      IMAGE_PADDING_DIGITS,
      downloads.imagePaddingDigits,
      defaults.imagePaddingDigits
    ),
  }
}

function canonicalRatePolicy(
  raw: unknown,
  defaults: ReturnType<typeof createDefaultSettings>["globalPolicy"]
): Settings["globalPolicy"] {
  const policy = recordOrEmpty(raw)
  const image = recordOrEmpty(policy.image)
  const chapter = recordOrEmpty(policy.chapter)
  return {
    image: {
      concurrency: boundedInteger(
        image.concurrency,
        defaults.image.concurrency,
        RATE_POLICY_LIMITS.MIN_CONCURRENCY,
        RATE_POLICY_LIMITS.MAX_CONCURRENCY
      ),
      delayMs: boundedInteger(
        image.delayMs,
        defaults.image.delayMs,
        RATE_POLICY_LIMITS.MIN_DELAY_MS,
        RATE_POLICY_LIMITS.MAX_DELAY_MS
      ),
    },
    chapter: {
      concurrency: 1,
      delayMs: boundedInteger(
        chapter.delayMs,
        defaults.chapter.delayMs,
        RATE_POLICY_LIMITS.MIN_DELAY_MS,
        RATE_POLICY_LIMITS.MAX_DELAY_MS
      ),
    },
  }
}

function canonicalRetries(
  raw: unknown,
  defaults: Settings["globalRetries"]
): Settings["globalRetries"] {
  const retries = recordOrEmpty(raw)
  return {
    image: boundedInteger(
      retries.image,
      defaults.image,
      SETTINGS_LIMITS.MIN_RETRIES,
      SETTINGS_LIMITS.MAX_RETRIES
    ),
    chapter: boundedInteger(
      retries.chapter,
      defaults.chapter,
      SETTINGS_LIMITS.MIN_RETRIES,
      SETTINGS_LIMITS.MAX_RETRIES
    ),
  }
}

function canonicalAdvanced(
  raw: unknown,
  defaults: Settings["advanced"]
): Settings["advanced"] {
  const advanced = recordOrEmpty(raw)
  const cleanup = advanced.storageCleanupDays
  return {
    logLevel: supportedValue(LOG_LEVELS, advanced.logLevel, defaults.logLevel),
    storageCleanupDays:
      typeof cleanup === "number" && Number.isFinite(cleanup) && cleanup >= 0
        ? cleanup
        : defaults.storageCleanupDays,
  }
}

/** Normalize released settings at the historical import boundary. */
export function canonicalizeSettings(raw: unknown): Settings | undefined {
  if (raw === undefined) return undefined
  if (!isRecord(raw)) throw new Error("Stored settings are not an object")
  const defaults = createDefaultSettings("warn")
  return parseSettingsDocument({
    downloads: canonicalDownloads(
      recordOrEmpty(raw.downloads),
      defaults.downloads
    ),
    globalPolicy: canonicalRatePolicy(raw.globalPolicy, defaults.globalPolicy),
    globalRetries: canonicalRetries(raw.globalRetries, defaults.globalRetries),
    notifications: booleanOrDefault(raw.notifications, defaults.notifications),
    motionPreference: supportedValue(
      MOTION_PREFERENCES,
      raw.motionPreference,
      defaults.motionPreference
    ),
    uiLanguage: supportedValue(
      UI_LANGUAGE_PREFERENCES,
      raw.uiLanguage,
      defaults.uiLanguage
    ),
    advanced: canonicalAdvanced(raw.advanced, defaults.advanced),
  })
}
