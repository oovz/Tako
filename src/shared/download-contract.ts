import { z } from "zod"

// Canonical download/settings vocabularies. Types and runtime schemas derive
// from the same literal definitions to avoid contract drift.
export const DOWNLOAD_MODES = ["browser", "custom"] as const
export type DownloadMode = (typeof DOWNLOAD_MODES)[number]
export const DownloadModeSchema = z.enum(DOWNLOAD_MODES)

export const DOWNLOAD_DESTINATIONS = [
  "downloads-api",
  "file-system-access",
] as const
export type DownloadDestination = (typeof DOWNLOAD_DESTINATIONS)[number]
export const DownloadDestinationSchema = z.enum(DOWNLOAD_DESTINATIONS)

export const CONFLICT_POLICIES = ["uniquify", "overwrite"] as const
export type ConflictPolicy = (typeof CONFLICT_POLICIES)[number]
export const ConflictPolicySchema = z.enum(CONFLICT_POLICIES)

export const ARCHIVE_FORMATS = ["cbz", "zip", "none"] as const
export type ArchiveFormat = (typeof ARCHIVE_FORMATS)[number]
export const ArchiveFormatSchema = z.enum(ARCHIVE_FORMATS)

export const IMAGE_PADDING_DIGITS = ["auto", 2, 3, 4, 5] as const
export type ImagePaddingDigits = (typeof IMAGE_PADDING_DIGITS)[number]
export const ImagePaddingDigitsSchema = z.union([
  z.literal("auto"),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
])

export const LOG_LEVELS = ["error", "warn", "info", "debug"] as const
export type LogLevel = (typeof LOG_LEVELS)[number]
export const LogLevelSchema = z.enum(LOG_LEVELS)

export const DOWNLOAD_TASK_CHAPTER_STATUSES = [
  "queued",
  "downloading",
  "completed",
  "partial_success",
  "failed",
  "canceled",
  "skipped",
] as const
export type DownloadTaskChapterStatus =
  (typeof DOWNLOAD_TASK_CHAPTER_STATUSES)[number]
export const DownloadTaskChapterStatusSchema = z.enum(
  DOWNLOAD_TASK_CHAPTER_STATUSES
)

export const DOWNLOAD_TASK_STATUSES = [
  "queued",
  "downloading",
  "completed",
  "partial_success",
  "failed",
  "canceled",
] as const
export type DownloadTaskStatus = (typeof DOWNLOAD_TASK_STATUSES)[number]
export const DownloadTaskStatusSchema = z.enum(DOWNLOAD_TASK_STATUSES)

export const DOWNLOAD_PROGRESS_STATUSES = [
  "downloading",
  "completed",
  "failed",
  "partial_success",
] as const
export type DownloadProgressStatus = (typeof DOWNLOAD_PROGRESS_STATUSES)[number]
export const DownloadProgressStatusSchema = z.enum(DOWNLOAD_PROGRESS_STATUSES)

export const DOWNLOAD_ERROR_CATEGORIES = [
  "network_unavailable",
  "provider_rate_limited",
  "provider_changed",
  "chapter_unavailable",
  "folder_permission_required",
  "folder_unavailable",
  "folder_write_failed",
  "disk_full",
  "browser_download_interrupted",
  "browser_download_unobservable",
  "archive_creation_failed",
  "unknown",
] as const
export type DownloadErrorCategory = (typeof DOWNLOAD_ERROR_CATEGORIES)[number]
export const DownloadErrorCategorySchema = z.enum(DOWNLOAD_ERROR_CATEGORIES)

export class NonRetryableDownloadError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = "NonRetryableDownloadError"
  }
}

const NON_RETRYABLE_ERROR_NAMES = new Set([
  "NonRetryableDownloadError",
  "ResponseBodyLimitError",
  "DecodedImageResourceLimitError",
  "ChapterResourceLimitError",
  "ProviderContractError",
])

/**
 * Retry only failures that may change when the same operation is attempted
 * again. Resource, format, and provider-contract failures describe the
 * current payload or provider response and therefore must fail directly.
 */
export function isNonRetryableDownloadError(error: unknown): boolean {
  if (error instanceof NonRetryableDownloadError) return true
  if (!error || typeof error !== "object") return false

  const namedError = error as { name?: unknown }
  if (
    typeof namedError.name === "string" &&
    NON_RETRYABLE_ERROR_NAMES.has(namedError.name)
  ) {
    return true
  }

  return false
}

export function normalizeDownloadErrorCategory(
  value: unknown
): DownloadErrorCategory | undefined {
  if (DownloadErrorCategorySchema.safeParse(value).success) {
    return value as DownloadErrorCategory
  }

  switch (value) {
    case "network":
      return "network_unavailable"
    case "download":
      return "archive_creation_failed"
    case "other":
      return "unknown"
    default:
      return undefined
  }
}
