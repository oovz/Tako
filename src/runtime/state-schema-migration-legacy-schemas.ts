import { z } from "zod"

import {
  ARCHIVE_FORMATS,
  CONFLICT_POLICIES,
  DOWNLOAD_DESTINATIONS,
  DownloadTaskChapterStatusSchema,
  DownloadTaskStatusSchema,
} from "@/src/shared/download-contract"

export const finiteNumber = z.number().finite()
export const optionalNonemptyString = z.string().min(1).optional()

export const LegacyTaskChapterSchema = z
  .object({
    id: z.string().min(1),
    url: z.string().min(1),
    title: z.string(),
    locked: z.boolean().optional(),
    index: finiteNumber,
    language: z.string().optional(),
    chapterLabel: z.string().optional(),
    chapterNumber: finiteNumber.optional(),
    volumeId: z.string().optional(),
    volumeNumber: finiteNumber.optional(),
    volumeLabel: z.string().optional(),
    status: DownloadTaskChapterStatusSchema,
    errorMessage: z.string().optional(),
    errorCategory: z.unknown().optional(),
    totalImages: z.number().optional(),
    imagesFailed: z.number().optional(),
    outputs: z
      .object({
        requested: z.number().int().nonnegative().optional(),
        committed: z.number().int().nonnegative().optional(),
        failed: z.number().int().nonnegative().optional(),
      })
      .optional(),
    dispatchAttempt: z.number().int().nonnegative().optional(),
    lastUpdated: finiteNumber,
  })
  .strip()

export const LegacyTaskSettingsSnapshotSchema = z
  .object({
    archiveFormat: z.enum(ARCHIVE_FORMATS).optional(),
    destination: z.enum(DOWNLOAD_DESTINATIONS).optional(),
    conflictPolicy: z.enum(CONFLICT_POLICIES).optional(),
    fsaCollisionPolicy: z.enum(["overwrite", "skip"]).optional(),
    overwriteExisting: z.boolean().optional(),
    pathTemplate: optionalNonemptyString,
    fileNameTemplate: optionalNonemptyString,
    includeComicInfo: z.boolean().optional(),
    includeCoverImage: z.boolean().optional(),
    rateLimitSettings: z
      .object({
        image: z.record(z.string(), z.unknown()).optional(),
        chapter: z.record(z.string(), z.unknown()).optional(),
      })
      .partial()
      .optional(),
    retrySettings: z
      .object({
        image: z.number().optional(),
        chapter: z.number().optional(),
      })
      .partial()
      .optional(),
    siteSettings: z.record(z.string(), z.unknown()).optional(),
    normalizeImageFilenames: z.boolean().optional(),
    imagePaddingDigits: z
      .union([
        z.literal("auto"),
        z.literal(2),
        z.literal(3),
        z.literal(4),
        z.literal(5),
      ])
      .optional(),
    comicInfo: z.record(z.string(), z.unknown()).optional(),
  })
  .strip()

export const LegacyDownloadTaskSchema = z
  .object({
    id: z.string().min(1),
    siteIntegrationId: z.string().min(1),
    mangaId: z.string().min(1),
    seriesTitle: z.string(),
    seriesCoverUrl: z.string().optional(),
    chapters: z.array(LegacyTaskChapterSchema),
    status: DownloadTaskStatusSchema,
    errorMessage: z.string().optional(),
    errorCategory: z.unknown().optional(),
    created: finiteNumber,
    started: finiteNumber.optional(),
    completed: finiteNumber.optional(),
    isRetried: z.boolean().optional(),
    isRetryTask: z.boolean().optional(),
    lastSuccessfulDownloadId: z.number().int().nonnegative().optional(),
    activeBlock: z.literal("destination_action_required").optional(),
    destinationOverride: z.literal("downloads-api").optional(),
    nextChapterDispatchAt: finiteNumber.optional(),
    settingsSnapshot: z.unknown().optional(),
    taskSettingsSnapshot: z.unknown().optional(),
    seriesMetadata: z.unknown().optional(),
  })
  .strip()

export const LegacyPendingUndoActionSchema = z
  .object({
    token: z.string().min(1),
    type: z.enum(["cancel_queued", "remove_history"]),
    taskSnapshot: z.unknown(),
    previousQueuePosition: z.number().int().nonnegative(),
    createdAt: finiteNumber,
    expiresAt: finiteNumber,
  })
  .strip()

export const LegacyDownloadedChapterSchema = z
  .object({
    siteIntegrationId: z.string().min(1).optional(),
    chapterId: z.string().min(1),
    url: z.string(),
    title: z.string(),
    seriesId: z.string().min(1),
    seriesTitle: z.string(),
    chapterNumber: finiteNumber.optional(),
    volumeNumber: finiteNumber.optional(),
    downloadedAt: finiteNumber.nonnegative(),
    filePath: z.string().optional(),
    fileSize: finiteNumber.nonnegative().optional(),
    format: z.enum(["zip", "cbz", "cbr", "pdf", "none"]),
  })
  .strip()

export const LegacyHistoryCutoffsSchema = z
  .object({
    allBefore: finiteNumber.nonnegative().optional(),
    bySeries: z
      .record(z.string().min(1), finiteNumber.nonnegative())
      .optional(),
    byChapter: z
      .record(z.string().min(1), finiteNumber.nonnegative())
      .optional(),
  })
  .strip()
