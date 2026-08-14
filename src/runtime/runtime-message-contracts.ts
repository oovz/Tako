import { z } from "zod"

import {
  ArchiveFormatSchema,
  ConflictPolicySchema,
  DownloadDestinationSchema,
  DownloadErrorCategorySchema,
  DownloadProgressStatusSchema,
  ImagePaddingDigitsSchema,
} from "@/src/shared/download-contract"
import { RATE_POLICY_LIMITS } from "@/src/shared/rate-policy-limits"
import {
  BlobUrlIdentitySchema,
  BlobUrlSchema,
  OffscreenJobFingerprintSchema,
  OffscreenJobIncarnationSchema,
  OffscreenJobOutcomeSchema,
  OffscreenJobStageSchema,
  OffscreenJobStateSchema,
} from "@/src/runtime/offscreen-job-contracts"
import {
  SeriesChapterListSchema,
  SeriesMetadataSchema,
  SeriesMetadataSnapshotSchema,
} from "@/src/runtime/series-data-schemas"
import { DestinationIssueSchema } from "@/src/runtime/destination-issue-state"
import { DownloadTaskStateSchema } from "@/src/runtime/queue-state-schemas"
import { DownloadedChapterRecordSchema } from "@/src/domain/history/schema"
import { ExtensionSettingsSchema } from "@/src/domain/settings/schema"
import type { ExtensionSettings } from "@/src/domain/settings/types"
import {
  SiteOverridesMapSchema,
  SiteIntegrationEnablementMapSchema,
  SiteIntegrationSettingsMapSchema,
} from "@/src/domain/site-integrations/storage-schemas"
import { PersistentErrorsSchema } from "@/src/runtime/persistent-error-schema"
import { StartDownloadFailureCodeSchema } from "@/src/runtime/start-download-errors"

export type RuntimeMessageTarget = "background" | "offscreen"
export type RuntimeMessageKind = "command" | "query" | "event"
export type RuntimeMessageReadiness =
  "control-ready" | "queue-hydrated" | "integrations-ready" | "runtime-ready"
export type RuntimeAllowedSender =
  "sidepanel" | "options" | "offscreen" | "background"
export type RuntimeMessagePrincipal =
  RuntimeAllowedSender | "content" | "unknown"

export const OffscreenInitializationStateSchema = z.enum([
  "initializing",
  "ready",
  "failed",
])
export type OffscreenInitializationState = z.infer<
  typeof OffscreenInitializationStateSchema
>

const RuntimeFailureSchema = z.strictObject({
  success: z.literal(false),
  error: z.string().min(1),
})

export const OptionsDownloadStateSchema = z.strictObject({
  tasks: z.array(DownloadTaskStateSchema),
  destinationIssue: DestinationIssueSchema.nullable(),
  queueStorageBytes: z.number().int().nonnegative(),
})

export const SidepanelDownloadStateSchema = z.strictObject({
  downloadedChapters: z.array(DownloadedChapterRecordSchema),
  destinationIssue: DestinationIssueSchema.nullable(),
})

export const OptionsConfigurationSnapshotSchema = z.strictObject({
  settings: z.custom<ExtensionSettings>(
    (value) => ExtensionSettingsSchema.safeParse(value).success,
    { message: "Invalid extension settings" }
  ),
  overrides: SiteOverridesMapSchema,
  enablement: SiteIntegrationEnablementMapSchema,
  integrationSettings: SiteIntegrationSettingsMapSchema,
})

export const OptionsHistorySeriesSchema = z.strictObject({
  siteIntegrationId: z.string().min(1),
  seriesId: z.string().min(1),
  seriesTitle: z.string().min(1),
  chapterCount: z.number().int().nonnegative(),
})

export const OptionsHistoryStatsSchema = z.strictObject({
  totalChapters: z.number().int().nonnegative(),
  totalSeries: z.number().int().nonnegative(),
})

export const OptionsConfigurationDataSchema = z.strictObject({
  configuration: OptionsConfigurationSnapshotSchema,
  historyStats: OptionsHistoryStatsSchema,
  historySeries: z.array(OptionsHistorySeriesSchema),
})

export const UiPreferencesSchema = ExtensionSettingsSchema.pick({
  motionPreference: true,
  uiLanguage: true,
})

export type OptionsConfigurationSnapshot = z.infer<
  typeof OptionsConfigurationSnapshotSchema
>
export type OptionsConfigurationData = z.infer<
  typeof OptionsConfigurationDataSchema
>
export type UiPreferences = z.infer<typeof UiPreferencesSchema>

export type OptionsDownloadState = z.infer<typeof OptionsDownloadStateSchema>
export type SidepanelDownloadState = z.infer<
  typeof SidepanelDownloadStateSchema
>

const SuccessSchema = z.strictObject({ success: z.literal(true) })

const CommandEnvelopeShape = {
  commandId: z.string().uuid(),
  issuedAt: z.number().finite().nonnegative(),
} as const

const PendingUndoReceiptSchema = z.strictObject({
  token: z.string().min(1),
  type: z.enum(["cancel_queued", "remove_history"]),
  expiresAt: z.number().finite().nonnegative(),
})

const StartDownloadPayloadSchema = z.strictObject({
  sourceWindowId: z.number().int().nonnegative(),
  sourceTabId: z.number().int().nonnegative(),
  sourceUrl: z.string().min(1),
  siteIntegrationId: z.string().min(1),
  seriesId: z.string().min(1),
  seriesRevision: z.number().int().nonnegative(),
  selectedChapterIds: z.array(z.string().min(1)).min(1),
})

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

export const OffscreenChapterSettingsSnapshotSchema = z.strictObject({
  archiveFormat: ArchiveFormatSchema,
  destination: DownloadDestinationSchema,
  conflictPolicy: ConflictPolicySchema,
  pathTemplate: z.string(),
  fileNameTemplate: z.string().min(1),
  includeComicInfo: z.boolean(),
  includeCoverImage: z.boolean(),
  siteSettings: z.record(z.string(), z.unknown()),
  rateLimitSettings: z.strictObject({
    image: RateLimitSnapshotSchema,
    chapter: RateLimitSnapshotSchema,
  }),
  retrySettings: z.strictObject({
    image: z.number().int().nonnegative(),
    chapter: z.number().int().nonnegative(),
  }),
  normalizeImageFilenames: z.boolean(),
  imagePaddingDigits: ImagePaddingDigitsSchema,
  comicInfo: SeriesMetadataSnapshotSchema.optional(),
  siteIntegrationId: z.string().min(1),
})

const OffscreenDownloadChapterPayloadSchema = z.strictObject({
  jobId: z.string().min(1),
  attempt: z.number().int().nonnegative(),
  taskId: z.string().min(1),
  fingerprint: OffscreenJobFingerprintSchema,
  seriesKey: z.string().min(1),
  book: z.strictObject({
    siteIntegrationId: z.string().min(1),
    seriesTitle: z.string().min(1),
    coverUrl: z.string().url().optional(),
    metadata: SeriesMetadataSnapshotSchema.optional(),
  }),
  chapter: z.strictObject({
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
  notBefore: z.number().finite().nonnegative().optional(),
  integrationContext: z
    .strictObject({
      schemaVersion: z.number().int().positive(),
      data: z.record(z.string(), z.json()),
    })
    .optional(),
})

const OffscreenParseSeriesHtmlPayloadSchema = z.strictObject({
  requestId: z.string().uuid(),
  siteIntegrationId: z.string().min(1),
  seriesUrl: z.string().url(),
  html: z.string().min(1),
  language: z.string().min(1).optional(),
  rateLimitSettings: z.strictObject({
    image: RateLimitSnapshotSchema,
    chapter: RateLimitSnapshotSchema,
  }),
})

const OffscreenDownloadProgressPayloadSchema = z
  .strictObject({
    ...OffscreenJobIncarnationSchema.shape,
    sequence: z.number().int().nonnegative(),
    stage: OffscreenJobStageSchema,
    phaseFraction: z.number().finite().min(0).max(1).optional(),
    status: DownloadProgressStatusSchema,
    chapterTitle: z.string().min(1).optional(),
    imagesProcessed: z.number().int().nonnegative().optional(),
    imagesFailed: z.number().int().nonnegative().optional(),
    totalImages: z.number().int().nonnegative().optional(),
    outputsRequested: z.number().int().nonnegative(),
    outputsFailedBeforeHandoff: z.number().int().nonnegative(),
    outputsCommitted: z.number().int().nonnegative(),
    error: z.string().optional(),
    errorCategory: DownloadErrorCategorySchema.optional(),
  })
  .superRefine((value, context) => {
    if (value.outputsFailedBeforeHandoff > value.outputsRequested) {
      context.addIssue({
        code: "custom",
        path: ["outputsFailedBeforeHandoff"],
        message: "failed-before-handoff cannot exceed requested outputs",
      })
    }
    if (value.outputsCommitted > value.outputsRequested) {
      context.addIssue({
        code: "custom",
        path: ["outputsCommitted"],
        message: "committed outputs cannot exceed requested outputs",
      })
    }
  })

const OffscreenDownloadChapterSuccessSchema = z.strictObject({
  success: z.literal(true),
  accepted: z.literal(true),
  ...OffscreenJobIncarnationSchema.shape,
})

const OffscreenRenewalSuccessSchema = z.strictObject({
  success: z.literal(true),
  disposition: z.enum([
    "renewed",
    "stale_or_reordered",
    "lease_not_current",
    "protocol_error",
  ]),
})

const OffscreenRenewalResponseSchema = z.union([
  OffscreenRenewalSuccessSchema,
  RuntimeFailureSchema,
])

const OffscreenParseSeriesHtmlSuccessSchema = z.strictObject({
  success: z.literal(true),
  seriesMetadata: SeriesMetadataSchema.optional(),
  chapterList: SeriesChapterListSchema.optional(),
  metadataError: z.string().optional(),
  chapterListError: z.string().optional(),
  chapterListNotice: z.literal("adult-consent-required").optional(),
})

type RegistryEntry = {
  request: z.ZodType
  response: z.ZodType
  target: RuntimeMessageTarget
  kind: RuntimeMessageKind
  allowedSenders: readonly RuntimeAllowedSender[]
  readiness: RuntimeMessageReadiness
}

function defineRuntimeMessage<const TEntry extends RegistryEntry>(
  entry: TEntry
): TEntry {
  return entry
}

const successOrFailure = () => z.union([SuccessSchema, RuntimeFailureSchema])

export const runtimeMessageRegistry = {
  REQUEST_TAB_CONTEXT_REFRESH: defineRuntimeMessage({
    request: z.strictObject({
      target: z.literal("background"),
      type: z.literal("REQUEST_TAB_CONTEXT_REFRESH"),
      payload: z.strictObject({
        tabId: z.number().int().nonnegative().optional(),
        windowId: z.number().int().nonnegative().optional(),
        reason: z.literal("sidepanel-mount").optional(),
      }),
    }),
    response: successOrFailure(),
    target: "background",
    kind: "command",
    allowedSenders: ["sidepanel"],
    readiness: "integrations-ready",
  }),
  GET_SITE_INTEGRATION_ENABLEMENT: defineRuntimeMessage({
    request: z.strictObject({
      target: z.literal("background"),
      type: z.literal("GET_SITE_INTEGRATION_ENABLEMENT"),
    }),
    response: z.union([
      z.strictObject({
        success: z.literal(true),
        enablement: z.record(z.string(), z.boolean()),
      }),
      RuntimeFailureSchema,
    ]),
    target: "background",
    kind: "query",
    allowedSenders: ["offscreen"],
    readiness: "control-ready",
  }),
  GET_OPTIONS_DOWNLOAD_STATE: defineRuntimeMessage({
    request: z.strictObject({
      target: z.literal("background"),
      type: z.literal("GET_OPTIONS_DOWNLOAD_STATE"),
    }),
    response: z.union([
      z.strictObject({
        success: z.literal(true),
        data: OptionsDownloadStateSchema,
      }),
      RuntimeFailureSchema,
    ]),
    target: "background",
    kind: "query",
    allowedSenders: ["options"],
    readiness: "runtime-ready",
  }),
  GET_OPTIONS_CONFIGURATION: defineRuntimeMessage({
    request: z.strictObject({
      target: z.literal("background"),
      type: z.literal("GET_OPTIONS_CONFIGURATION"),
    }),
    response: z.union([
      z.strictObject({
        success: z.literal(true),
        data: OptionsConfigurationDataSchema,
      }),
      RuntimeFailureSchema,
    ]),
    target: "background",
    kind: "query",
    allowedSenders: ["options"],
    readiness: "runtime-ready",
  }),
  SAVE_OPTIONS_CONFIGURATION: defineRuntimeMessage({
    request: z.strictObject({
      target: z.literal("background"),
      type: z.literal("SAVE_OPTIONS_CONFIGURATION"),
      ...CommandEnvelopeShape,
      payload: z.strictObject({
        configuration: OptionsConfigurationSnapshotSchema,
      }),
    }),
    response: z.union([
      z.strictObject({
        success: z.literal(true),
        data: OptionsConfigurationSnapshotSchema,
      }),
      RuntimeFailureSchema,
    ]),
    target: "background",
    kind: "command",
    allowedSenders: ["options"],
    readiness: "runtime-ready",
  }),
  GET_UI_PREFERENCES: defineRuntimeMessage({
    request: z.strictObject({
      target: z.literal("background"),
      type: z.literal("GET_UI_PREFERENCES"),
    }),
    response: z.union([
      z.strictObject({
        success: z.literal(true),
        data: UiPreferencesSchema,
      }),
      RuntimeFailureSchema,
    ]),
    target: "background",
    kind: "query",
    allowedSenders: ["sidepanel", "options"],
    readiness: "runtime-ready",
  }),
  GET_PERSISTENT_ERRORS: defineRuntimeMessage({
    request: z.strictObject({
      target: z.literal("background"),
      type: z.literal("GET_PERSISTENT_ERRORS"),
    }),
    response: z.union([
      z.strictObject({
        success: z.literal(true),
        data: PersistentErrorsSchema,
      }),
      RuntimeFailureSchema,
    ]),
    target: "background",
    kind: "query",
    allowedSenders: ["sidepanel"],
    readiness: "control-ready",
  }),
  GET_SIDEPANEL_DOWNLOAD_STATE: defineRuntimeMessage({
    request: z.strictObject({
      target: z.literal("background"),
      type: z.literal("GET_SIDEPANEL_DOWNLOAD_STATE"),
    }),
    response: z.union([
      z.strictObject({
        success: z.literal(true),
        data: SidepanelDownloadStateSchema,
      }),
      RuntimeFailureSchema,
    ]),
    target: "background",
    kind: "query",
    allowedSenders: ["sidepanel"],
    readiness: "runtime-ready",
  }),
  START_DOWNLOAD: defineRuntimeMessage({
    request: z.strictObject({
      target: z.literal("background"),
      type: z.literal("START_DOWNLOAD"),
      ...CommandEnvelopeShape,
      payload: StartDownloadPayloadSchema,
    }),
    response: z.union([
      z.strictObject({ success: z.literal(true), taskId: z.string().min(1) }),
      z.strictObject({
        success: z.literal(false),
        error: z.string().min(1),
        code: StartDownloadFailureCodeSchema,
      }),
    ]),
    target: "background",
    kind: "command",
    allowedSenders: ["sidepanel"],
    readiness: "runtime-ready",
  }),
  RETRY_FAILED_CHAPTERS: defineRuntimeMessage({
    request: z.strictObject({
      target: z.literal("background"),
      type: z.literal("RETRY_FAILED_CHAPTERS"),
      ...CommandEnvelopeShape,
      payload: z.strictObject({ taskId: z.string().min(1) }),
    }),
    response: successOrFailure(),
    target: "background",
    kind: "command",
    allowedSenders: ["sidepanel", "options"],
    readiness: "runtime-ready",
  }),
  RESTART_TASK: defineRuntimeMessage({
    request: z.strictObject({
      target: z.literal("background"),
      type: z.literal("RESTART_TASK"),
      ...CommandEnvelopeShape,
      payload: z.strictObject({ taskId: z.string().min(1) }),
    }),
    response: successOrFailure(),
    target: "background",
    kind: "command",
    allowedSenders: ["sidepanel", "options"],
    readiness: "runtime-ready",
  }),
  MOVE_TASK_TO_TOP: defineRuntimeMessage({
    request: z.strictObject({
      target: z.literal("background"),
      type: z.literal("MOVE_TASK_TO_TOP"),
      ...CommandEnvelopeShape,
      payload: z.strictObject({ taskId: z.string().min(1) }),
    }),
    response: successOrFailure(),
    target: "background",
    kind: "command",
    allowedSenders: ["sidepanel"],
    readiness: "runtime-ready",
  }),
  CLEAR_ALL_HISTORY: defineRuntimeMessage({
    request: z.strictObject({
      target: z.literal("background"),
      type: z.literal("CLEAR_ALL_HISTORY"),
      ...CommandEnvelopeShape,
      payload: z.strictObject({}),
    }),
    response: successOrFailure(),
    target: "background",
    kind: "command",
    allowedSenders: ["options"],
    readiness: "runtime-ready",
  }),
  REMOVE_TASK: defineRuntimeMessage({
    request: z.strictObject({
      target: z.literal("background"),
      type: z.literal("REMOVE_TASK"),
      ...CommandEnvelopeShape,
      payload: z.strictObject({ taskId: z.string().min(1) }),
    }),
    response: z.union([
      SuccessSchema,
      z.strictObject({
        success: z.literal(true),
        data: z.strictObject({ undo: PendingUndoReceiptSchema }),
      }),
      RuntimeFailureSchema,
    ]),
    target: "background",
    kind: "command",
    allowedSenders: ["sidepanel", "options"],
    readiness: "runtime-ready",
  }),
  CANCEL_TASK: defineRuntimeMessage({
    request: z.strictObject({
      target: z.literal("background"),
      type: z.literal("CANCEL_TASK"),
      ...CommandEnvelopeShape,
      payload: z.strictObject({ taskId: z.string().min(1) }),
    }),
    response: z.union([
      SuccessSchema,
      z.strictObject({
        success: z.literal(true),
        data: z.strictObject({ undo: PendingUndoReceiptSchema }),
      }),
      RuntimeFailureSchema,
    ]),
    target: "background",
    kind: "command",
    allowedSenders: ["sidepanel", "options"],
    readiness: "runtime-ready",
  }),
  FORGET_UNOBSERVABLE_OUTPUTS: defineRuntimeMessage({
    request: z.strictObject({
      target: z.literal("background"),
      type: z.literal("FORGET_UNOBSERVABLE_OUTPUTS"),
      ...CommandEnvelopeShape,
      payload: z.strictObject({ taskId: z.string().min(1) }),
    }),
    response: z.union([
      z.strictObject({
        success: z.literal(true),
        surrendered: z.number().int().nonnegative(),
      }),
      RuntimeFailureSchema,
    ]),
    target: "background",
    kind: "command",
    allowedSenders: ["sidepanel", "options"],
    readiness: "runtime-ready",
  }),
  RETRY_DESTINATION: defineRuntimeMessage({
    request: z.strictObject({
      target: z.literal("background"),
      type: z.literal("RETRY_DESTINATION"),
      ...CommandEnvelopeShape,
      payload: z.strictObject({ taskId: z.string().min(1) }),
    }),
    response: successOrFailure(),
    target: "background",
    kind: "command",
    allowedSenders: ["options"],
    readiness: "runtime-ready",
  }),
  CONTINUE_DOWNLOAD: defineRuntimeMessage({
    request: z.strictObject({
      target: z.literal("background"),
      type: z.literal("CONTINUE_DOWNLOAD"),
      ...CommandEnvelopeShape,
      payload: z.strictObject({ taskId: z.string().min(1) }),
    }),
    response: successOrFailure(),
    target: "background",
    kind: "command",
    allowedSenders: ["sidepanel", "options"],
    readiness: "runtime-ready",
  }),
  UNDO_QUEUE_ACTION: defineRuntimeMessage({
    request: z.strictObject({
      target: z.literal("background"),
      type: z.literal("UNDO_QUEUE_ACTION"),
      ...CommandEnvelopeShape,
      payload: z.strictObject({ token: z.string().min(1) }),
    }),
    response: successOrFailure(),
    target: "background",
    kind: "command",
    allowedSenders: ["sidepanel", "options"],
    readiness: "runtime-ready",
  }),
  CLEAR_PERSISTED_DOWNLOAD_HISTORY: defineRuntimeMessage({
    request: z.strictObject({
      target: z.literal("background"),
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
    response: successOrFailure(),
    target: "background",
    kind: "command",
    allowedSenders: ["options"],
    readiness: "runtime-ready",
  }),
  ACKNOWLEDGE_ERROR: defineRuntimeMessage({
    request: z.strictObject({
      target: z.literal("background"),
      type: z.literal("ACKNOWLEDGE_ERROR"),
      ...CommandEnvelopeShape,
      payload: z.strictObject({ code: z.string().min(1) }),
    }),
    response: successOrFailure(),
    target: "background",
    kind: "command",
    allowedSenders: ["sidepanel"],
    readiness: "control-ready",
  }),
  OPEN_OPTIONS: defineRuntimeMessage({
    request: z.strictObject({
      target: z.literal("background"),
      type: z.literal("OPEN_OPTIONS"),
      payload: z.strictObject({
        page: z
          .enum(["global", "integrations", "downloads", "debug"])
          .optional(),
      }),
    }),
    response: successOrFailure(),
    target: "background",
    kind: "command",
    allowedSenders: ["sidepanel"],
    readiness: "control-ready",
  }),
  OFFSCREEN_JOB_ACCEPTED: defineRuntimeMessage({
    request: z.strictObject({
      target: z.literal("background"),
      type: z.literal("OFFSCREEN_JOB_ACCEPTED"),
      payload: OffscreenJobIncarnationSchema.extend({
        acceptedAt: z.number().finite().nonnegative(),
        sequence: z.number().int().nonnegative(),
      }),
    }),
    response: OffscreenRenewalResponseSchema,
    target: "background",
    kind: "event",
    allowedSenders: ["offscreen"],
    readiness: "queue-hydrated",
  }),
  OFFSCREEN_JOB_HEARTBEAT: defineRuntimeMessage({
    request: z.strictObject({
      target: z.literal("background"),
      type: z.literal("OFFSCREEN_JOB_HEARTBEAT"),
      payload: OffscreenJobIncarnationSchema.extend({
        stage: OffscreenJobStageSchema,
        sequence: z.number().int().nonnegative(),
        sentAt: z.number().finite().nonnegative(),
      }),
    }),
    response: OffscreenRenewalResponseSchema,
    target: "background",
    kind: "event",
    allowedSenders: ["offscreen"],
    readiness: "queue-hydrated",
  }),
  OFFSCREEN_OUTPUT_READY: defineRuntimeMessage({
    request: z.strictObject({
      target: z.literal("background"),
      type: z.literal("OFFSCREEN_OUTPUT_READY"),
      payload: z
        .strictObject({
          ...OffscreenJobIncarnationSchema.shape,
          outputId: z.string().min(1),
          fileUrl: BlobUrlSchema,
          filename: z.string().min(1),
          outputIndex: z.number().int().nonnegative(),
          outputCount: z.number().int().positive(),
          outputKind: z.enum(["archive", "image"]),
        })
        .superRefine((value, context) => {
          if (value.outputIndex >= value.outputCount) {
            context.addIssue({
              code: "custom",
              path: ["outputIndex"],
              message: "output index must be in range",
            })
          }
        }),
    }),
    response: z.union([
      z.strictObject({
        success: z.literal(true),
        disposition: z.literal("tracked"),
        phase: z.enum([
          "prepared",
          "acceptance_unknown",
          "waiting",
          "complete",
          "interrupted",
          "surrendered",
        ]),
        terminalOutcome: z.enum(["complete", "interrupted"]).optional(),
      }),
      z.strictObject({
        success: z.literal(true),
        disposition: z.literal("not_persisted"),
        reason: z.string().min(1),
      }),
      RuntimeFailureSchema,
    ]),
    target: "background",
    kind: "event",
    allowedSenders: ["offscreen"],
    readiness: "runtime-ready",
  }),
  OFFSCREEN_DOWNLOAD_PROGRESS: defineRuntimeMessage({
    request: z.strictObject({
      target: z.literal("background"),
      type: z.literal("OFFSCREEN_DOWNLOAD_PROGRESS"),
      payload: OffscreenDownloadProgressPayloadSchema,
    }),
    response: OffscreenRenewalResponseSchema,
    target: "background",
    kind: "event",
    allowedSenders: ["offscreen"],
    readiness: "runtime-ready",
  }),
  OFFSCREEN_JOB_TERMINAL: defineRuntimeMessage({
    request: z.strictObject({
      target: z.literal("background"),
      type: z.literal("OFFSCREEN_JOB_TERMINAL"),
      payload: OffscreenJobIncarnationSchema.extend({
        sequence: z.number().int().positive(),
        stage: OffscreenJobStageSchema,
        terminalAt: z.number().finite().nonnegative(),
        outcome: OffscreenJobOutcomeSchema,
      }),
    }),
    response: OffscreenRenewalResponseSchema,
    target: "background",
    kind: "event",
    allowedSenders: ["offscreen"],
    readiness: "runtime-ready",
  }),
  OFFSCREEN_INITIALIZATION_FAILED: defineRuntimeMessage({
    request: z.strictObject({
      target: z.literal("background"),
      type: z.literal("OFFSCREEN_INITIALIZATION_FAILED"),
      payload: z.strictObject({
        errorMessage: z.string().min(1),
        documentInstanceId: z.string().min(1),
      }),
    }),
    response: successOrFailure(),
    target: "background",
    kind: "event",
    allowedSenders: ["offscreen"],
    readiness: "control-ready",
  }),
  OFFSCREEN_STATUS: defineRuntimeMessage({
    request: z.strictObject({
      target: z.literal("offscreen"),
      type: z.literal("OFFSCREEN_STATUS"),
    }),
    response: z.union([
      z.strictObject({
        success: z.literal(true),
        initializationState: OffscreenInitializationStateSchema,
        documentInstanceId: z.string().min(1),
        activeJobCount: z.number().int().nonnegative(),
        activeSeriesResolutionCount: z.number().int().nonnegative(),
        activeTaskIds: z.array(z.string().min(1)),
      }),
      RuntimeFailureSchema,
    ]),
    target: "offscreen",
    kind: "query",
    allowedSenders: ["background"],
    readiness: "control-ready",
  }),
  OFFSCREEN_QUERY_JOB: defineRuntimeMessage({
    request: z.strictObject({
      target: z.literal("offscreen"),
      type: z.literal("OFFSCREEN_QUERY_JOB"),
      payload: z.strictObject({
        requestId: z.string().min(1),
        identity: OffscreenJobIncarnationSchema,
      }),
    }),
    response: z.union([
      z.strictObject({
        success: z.literal(true),
        requestId: z.string().min(1),
        job: OffscreenJobStateSchema.nullable(),
      }),
      RuntimeFailureSchema,
    ]),
    target: "offscreen",
    kind: "query",
    allowedSenders: ["background"],
    readiness: "runtime-ready",
  }),
  OFFSCREEN_CANCEL_JOB: defineRuntimeMessage({
    request: z.strictObject({
      target: z.literal("offscreen"),
      type: z.literal("OFFSCREEN_CANCEL_JOB"),
      payload: OffscreenJobIncarnationSchema,
    }),
    response: z.union([
      z.strictObject({
        success: z.literal(true),
        canceled: z.boolean(),
        ...OffscreenJobIncarnationSchema.shape,
        status: z.enum(["active", "terminal", "canceled", "absent"]),
        lastSequence: z.number().int().nonnegative(),
      }),
      RuntimeFailureSchema,
    ]),
    target: "offscreen",
    kind: "command",
    allowedSenders: ["background"],
    readiness: "runtime-ready",
  }),
  REVOKE_BLOB_URL: defineRuntimeMessage({
    request: z.strictObject({
      target: z.literal("offscreen"),
      type: z.literal("REVOKE_BLOB_URL"),
      payload: BlobUrlIdentitySchema,
    }),
    response: successOrFailure(),
    target: "offscreen",
    kind: "command",
    allowedSenders: ["background"],
    readiness: "runtime-ready",
  }),
  OFFSCREEN_DOWNLOAD_CHAPTER: defineRuntimeMessage({
    request: z.strictObject({
      target: z.literal("offscreen"),
      type: z.literal("OFFSCREEN_DOWNLOAD_CHAPTER"),
      payload: OffscreenDownloadChapterPayloadSchema,
    }),
    response: z.union([
      OffscreenDownloadChapterSuccessSchema,
      RuntimeFailureSchema,
    ]),
    target: "offscreen",
    kind: "command",
    allowedSenders: ["background"],
    readiness: "runtime-ready",
  }),
  OFFSCREEN_PARSE_SERIES_HTML: defineRuntimeMessage({
    request: z.strictObject({
      target: z.literal("offscreen"),
      type: z.literal("OFFSCREEN_PARSE_SERIES_HTML"),
      payload: OffscreenParseSeriesHtmlPayloadSchema,
    }),
    response: z.union([
      OffscreenParseSeriesHtmlSuccessSchema,
      RuntimeFailureSchema,
    ]),
    target: "offscreen",
    kind: "command",
    allowedSenders: ["background"],
    readiness: "runtime-ready",
  }),
  OFFSCREEN_CANCEL_SERIES_HTML: defineRuntimeMessage({
    request: z.strictObject({
      target: z.literal("offscreen"),
      type: z.literal("OFFSCREEN_CANCEL_SERIES_HTML"),
      payload: z.strictObject({ requestId: z.string().uuid() }),
    }),
    response: z.union([
      z.strictObject({ success: z.literal(true), canceled: z.boolean() }),
      RuntimeFailureSchema,
    ]),
    target: "offscreen",
    kind: "command",
    allowedSenders: ["background"],
    readiness: "runtime-ready",
  }),
} as const

export type RuntimeMessageType = keyof typeof runtimeMessageRegistry

export type RuntimeMessageRequest<TType extends RuntimeMessageType> = z.infer<
  (typeof runtimeMessageRegistry)[TType]["request"]
>

export type RuntimeMessageResponse<TType extends RuntimeMessageType> = z.infer<
  (typeof runtimeMessageRegistry)[TType]["response"]
>

export type RuntimeMessage = {
  [TType in RuntimeMessageType]: RuntimeMessageRequest<TType>
}[RuntimeMessageType]

export type RuntimeResponse = {
  [TType in RuntimeMessageType]: RuntimeMessageResponse<TType>
}[RuntimeMessageType]

export type RuntimeMessageTypesForTarget<TTarget extends RuntimeMessageTarget> =
  {
    [
      TType in RuntimeMessageType
    ]: (typeof runtimeMessageRegistry)[TType]["target"] extends TTarget
      ? TType
      : never
  }[RuntimeMessageType]

const ActiveChapterProgressSnapshotSchema = z.strictObject({
  chapterId: z.string().min(1),
  chapterTitle: z.string().min(1).optional(),
  imagesProcessed: z.number().int().nonnegative(),
  totalImages: z.number().int().nonnegative(),
  stage: OffscreenJobStageSchema,
  phaseFraction: z.number().finite().min(0).max(1),
  updatedAt: z.number().finite().nonnegative(),
})

export const ActiveTaskProgressSnapshotSchema = z.strictObject({
  generation: z.string().min(1),
  revision: z.number().int().nonnegative(),
  updatedAt: z.number().finite().nonnegative(),
  taskId: z.string().min(1),
  imagesProcessed: z.number().int().nonnegative(),
  totalImages: z.number().int().nonnegative(),
  activeChapterCount: z.number().int().nonnegative(),
  activeChapters: z.array(ActiveChapterProgressSnapshotSchema),
  chapterId: z.string().min(1).optional(),
  chapterTitle: z.string().min(1).optional(),
  stage: OffscreenJobStageSchema,
  phaseFraction: z.number().finite().min(0).max(1),
  overallFraction: z.number().finite().min(0).max(1).optional(),
  outputCommitted: z.boolean(),
  status: z.enum(["downloading", "completed", "failed", "partial_success"]),
})

const ActiveTaskProgressServerEventSchema = z.strictObject({
  type: z.literal("ACTIVE_TASK_PROGRESS"),
  generation: z.string().min(1),
  revision: z.number().int().nonnegative(),
  progress: ActiveTaskProgressSnapshotSchema.nullable(),
})

export const runtimePortRegistry = {
  ACTIVE_TASK_PROGRESS: {
    name: "tako-active-task-progress",
    allowedSenders: ["sidepanel"] as const,
    readiness: "queue-hydrated" as const,
    serverEvent: ActiveTaskProgressServerEventSchema,
  },
} as const

export type RuntimePortType = keyof typeof runtimePortRegistry
export type RuntimePortServerEvent<TType extends RuntimePortType> = z.infer<
  (typeof runtimePortRegistry)[TType]["serverEvent"]
>

export type ActiveTaskProgressSnapshot = NonNullable<
  RuntimePortServerEvent<"ACTIVE_TASK_PROGRESS">["progress"]
>
export type ActiveChapterProgressSnapshot =
  ActiveTaskProgressSnapshot["activeChapters"][number]

export { RuntimeFailureSchema }
