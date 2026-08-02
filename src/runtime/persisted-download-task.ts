import { DEFAULT_SETTINGS } from "@/src/storage/default-settings"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import {
  ArchiveFormatSchema,
  ConflictPolicySchema,
  DownloadDestinationSchema,
  normalizeDownloadErrorCategory,
  DownloadTaskChapterStatusSchema,
  DownloadTaskStatusSchema,
  ImagePaddingDigitsSchema,
} from "@/src/shared/download-contract"
import { isRecord } from "@/src/shared/type-guards"
import { z } from "zod"
import type { DownloadTaskState, TaskChapter } from "@/src/types/queue-state"
import { normalizeDownloadTaskExecutionState } from "@/src/runtime/download-task-execution-state"

const PersistedTaskChapterStatusSchema = DownloadTaskChapterStatusSchema
const PersistedTaskStatusSchema = DownloadTaskStatusSchema

const BooleanOptionalSchema = z.boolean().optional()
const NonEmptyStringOptionalSchema = z.string().min(1).optional()
const ArchiveFormatOptionalSchema = ArchiveFormatSchema.optional()
const ImagePaddingDigitsOptionalSchema = ImagePaddingDigitsSchema.optional()
const UnknownRecordOptionalSchema = z.record(z.string(), z.unknown()).optional()

const PersistedTaskChapterSchema = z.object({
  id: z.string().min(1),
  url: z.string().min(1),
  title: z.string(),
  locked: z.boolean().optional(),
  index: z.number().finite(),
  language: z.string().optional(),
  chapterLabel: z.string().optional(),
  chapterNumber: z.number().optional(),
  volumeId: z.string().optional(),
  volumeNumber: z.number().optional(),
  volumeLabel: z.string().optional(),
  status: PersistedTaskChapterStatusSchema,
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
  lastUpdated: z.number().finite(),
})

const PersistedTaskSettingsSnapshotSchema = z
  .object({
    archiveFormat: ArchiveFormatOptionalSchema,
    destination: DownloadDestinationSchema.optional(),
    conflictPolicy: ConflictPolicySchema.optional(),
    // Legacy snapshot fields are accepted only for one-way migration.
    fsaCollisionPolicy: z.enum(["overwrite", "skip"]).optional(),
    overwriteExisting: BooleanOptionalSchema,
    pathTemplate: NonEmptyStringOptionalSchema,
    fileNameTemplate: NonEmptyStringOptionalSchema,
    includeComicInfo: BooleanOptionalSchema,
    includeCoverImage: BooleanOptionalSchema,
    rateLimitSettings: z
      .object({
        image: UnknownRecordOptionalSchema,
        chapter: UnknownRecordOptionalSchema,
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
    siteSettings: UnknownRecordOptionalSchema,
    normalizeImageFilenames: BooleanOptionalSchema,
    imagePaddingDigits: ImagePaddingDigitsOptionalSchema,
    comicInfo: UnknownRecordOptionalSchema,
  })
  .strip()

const PersistedTaskSchema = z
  .object({
    id: z.string().min(1),
    siteIntegrationId: z.string().min(1),
    mangaId: z.string().min(1),
    seriesTitle: z.string(),
    seriesCoverUrl: z.string().optional(),
    chapters: z.array(PersistedTaskChapterSchema),
    status: PersistedTaskStatusSchema,
    errorMessage: z.string().optional(),
    errorCategory: z.unknown().optional(),
    created: z.number().finite(),
    started: z.number().optional(),
    completed: z.number().optional(),
    isRetried: z.boolean().optional(),
    isRetryTask: z.boolean().optional(),
    lastSuccessfulDownloadId: z.number().optional(),
    activeBlock: z
      .enum([
        "destination_action_required",
        "provider_network_policy_pending",
        "provider_network_policy_action_required",
      ])
      .optional(),
    browserDownloadWait: z
      .object({
        downloadIds: z.array(z.number().int().nonnegative()),
        since: z.number().finite(),
        lastObservedAt: z.number().finite().optional(),
      })
      .optional(),
    destinationOverride: z.literal("downloads-api").optional(),
    nextChapterDispatchAt: z.number().optional(),
    settingsSnapshot: z.unknown().optional(),
    taskSettingsSnapshot: z.unknown().optional(),
    seriesMetadata: z.unknown().optional(),
  })
  .strip()

export function normalizePersistedDownloadTask(
  rawTask: unknown
): DownloadTaskState | null {
  const parsedTask = PersistedTaskSchema.safeParse(rawTask)
  if (!parsedTask.success) {
    return null
  }

  const task = parsedTask.data

  const { siteIntegrationId, mangaId, seriesTitle } = task

  const legacySeriesMetadata = UnknownRecordOptionalSchema.safeParse(
    task.seriesMetadata
  ).data

  const baseSnapshot = createTaskSettingsSnapshot(
    DEFAULT_SETTINGS,
    siteIntegrationId,
    {
      comicInfo:
        legacySeriesMetadata as DownloadTaskState["settingsSnapshot"]["comicInfo"],
    }
  )

  const rawSnapshotSource = isRecord(task.settingsSnapshot)
    ? task.settingsSnapshot
    : isRecord(task.taskSettingsSnapshot)
      ? task.taskSettingsSnapshot
      : undefined
  const rawSnapshot = rawSnapshotSource
    ? PersistedTaskSettingsSnapshotSchema.safeParse(rawSnapshotSource)
    : undefined
  if (rawSnapshot && !rawSnapshot.success) {
    return null
  }
  const parsedSnapshot = rawSnapshot?.data

  const settingsSnapshot = parsedSnapshot
    ? {
        ...baseSnapshot,
        archiveFormat:
          parsedSnapshot.archiveFormat ?? baseSnapshot.archiveFormat,
        // A legacy task did not durably identify its destination. Recover it
        // conservatively through Chrome Downloads instead of consulting the
        // mutable current setting and unexpectedly writing to an FSA folder.
        destination: parsedSnapshot.destination ?? "downloads-api",
        conflictPolicy:
          parsedSnapshot.conflictPolicy ??
          (parsedSnapshot.destination === "file-system-access"
            ? parsedSnapshot.fsaCollisionPolicy === "overwrite"
              ? "overwrite"
              : "uniquify"
            : parsedSnapshot.overwriteExisting
              ? "overwrite"
              : "uniquify"),
        pathTemplate: parsedSnapshot.pathTemplate ?? baseSnapshot.pathTemplate,
        fileNameTemplate:
          parsedSnapshot.fileNameTemplate ?? baseSnapshot.fileNameTemplate,
        includeComicInfo:
          parsedSnapshot.includeComicInfo ?? baseSnapshot.includeComicInfo,
        includeCoverImage:
          parsedSnapshot.includeCoverImage ?? baseSnapshot.includeCoverImage,
        rateLimitSettings: {
          image: {
            ...baseSnapshot.rateLimitSettings.image,
            ...(parsedSnapshot.rateLimitSettings?.image
              ? parsedSnapshot.rateLimitSettings.image
              : {}),
          },
          chapter: {
            ...baseSnapshot.rateLimitSettings.chapter,
            ...(parsedSnapshot.rateLimitSettings?.chapter
              ? parsedSnapshot.rateLimitSettings.chapter
              : {}),
          },
        },
        retrySettings: {
          image:
            parsedSnapshot.retrySettings?.image ??
            baseSnapshot.retrySettings.image,
          chapter:
            parsedSnapshot.retrySettings?.chapter ??
            baseSnapshot.retrySettings.chapter,
        },
        siteSettings: parsedSnapshot.siteSettings ?? baseSnapshot.siteSettings,
        normalizeImageFilenames:
          parsedSnapshot.normalizeImageFilenames ??
          baseSnapshot.normalizeImageFilenames,
        imagePaddingDigits:
          parsedSnapshot.imagePaddingDigits ?? baseSnapshot.imagePaddingDigits,
        comicInfo: parsedSnapshot.comicInfo
          ? (parsedSnapshot.comicInfo as DownloadTaskState["settingsSnapshot"]["comicInfo"])
          : baseSnapshot.comicInfo,
        siteIntegrationId,
      }
    : baseSnapshot

  const chapters: TaskChapter[] = task.chapters.map((chapter) => {
    return {
      id: chapter.id,
      url: chapter.url,
      title: chapter.title,
      locked: chapter.locked === true,
      index: chapter.index,
      language: chapter.language,
      chapterLabel: chapter.chapterLabel,
      chapterNumber: chapter.chapterNumber,
      volumeId: chapter.volumeId,
      volumeNumber: chapter.volumeNumber,
      volumeLabel: chapter.volumeLabel,
      status: chapter.status,
      errorMessage: chapter.errorMessage,
      errorCategory: normalizeDownloadErrorCategory(chapter.errorCategory),
      totalImages: chapter.totalImages,
      imagesFailed: chapter.imagesFailed,
      outputs: {
        requested: Math.max(0, chapter.outputs?.requested ?? 0),
        committed: Math.max(0, chapter.outputs?.committed ?? 0),
        failed: Math.max(0, chapter.outputs?.failed ?? 0),
      },
      dispatchAttempt: chapter.dispatchAttempt,
      lastUpdated: chapter.lastUpdated,
    }
  })

  const errorCategory = normalizeDownloadErrorCategory(task.errorCategory)

  const lastSuccessfulDownloadId =
    typeof task.lastSuccessfulDownloadId === "number"
      ? task.lastSuccessfulDownloadId
      : undefined

  const normalizedTask = normalizeDownloadTaskExecutionState({
    id: task.id,
    siteIntegrationId,
    mangaId,
    seriesTitle,
    seriesCoverUrl:
      typeof task.seriesCoverUrl === "string" ? task.seriesCoverUrl : undefined,
    chapters,
    status: task.status,
    errorMessage: task.errorMessage,
    errorCategory,
    activeBlock: task.activeBlock,
    browserDownloadWait: task.browserDownloadWait
      ? {
          downloadIds: [...new Set(task.browserDownloadWait.downloadIds)].sort(
            (left, right) => left - right
          ),
          since: task.browserDownloadWait.since,
          lastObservedAt: task.browserDownloadWait.lastObservedAt,
        }
      : undefined,
    destinationOverride: task.destinationOverride,
    created: task.created,
    started: task.started,
    completed: task.completed,
    isRetried: task.isRetried === true,
    isRetryTask: task.isRetryTask === true,
    lastSuccessfulDownloadId,
    nextChapterDispatchAt: task.nextChapterDispatchAt,
    settingsSnapshot,
  })

  if (
    normalizedTask.activeBlock === "provider_network_policy_action_required"
  ) {
    const now = Date.now()
    return normalizeDownloadTaskExecutionState({
      ...normalizedTask,
      status: "failed",
      activeBlock: undefined,
      browserDownloadWait: undefined,
      errorMessage:
        normalizedTask.errorMessage ??
        "Provider access is required before this download can continue",
      errorCategory: normalizedTask.errorCategory ?? "unknown",
      completed: normalizedTask.completed ?? now,
      chapters: normalizedTask.chapters.map((chapter) =>
        chapter.status === "queued" || chapter.status === "downloading"
          ? {
              ...chapter,
              status: "failed",
              errorMessage:
                chapter.errorMessage ??
                "Provider access is required before this download can continue",
              errorCategory: chapter.errorCategory ?? "unknown",
              lastUpdated: now,
            }
          : chapter
      ),
    })
  }

  return normalizedTask
}
