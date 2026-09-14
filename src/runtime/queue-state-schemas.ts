import { z } from "zod"

import {
  ArchiveFormatSchema,
  ConflictPolicySchema,
  DownloadDestinationSchema,
  DownloadErrorCategorySchema,
  DownloadTaskChapterStatusSchema,
  DownloadTaskStatusSchema,
  ImagePaddingDigitsSchema,
} from "@/src/shared/download-contract"
import { RATE_POLICY_LIMITS } from "@/src/shared/rate-policy-limits"
import { SETTINGS_LIMITS } from "@/src/domain/settings/schema"
import {
  PublicHttpsUrlSchema,
  SeriesMetadataSnapshotSchema,
} from "@/src/runtime/series-data-schemas"
import { DestinationIssueSchema } from "@/src/runtime/destination-issue-state"

const finiteNumber = z.number().finite()
const nonnegativeInteger = z.number().int().nonnegative()
const nonemptyString = z.string().min(1)
const imageConcurrencySchema = z
  .number()
  .int()
  .min(RATE_POLICY_LIMITS.MIN_CONCURRENCY)
  .max(RATE_POLICY_LIMITS.MAX_CONCURRENCY)
const ratePolicyDelaySchema = finiteNumber
  .min(RATE_POLICY_LIMITS.MIN_DELAY_MS)
  .max(RATE_POLICY_LIMITS.MAX_DELAY_MS)
const retryCountSchema = z
  .number()
  .int()
  .min(SETTINGS_LIMITS.MIN_RETRIES)
  .max(SETTINGS_LIMITS.MAX_RETRIES)

const imageRatePolicySchema = z
  .object({
    concurrency: imageConcurrencySchema,
    delayMs: ratePolicyDelaySchema,
  })
  .strict()

const chapterRatePolicySchema = z
  .object({
    concurrency: z.literal(1),
    delayMs: ratePolicyDelaySchema,
  })
  .strict()

const taskSettingsSnapshotSchema = z
  .object({
    archiveFormat: ArchiveFormatSchema,
    destination: DownloadDestinationSchema,
    conflictPolicy: ConflictPolicySchema,
    pathTemplate: z.string(),
    fileNameTemplate: z.string().min(1),
    includeComicInfo: z.boolean(),
    includeCoverImage: z.boolean(),
    siteSettings: z.record(z.string(), z.unknown()),
    rateLimitSettings: z
      .object({
        image: imageRatePolicySchema,
        chapter: chapterRatePolicySchema,
      })
      .strict(),
    retrySettings: z
      .object({
        image: retryCountSchema,
        chapter: retryCountSchema,
      })
      .strict(),
    normalizeImageFilenames: z.boolean(),
    imagePaddingDigits: ImagePaddingDigitsSchema,
    comicInfo: SeriesMetadataSnapshotSchema.optional(),
    siteIntegrationId: nonemptyString,
  })
  .strict()

const epoch2TaskSettingsSnapshotSchema = taskSettingsSnapshotSchema.extend({
  comicInfo: z.record(z.string(), z.unknown()).optional(),
})

const outputAccountingSchema = z
  .object({
    requested: nonnegativeInteger,
    committed: nonnegativeInteger,
    failed: nonnegativeInteger,
  })
  .strict()

const nativeOutputSettlementSchema = z
  .strictObject({
    jobId: nonemptyString,
    attempt: nonnegativeInteger,
    taskId: nonemptyString,
    chapterId: nonemptyString,
    requested: nonnegativeInteger,
    completed: nonnegativeInteger,
    interrupted: nonnegativeInteger,
    surrendered: nonnegativeInteger,
    lastSuccessfulDownloadId: nonnegativeInteger.optional(),
    appliedAt: finiteNumber.nonnegative(),
  })
  .refine(
    (settlement) =>
      settlement.completed + settlement.interrupted + settlement.surrendered ===
      settlement.requested,
    { message: "native output settlement totals must equal requested" }
  )

const taskChapterSchema = z
  .object({
    id: nonemptyString,
    url: nonemptyString,
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
    errorCategory: DownloadErrorCategorySchema.optional(),
    totalImages: nonnegativeInteger.optional(),
    imagesFailed: nonnegativeInteger.optional(),
    outputs: outputAccountingSchema.optional(),
    nativeOutputSettlement: nativeOutputSettlementSchema.optional(),
    dispatchAttempt: nonnegativeInteger.optional(),
    lastUpdated: finiteNumber,
  })
  .strict()

const downloadTaskStateShape = {
  id: nonemptyString,
  siteIntegrationId: nonemptyString,
  mangaId: nonemptyString,
  seriesTitle: z.string(),
  seriesCoverUrl: PublicHttpsUrlSchema.optional(),
  chapters: z.array(taskChapterSchema),
  status: DownloadTaskStatusSchema,
  errorMessage: z.string().optional(),
  errorCategory: DownloadErrorCategorySchema.optional(),
  activeBlock: z
    .enum([
      "destination_action_required",
      "provider_network_policy_pending",
      "provider_network_policy_action_required",
      "native_output_action_required",
    ])
    .optional(),
  destinationIssue: DestinationIssueSchema.optional(),
  destinationOverride: z.literal("downloads-api").optional(),
  created: finiteNumber,
  started: finiteNumber.optional(),
  completed: finiteNumber.optional(),
  isRetried: z.boolean().optional(),
  isRetryTask: z.boolean().optional(),
  lastSuccessfulDownloadId: nonnegativeInteger.optional(),
  nextChapterDispatchAt: finiteNumber.optional(),
  destinationBlockRevision: nonnegativeInteger.optional(),
  destinationResume: z
    .strictObject({
      commandId: nonemptyString,
      blockRevision: nonnegativeInteger,
    })
    .optional(),
  activeCancel: z
    .strictObject({
      commandId: nonemptyString,
    })
    .optional(),
  restoredUndo: z
    .strictObject({
      token: nonemptyString,
      type: z.enum(["cancel_queued", "remove_history"]),
    })
    .optional(),
  settingsSnapshot: taskSettingsSnapshotSchema,
} as const

export const DownloadTaskStateDocumentSchema = z
  .object(downloadTaskStateShape)
  .strict()

/** Storage shape used by the released epoch-2 document before destination pairing. */
export const Epoch2DownloadTaskStateSchema =
  DownloadTaskStateDocumentSchema.extend({
    seriesCoverUrl: z.string().optional(),
    settingsSnapshot: epoch2TaskSettingsSnapshotSchema,
  })

export const DownloadTaskStateSchema =
  DownloadTaskStateDocumentSchema.superRefine((task, ctx) => {
    if (task.activeBlock === "destination_action_required") {
      if (!task.destinationIssue) {
        ctx.addIssue({
          code: "custom",
          path: ["destinationIssue"],
          message: "destination blocks require a paired destination issue",
        })
        return
      }
      if (task.destinationIssue.taskId !== task.id) {
        ctx.addIssue({
          code: "custom",
          path: ["destinationIssue", "taskId"],
          message: "destination issue task ID must match its task",
        })
      }
      if (
        task.destinationIssue.chapterId !== undefined &&
        !task.chapters.some(
          (chapter) => chapter.id === task.destinationIssue?.chapterId
        )
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["destinationIssue", "chapterId"],
          message: "destination issue chapter ID must match its task",
        })
      }
      return
    }
    if (task.destinationIssue) {
      ctx.addIssue({
        code: "custom",
        path: ["destinationIssue"],
        message: "destination issues require a destination block",
      })
    }
  })

export const ActiveDispatchLeaseSchema = z
  .object({
    jobId: nonemptyString,
    taskId: nonemptyString,
    chapterId: nonemptyString,
    attempt: nonnegativeInteger,
    fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    documentInstanceId: nonemptyString.optional(),
    saveMode: z.enum(["fsa", "downloads-api"]),
    lastEventSignature: nonemptyString.optional(),
    stage: z.enum([
      "dispatching",
      "accepted",
      "resolving",
      "downloading",
      "transforming",
      "archiving",
      "saving",
    ]),
    startedAt: finiteNumber.nonnegative(),
    lastActivityAt: finiteNumber.nonnegative(),
    leaseExpiresAt: finiteNumber.nonnegative(),
    sequence: nonnegativeInteger,
  })
  .strict()

export const PendingUndoActionSchema = z
  .object({
    token: nonemptyString,
    type: z.enum(["cancel_queued", "remove_history"]),
    taskSnapshot: DownloadTaskStateSchema,
    previousQueuePosition: nonnegativeInteger,
    createdAt: finiteNumber,
    expiresAt: finiteNumber,
  })
  .strict()
  .refine((action) => action.expiresAt >= action.createdAt)

export const Epoch2PendingUndoActionSchema = z
  .object({
    token: nonemptyString,
    type: z.enum(["cancel_queued", "remove_history"]),
    taskSnapshot: Epoch2DownloadTaskStateSchema,
    previousQueuePosition: nonnegativeInteger,
    createdAt: finiteNumber,
    expiresAt: finiteNumber,
  })
  .strict()
  .refine((action) => action.expiresAt >= action.createdAt)
