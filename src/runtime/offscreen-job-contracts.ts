import { z } from "zod"

import { DownloadErrorCategorySchema } from "@/src/shared/download-contract"

export const OffscreenJobStageSchema = z.enum([
  "dispatching",
  "accepted",
  "resolving",
  "downloading",
  "transforming",
  "archiving",
  "saving",
])

export const OffscreenJobIdentitySchema = z.strictObject({
  jobId: z.string().min(1),
  attempt: z.number().int().nonnegative(),
  taskId: z.string().min(1),
  chapterId: z.string().min(1),
})

export const OffscreenJobFingerprintSchema = z.string().regex(/^[0-9a-f]{64}$/)

export const OffscreenJobIncarnationSchema = OffscreenJobIdentitySchema.extend({
  fingerprint: OffscreenJobFingerprintSchema,
  documentInstanceId: z.string().min(1),
})

export const OffscreenJobOutcomeSchema = z
  .strictObject({
    status: z.enum(["completed", "partial_success", "failed"]),
    errorMessage: z.string().optional(),
    errorCategory: DownloadErrorCategorySchema.optional(),
    imagesFailed: z.number().int().nonnegative().optional(),
    outputsRequested: z.number().int().nonnegative(),
    outputsFailedBeforeHandoff: z.number().int().nonnegative(),
    outputsCommitted: z.number().int().nonnegative(),
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

export const OffscreenJobStateSchema = OffscreenJobIncarnationSchema.extend({
  status: z.enum(["active", "terminal", "canceled"]),
  stage: OffscreenJobStageSchema,
  lastSequence: z.number().int().nonnegative(),
  outcome: OffscreenJobOutcomeSchema.optional(),
}).superRefine((value, context) => {
  if (value.status === "terminal" && value.outcome === undefined) {
    context.addIssue({
      code: "custom",
      path: ["outcome"],
      message: "terminal jobs require a full outcome",
    })
  }
})

export const BlobUrlSchema = z
  .string()
  .min(1)
  .refine((value) => value.startsWith("blob:"), {
    message: "Expected blob URL",
  })

export const BlobUrlIdentitySchema = OffscreenJobIncarnationSchema.extend({
  outputId: z.string().min(1),
  blobUrl: BlobUrlSchema,
})

export type OffscreenJobStage = z.infer<typeof OffscreenJobStageSchema>
export type OffscreenJobIdentity = z.infer<typeof OffscreenJobIdentitySchema>
export type OffscreenJobIncarnation = z.infer<
  typeof OffscreenJobIncarnationSchema
>
export type OffscreenJobOutcome = z.infer<typeof OffscreenJobOutcomeSchema>
export type OffscreenJobState = z.infer<typeof OffscreenJobStateSchema>
export type BlobUrlIdentity = z.infer<typeof BlobUrlIdentitySchema>
