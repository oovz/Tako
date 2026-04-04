import { z } from 'zod'

// Canonical download/settings vocabularies. Types and runtime schemas derive
// from the same literal definitions to avoid contract drift.
export const DOWNLOAD_MODES = ['browser', 'custom'] as const
export type DownloadMode = typeof DOWNLOAD_MODES[number]
export const DownloadModeSchema = z.enum(DOWNLOAD_MODES)

export const ARCHIVE_FORMATS = ['cbz', 'zip', 'none'] as const
export type ArchiveFormat = typeof ARCHIVE_FORMATS[number]
export const ArchiveFormatSchema = z.enum(ARCHIVE_FORMATS)

export const IMAGE_PADDING_DIGITS = ['auto', 2, 3, 4, 5] as const
export type ImagePaddingDigits = typeof IMAGE_PADDING_DIGITS[number]
export const ImagePaddingDigitsSchema = z.union([
  z.literal('auto'),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
])

export const LOG_LEVELS = ['error', 'warn', 'info', 'debug'] as const
export type LogLevel = typeof LOG_LEVELS[number]
export const LogLevelSchema = z.enum(LOG_LEVELS)

export const DOWNLOAD_TASK_CHAPTER_STATUSES = [
  'queued',
  'downloading',
  'completed',
  'partial_success',
  'failed',
] as const
export type DownloadTaskChapterStatus = typeof DOWNLOAD_TASK_CHAPTER_STATUSES[number]
export const DownloadTaskChapterStatusSchema = z.enum(DOWNLOAD_TASK_CHAPTER_STATUSES)

export const DOWNLOAD_TASK_STATUSES = [
  ...DOWNLOAD_TASK_CHAPTER_STATUSES,
  'canceled',
] as const
export type DownloadTaskStatus = typeof DOWNLOAD_TASK_STATUSES[number]
export const DownloadTaskStatusSchema = z.enum(DOWNLOAD_TASK_STATUSES)

export const DOWNLOAD_PROGRESS_STATUSES = [
  'downloading',
  'completed',
  'failed',
  'partial_success',
] as const
export type DownloadProgressStatus = typeof DOWNLOAD_PROGRESS_STATUSES[number]
export const DownloadProgressStatusSchema = z.enum(DOWNLOAD_PROGRESS_STATUSES)

export const DOWNLOAD_ERROR_CATEGORIES = ['network', 'download', 'other'] as const
export type DownloadErrorCategory = typeof DOWNLOAD_ERROR_CATEGORIES[number]
export const DownloadErrorCategorySchema = z.enum(DOWNLOAD_ERROR_CATEGORIES)
