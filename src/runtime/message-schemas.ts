import { z } from "zod"
import {
  ArchiveFormatSchema,
  ConflictPolicySchema,
  DownloadErrorCategorySchema,
  DownloadProgressStatusSchema,
} from "@/src/shared/download-contract"
import { StateActionSchema } from "@/src/runtime/state-action-schemas"
import { RATE_POLICY_LIMITS } from "@/src/shared/rate-policy-limits"

/**
 * Shared error response shape — every response is either
 * `{ success: true, ...data }` or `{ success: false, error: string }`.
 */
const ErrorResponseSchema = z.strictObject({
  success: z.literal(false),
  error: z.string(),
})

const CommandEnvelopeShape = {
  commandId: z.string().uuid(),
  issuedAt: z.number().finite().nonnegative(),
} as const

/**
 * Response schema for FETCH_SERIES_DATA.
 *
 * Validated on the content-script side before seriesMetadata / chapterList
 * are consumed. `chapterList` is intentionally `z.unknown()` — it is
 * normalized via `normalizeFetchedSeriesData` which has its own guards.
 */
export const FetchSeriesDataResponseSchema = z.union([
  z.object({
    success: z.literal(true),
    seriesId: z.string().min(1).optional(),
    seriesMetadata: z.unknown().optional(),
    chapterList: z.unknown().optional(),
    metadataError: z.string().optional(),
    chapterListError: z.string().optional(),
    chapterListNotice: z.literal("adult-consent-required").optional(),
  }),
  ErrorResponseSchema,
])

const ChapterPayloadSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  url: z.string().url(),
  index: z.number().int().positive(),
  chapterLabel: z.string().min(1).optional(),
  chapterNumber: z.number().optional(),
  volumeId: z.string().min(1).optional(),
  volumeLabel: z.string().min(1).optional(),
  volumeNumber: z.number().optional(),
  language: z.string().min(1).optional(),
})

const StartDownloadPayloadSchema = z.strictObject({
  sourceTabId: z.number().int().nonnegative().optional(),
  siteIntegrationId: z.string().min(1),
  mangaId: z.string().min(1),
  seriesTitle: z.string().min(1),
  chapters: z.array(ChapterPayloadSchema).min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

const BlobUrlSchema = z
  .string()
  .min(1)
  .refine((value) => value.startsWith("blob:"), {
    message: "Expected blob URL",
  })

export const OffscreenJobStageSchema = z.enum([
  "dispatching",
  "accepted",
  "resolving",
  "downloading",
  "transforming",
  "archiving",
  "saving",
])

const MangadexPreferencesPayloadSchema = z.strictObject({
  dataSaver: z.boolean(),
  filteredLanguages: z.array(z.string().min(1)),
  showSafe: z.boolean().optional(),
  showSuggestive: z.boolean().optional(),
  showErotic: z.boolean().optional(),
  showHentai: z.boolean().optional(),
})

const FetchSeriesDataPayloadSchema = z
  .strictObject({
    siteIntegrationId: z.string().min(1),
    seriesId: z.string().min(1).optional(),
    seriesUrl: z.string().url().optional(),
    language: z.string().min(1).optional(),
    mangadexPreferences: MangadexPreferencesPayloadSchema.optional(),
  })
  .superRefine((payload, context) => {
    if (
      payload.mangadexPreferences !== undefined &&
      payload.siteIntegrationId !== "mangadex"
    ) {
      context.addIssue({
        code: "custom",
        path: ["mangadexPreferences"],
        message: "MangaDex preferences are only valid for MangaDex requests",
      })
    }

    if (payload.seriesId === undefined && payload.seriesUrl === undefined) {
      context.addIssue({
        code: "custom",
        path: ["seriesId"],
        message: "Either seriesId or seriesUrl must be provided",
      })
    }
  })

export const ActionMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("REQUEST_TAB_CONTEXT_REFRESH"),
    payload: z
      .strictObject({
        tabId: z.number().int().nonnegative().optional(),
        windowId: z.number().int().nonnegative().optional(),
        reason: z.enum(["sidepanel-mount"]).optional(),
      })
      .default({}),
  }),
  z.object({
    type: z.literal("GET_SETTINGS"),
  }),
  z.object({
    type: z.literal("GET_SITE_INTEGRATION_ENABLEMENT"),
  }),
  z.object({
    type: z.literal("FETCH_SERIES_DATA"),
    payload: FetchSeriesDataPayloadSchema,
  }),
  z.object({
    type: z.literal("SYNC_SETTINGS_TO_STATE"),
    ...CommandEnvelopeShape,
    payload: z.object({
      settings: z.record(z.string(), z.unknown()),
    }),
  }),
  z.strictObject({
    type: z.literal("STATE_ACTION"),
    ...CommandEnvelopeShape,
    action: StateActionSchema,
    payload: z.unknown().optional(),
    tabId: z.number().int().nonnegative().optional(),
    windowId: z.number().int().optional(),
    requestId: z.number().int().optional(),
    timestamp: z.number().optional(),
  }),
  z.object({
    type: z.literal("START_DOWNLOAD"),
    ...CommandEnvelopeShape,
    payload: StartDownloadPayloadSchema,
  }),
  z.object({
    type: z.literal("RETRY_FAILED_CHAPTERS"),
    ...CommandEnvelopeShape,
    payload: z.strictObject({ taskId: z.string().min(1) }),
  }),
  z.object({
    type: z.literal("RESTART_TASK"),
    ...CommandEnvelopeShape,
    payload: z.object({ taskId: z.string().min(1) }),
  }),
  z.object({
    type: z.literal("MOVE_TASK_TO_TOP"),
    ...CommandEnvelopeShape,
    payload: z.object({ taskId: z.string().min(1) }),
  }),
  z.object({
    type: z.literal("CLEAR_ALL_HISTORY"),
    ...CommandEnvelopeShape,
    payload: z.object({}).default({}),
  }),
  z.strictObject({
    type: z.literal("CLEAR_PERSISTED_DOWNLOAD_HISTORY"),
    ...CommandEnvelopeShape,
    payload: z.discriminatedUnion("scope", [
      z.strictObject({ scope: z.literal("all") }),
      z.strictObject({
        scope: z.literal("series"),
        siteIntegrationId: z.string().min(1),
        seriesId: z.string().min(1),
      }),
    ]),
  }),
  z.object({
    type: z.literal("ACKNOWLEDGE_ERROR"),
    ...CommandEnvelopeShape,
    payload: z.object({ code: z.string().min(1) }),
  }),
  z.object({
    type: z.literal("OPEN_OPTIONS"),
    payload: z
      .object({
        page: z
          .enum(["global", "integrations", "downloads", "debug"])
          .optional(),
      })
      .default({}),
  }),
])

/**
 * Schema for OFFSCREEN_DOWNLOAD_CHAPTER payload.
 *
 * Exported separately so the Zod-inferred type is the single source of truth
 * for this payload shape — consumers import `OffscreenDownloadChapterPayload`
 * instead of maintaining a parallel hand-written interface that can drift.
 *
 * `settingsSnapshot` and `book.metadata` are validated as `Record<string, unknown>`
 * (the wire format). Downstream code narrows them to specific types via
 * `readProcessDownloadChapterSettingsSnapshot` and similar helpers.
 */
const RateLimitSnapshotSchema = z.strictObject({
  concurrency: z
    .number()
    .int()
    .min(RATE_POLICY_LIMITS.MIN_CONCURRENCY)
    .max(RATE_POLICY_LIMITS.MAX_CONCURRENCY),
  delayMs: z
    .number()
    .finite()
    .min(RATE_POLICY_LIMITS.MIN_DELAY_MS)
    .max(RATE_POLICY_LIMITS.MAX_DELAY_MS),
})

export const OffscreenChapterSettingsSnapshotSchema = z.object({
  archiveFormat: ArchiveFormatSchema,
  conflictPolicy: ConflictPolicySchema,
  includeComicInfo: z.boolean(),
  includeCoverImage: z.boolean(),
  rateLimitSettings: z.strictObject({
    image: RateLimitSnapshotSchema,
    chapter: RateLimitSnapshotSchema,
  }),
  retrySettings: z.strictObject({
    image: z.number().int().nonnegative(),
    chapter: z.number().int().nonnegative(),
  }),
})

export const OffscreenDownloadChapterMessageSchema = z.object({
  type: z.literal("OFFSCREEN_DOWNLOAD_CHAPTER"),
  payload: z.strictObject({
    jobId: z.string().min(1),
    attempt: z.number().int().nonnegative(),
    taskId: z.string().min(1),
    seriesKey: z.string().min(1),
    book: z.object({
      siteIntegrationId: z.string().min(1),
      seriesTitle: z.string().min(1),
      coverUrl: z.string().url().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    }),
    chapter: z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      url: z.string().url(),
      index: z.number().int().positive(),
      chapterLabel: z.string().optional(),
      chapterNumber: z.number().optional(),
      volumeId: z.string().optional(),
      volumeNumber: z.number().optional(),
      volumeLabel: z.string().optional(),
      language: z.string().optional(),
      resolvedPath: z.string().min(1),
    }),
    settingsSnapshot: OffscreenChapterSettingsSnapshotSchema,
    saveMode: z.enum(["fsa", "downloads-api"]),
    notBefore: z.number().nonnegative().optional(),
    integrationContext: z.record(z.string(), z.unknown()).optional(),
  }),
})

/**
 * Zod-inferred payload type for OFFSCREEN_DOWNLOAD_CHAPTER.
 * This is the authoritative type — the hand-written `OffscreenDownloadChapterMessage`
 * interface in `src/types/offscreen-messages.ts` re-exports this to stay aligned.
 */
export type OffscreenDownloadChapterPayload = z.infer<
  typeof OffscreenDownloadChapterMessageSchema
>["payload"]

export const OffscreenParseSeriesHtmlMessageSchema = z.strictObject({
  type: z.literal("OFFSCREEN_PARSE_SERIES_HTML"),
  payload: z.strictObject({
    siteIntegrationId: z.string().min(1),
    seriesUrl: z.string().url(),
    html: z.string().min(1),
    language: z.string().min(1).optional(),
  }),
})

export type OffscreenParseSeriesHtmlPayload = z.infer<
  typeof OffscreenParseSeriesHtmlMessageSchema
>["payload"]

export const OffscreenMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("OFFSCREEN_STATUS"),
  }),
  z.object({
    type: z.literal("OFFSCREEN_CONTROL"),
    payload: z.object({
      taskId: z.string().min(1),
      action: z.literal("cancel"),
    }),
  }),
  z.strictObject({
    type: z.literal("OFFSCREEN_QUERY_JOB"),
    payload: z.strictObject({ requestId: z.string().min(1) }),
  }),
  z.strictObject({
    type: z.literal("OFFSCREEN_CANCEL_JOB"),
    payload: z.strictObject({
      jobId: z.string().min(1),
      attempt: z.number().int().nonnegative(),
      taskId: z.string().min(1),
      chapterId: z.string().min(1),
    }),
  }),
  z.strictObject({
    type: z.literal("OFFSCREEN_JOB_ACCEPTED"),
    payload: z.strictObject({
      jobId: z.string().min(1),
      attempt: z.number().int().nonnegative(),
      taskId: z.string().min(1),
      chapterId: z.string().min(1),
      acceptedAt: z.number(),
      sequence: z.number().int().nonnegative(),
    }),
  }),
  z.strictObject({
    type: z.literal("OFFSCREEN_JOB_HEARTBEAT"),
    payload: z.strictObject({
      jobId: z.string().min(1),
      attempt: z.number().int().nonnegative(),
      taskId: z.string().min(1),
      chapterId: z.string().min(1),
      stage: OffscreenJobStageSchema,
      sequence: z.number().int().nonnegative(),
      sentAt: z.number(),
    }),
  }),
  z.object({
    type: z.literal("REVOKE_BLOB_URL"),
    payload: z.strictObject({
      jobId: z.string().min(1),
      attempt: z.number().int().nonnegative(),
      outputId: z.string().min(1),
      blobUrl: BlobUrlSchema,
    }),
  }),
  OffscreenDownloadChapterMessageSchema,
  OffscreenParseSeriesHtmlMessageSchema,
  z.object({
    type: z.literal("OFFSCREEN_OUTPUT_READY"),
    payload: z.strictObject({
      jobId: z.string().min(1),
      attempt: z.number().int().nonnegative(),
      outputId: z.string().min(1),
      taskId: z.string().min(1),
      chapterId: z.string().min(1),
      fileUrl: BlobUrlSchema,
      filename: z.string().min(1),
      outputIndex: z.number().int().nonnegative(),
      outputCount: z.number().int().positive(),
      outputKind: z.enum(["archive", "image"]),
    }),
  }),
  z.object({
    type: z.literal("OFFSCREEN_DOWNLOAD_PROGRESS"),
    payload: z.strictObject({
      jobId: z.string().min(1),
      attempt: z.number().int().nonnegative(),
      taskId: z.string().min(1),
      chapterId: z.string().min(1),
      sequence: z.number().int().nonnegative(),
      stage: OffscreenJobStageSchema,
      phaseFraction: z.number().finite().min(0).max(1).optional(),
      status: DownloadProgressStatusSchema,
      chapterTitle: z.string().min(1).optional(),
      imagesProcessed: z.number().int().min(0).optional(),
      imagesFailed: z.number().int().min(0).optional(),
      totalImages: z.number().int().min(0).optional(),
      outputsRequested: z.number().int().min(0).optional(),
      outputsFailedBeforeHandoff: z.number().int().min(0).optional(),
      outputsCommitted: z.number().int().min(0).optional(),
      error: z.string().optional(),
      errorCategory: DownloadErrorCategorySchema.optional(),
    }),
  }),
])

export const RuntimeMessageSchema = z.union([
  ActionMessageSchema,
  OffscreenMessageSchema,
])

export type ActionMessage = z.infer<typeof ActionMessageSchema>
export type OffscreenMessage = z.infer<typeof OffscreenMessageSchema>
export type RuntimeMessage = z.infer<typeof RuntimeMessageSchema>
