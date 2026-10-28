/** Retained native-output document contract through schema epoch 5. */
import { z } from "zod"
import { InvalidDurableStateError } from "@/src/runtime/runtime-phase-errors"

export const Epoch5DownloadErrorCategorySchema = z.enum([
  "network_unavailable",
  "provider_rate_limited",
  "provider_changed",
  "chapter_unavailable",
  "folder_permission_required",
  "folder_unavailable",
  "folder_write_failed",
  "disk_full",
  "browser_download_interrupted",
  "browser_handoff_interrupted",
  "archive_creation_failed",
  "unknown",
])
const DownloadErrorCategorySchema = Epoch5DownloadErrorCategorySchema

type OutputEvidence = {
  phase: string
  downloadId?: number
  erasedByBrowserAt?: number
}
function canAccountNativeOutput(record: OutputEvidence): boolean {
  return (
    record.downloadId !== undefined ||
    record.phase === "handoff_interrupted" ||
    record.phase === "complete" ||
    record.phase === "interrupted"
  )
}
function canReleaseNativeOutputBlob(record: OutputEvidence): boolean {
  return (
    record.phase === "complete" ||
    record.phase === "interrupted" ||
    record.erasedByBrowserAt !== undefined
  )
}
const nonemptyString = z.string().min(1)
const nonnegativeInteger = z.number().int().nonnegative()
const nonnegativeFiniteNumber = z.number().finite().nonnegative()

const manifestSlotSchema = z.discriminatedUnion("disposition", [
  z.strictObject({
    disposition: z.literal("tracked"),
    outputId: nonemptyString,
  }),
  z.strictObject({
    disposition: z.literal("untracked_failed"),
    failedAt: nonnegativeFiniteNumber,
    error: nonemptyString,
  }),
])

const manifestSchema = z
  .strictObject({
    jobId: nonemptyString,
    attempt: nonnegativeInteger,
    taskId: nonemptyString,
    chapterId: nonemptyString,
    fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    documentInstanceId: nonemptyString,
    phase: z.enum(["open", "sealed"]),
    outputsRequested: nonnegativeInteger,
    outputsFailedBeforeHandoff: nonnegativeInteger,
    slots: z.array(manifestSlotSchema.nullable()),
    createdAt: nonnegativeFiniteNumber,
    errorMessage: z.string().optional(),
    errorCategory: DownloadErrorCategorySchema.optional(),
    sealedAt: nonnegativeFiniteNumber.optional(),
    settlementAcknowledgedAt: nonnegativeFiniteNumber.optional(),
    dependencyReleasedAt: nonnegativeFiniteNumber.optional(),
  })
  .superRefine((manifest, context) => {
    if (manifest.slots.length !== manifest.outputsRequested) {
      context.addIssue({
        code: "custom",
        path: ["slots"],
        message: "manifest slots must equal outputsRequested",
      })
    }
    if (manifest.outputsFailedBeforeHandoff > manifest.outputsRequested) {
      context.addIssue({
        code: "custom",
        path: ["outputsFailedBeforeHandoff"],
        message: "failed-before-handoff cannot exceed requested outputs",
      })
    }
    const untrackedCount = manifest.slots.filter(
      (slot) => slot?.disposition === "untracked_failed"
    ).length
    if (manifest.phase === "open") {
      if (
        manifest.errorMessage !== undefined ||
        manifest.errorCategory !== undefined ||
        manifest.sealedAt !== undefined ||
        manifest.settlementAcknowledgedAt !== undefined ||
        manifest.dependencyReleasedAt !== undefined ||
        manifest.outputsFailedBeforeHandoff !== 0 ||
        untrackedCount !== 0
      ) {
        context.addIssue({
          code: "custom",
          path: ["phase"],
          message: "open manifest contains sealed state",
        })
      }
    } else {
      if (
        manifest.sealedAt === undefined ||
        manifest.sealedAt < manifest.createdAt ||
        manifest.slots.some((slot) => slot === null) ||
        untrackedCount !== manifest.outputsFailedBeforeHandoff
      ) {
        context.addIssue({
          code: "custom",
          path: ["phase"],
          message: "sealed manifest is incomplete",
        })
      }
    }
    if (
      manifest.settlementAcknowledgedAt !== undefined &&
      (manifest.sealedAt === undefined ||
        manifest.settlementAcknowledgedAt < manifest.sealedAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["settlementAcknowledgedAt"],
        message:
          "settlement acknowledgement requires a monotonic sealed manifest",
      })
    }
    if (
      manifest.dependencyReleasedAt !== undefined &&
      (manifest.settlementAcknowledgedAt === undefined ||
        manifest.dependencyReleasedAt < manifest.settlementAcknowledgedAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["dependencyReleasedAt"],
        message: "job dependency requires settlement acknowledgement",
      })
    }
  })

const outputRecordSchema = z
  .strictObject({
    outputId: nonemptyString,
    jobId: nonemptyString,
    attempt: nonnegativeInteger,
    taskId: nonemptyString,
    chapterId: nonemptyString,
    fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    documentInstanceId: nonemptyString,
    outputIndex: nonnegativeInteger,
    outputCount: z.number().int().positive(),
    blobUrl: z.string().startsWith("blob:"),
    filename: nonemptyString,
    outputKind: z.enum(["archive", "image"]),
    phase: z.enum([
      "prepared",
      "acceptance_unknown",
      "handoff_interrupted",
      "waiting",
      "complete",
      "interrupted",
    ]),
    createdAt: nonnegativeFiniteNumber,
    acceptanceStartedAt: nonnegativeFiniteNumber.optional(),
    downloadId: nonnegativeInteger.optional(),
    terminalAt: nonnegativeFiniteNumber.optional(),
    error: z.string().optional(),
    erasedAt: nonnegativeFiniteNumber.optional(),
    erasedByBrowserAt: nonnegativeFiniteNumber.optional(),
    accountingDisposition: z.enum(["pending", "accounted", "not_owner"]),
    accountingDispositionAt: nonnegativeFiniteNumber.optional(),
    blobReleasedAt: nonnegativeFiniteNumber.optional(),
    dependencyReleasedAt: nonnegativeFiniteNumber.optional(),
  })
  .superRefine((record, context) => {
    const isTerminal =
      record.phase === "complete" || record.phase === "interrupted"
    const requiresAcceptance =
      record.phase === "acceptance_unknown" ||
      record.phase === "handoff_interrupted" ||
      record.phase === "waiting" ||
      record.phase === "complete" ||
      (record.phase === "interrupted" &&
        record.acceptanceStartedAt !== undefined)
    if (record.outputIndex >= record.outputCount) {
      context.addIssue({
        code: "custom",
        path: ["outputIndex"],
        message: "output index must be in range",
      })
    }
    if (
      requiresAcceptance &&
      (record.acceptanceStartedAt === undefined ||
        record.acceptanceStartedAt < record.createdAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["acceptanceStartedAt"],
        message: "accepted phases require a monotonic acceptance timestamp",
      })
    }
    if (
      (record.phase === "prepared" ||
        record.phase === "acceptance_unknown" ||
        record.phase === "handoff_interrupted") &&
      (record.downloadId !== undefined || record.terminalAt !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["phase"],
        message: "pre-acceptance phases cannot contain native result state",
      })
    }
    if (
      (record.phase === "waiting" || record.phase === "complete") &&
      record.downloadId === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["downloadId"],
        message: "accepted output phase requires downloadId",
      })
    }
    if (record.phase === "waiting" && record.terminalAt !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["terminalAt"],
        message: "waiting output cannot be terminal",
      })
    }
    if (
      (isTerminal || record.terminalAt !== undefined) &&
      (record.terminalAt === undefined ||
        record.terminalAt < record.createdAt ||
        (record.acceptanceStartedAt !== undefined &&
          record.terminalAt < record.acceptanceStartedAt))
    ) {
      context.addIssue({
        code: "custom",
        path: ["terminalAt"],
        message: "terminal output requires a monotonic terminal timestamp",
      })
    }
    if (record.erasedAt !== undefined && record.downloadId === undefined) {
      context.addIssue({
        code: "custom",
        path: ["erasedAt"],
        message: "erased observation requires downloadId",
      })
    }
    if (
      record.erasedByBrowserAt !== undefined &&
      (record.erasedAt === undefined ||
        record.erasedByBrowserAt < record.erasedAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["erasedByBrowserAt"],
        message: "browser erasure requires a monotonic erased observation",
      })
    }
    if (
      record.accountingDisposition === "pending" &&
      record.accountingDispositionAt !== undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["accountingDispositionAt"],
        message: "pending accounting cannot have a disposition timestamp",
      })
    }
    if (
      record.accountingDisposition !== "pending" &&
      (!canAccountNativeOutput(record) ||
        record.accountingDispositionAt === undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["accountingDisposition"],
        message: "accounting disposition requires a resolved handoff",
      })
    }
    if (
      record.blobReleasedAt !== undefined &&
      (record.blobReleasedAt < record.createdAt ||
        (!canReleaseNativeOutputBlob(record) &&
          !(record.phase === "waiting" && record.erasedAt !== undefined)))
    ) {
      context.addIssue({
        code: "custom",
        path: ["blobReleasedAt"],
        message:
          "Blob release requires browser consumption evidence after preparation",
      })
    }
    if (
      record.dependencyReleasedAt !== undefined &&
      ((!canReleaseNativeOutputBlob(record) &&
        !(record.phase === "waiting" && record.erasedAt !== undefined)) ||
        record.accountingDisposition === "pending" ||
        record.blobReleasedAt === undefined ||
        record.dependencyReleasedAt < record.blobReleasedAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["dependencyReleasedAt"],
        message:
          "dependency release requires resolved accounting and Blob release",
      })
    }
  })

const nativeOutputStateSchema = z
  .strictObject({
    manifestsByJobId: z.record(z.string(), manifestSchema),
    outputsByOutputId: z.record(z.string(), outputRecordSchema),
  })
  .superRefine((state, context) => {
    const blobUrls = new Map<string, string>()
    const downloadIds = new Map<number, string>()
    const trackedOutputIds = new Set<string>()

    for (const [jobKey, manifest] of Object.entries(state.manifestsByJobId)) {
      if (jobKey !== manifest.jobId) {
        context.addIssue({
          code: "custom",
          path: ["manifestsByJobId", jobKey, "jobId"],
          message: "manifest key must match jobId",
        })
      }
      manifest.slots.forEach((slot, outputIndex) => {
        if (slot?.disposition !== "tracked") return
        if (trackedOutputIds.has(slot.outputId)) {
          context.addIssue({
            code: "custom",
            path: ["manifestsByJobId", jobKey, "slots", outputIndex],
            message: "outputId may occupy only one manifest slot",
          })
        }
        trackedOutputIds.add(slot.outputId)
        const record = state.outputsByOutputId[slot.outputId]
        if (record === undefined) {
          // Sealed manifests may reference fully released outputs that were
          // pruned from durable storage; absence is itself release proof.
          if (manifest.phase === "open") {
            context.addIssue({
              code: "custom",
              path: ["manifestsByJobId", jobKey, "slots", outputIndex],
              message: "open manifest slots require their exact output record",
            })
          }
          return
        }
        if (
          record.jobId !== manifest.jobId ||
          record.attempt !== manifest.attempt ||
          record.taskId !== manifest.taskId ||
          record.chapterId !== manifest.chapterId ||
          record.fingerprint !== manifest.fingerprint ||
          record.documentInstanceId !== manifest.documentInstanceId ||
          record.outputCount !== manifest.outputsRequested ||
          record.outputIndex !== outputIndex
        ) {
          context.addIssue({
            code: "custom",
            path: ["manifestsByJobId", jobKey, "slots", outputIndex],
            message: "tracked slot must reference its exact output identity",
          })
        }
      })
      if (
        manifest.settlementAcknowledgedAt !== undefined &&
        manifest.slots.some(
          (slot) =>
            slot?.disposition === "tracked" &&
            state.outputsByOutputId[slot.outputId]?.accountingDisposition ===
              "pending"
        )
      ) {
        context.addIssue({
          code: "custom",
          path: ["manifestsByJobId", jobKey, "settlementAcknowledgedAt"],
          message:
            "settlement acknowledgement requires resolved output accounting",
        })
      }
      if (manifest.dependencyReleasedAt !== undefined) {
        const tracked = manifest.slots.flatMap((slot) =>
          slot?.disposition === "tracked" ? [slot.outputId] : []
        )
        if (
          tracked.some((outputId) => {
            const record = state.outputsByOutputId[outputId]
            return (
              record !== undefined && record.dependencyReleasedAt === undefined
            )
          })
        ) {
          context.addIssue({
            code: "custom",
            path: ["manifestsByJobId", jobKey, "dependencyReleasedAt"],
            message: "job dependency requires every tracked dependency release",
          })
        }
      }
    }

    for (const [outputKey, record] of Object.entries(state.outputsByOutputId)) {
      if (outputKey !== record.outputId || !trackedOutputIds.has(outputKey)) {
        context.addIssue({
          code: "custom",
          path: ["outputsByOutputId", outputKey],
          message: "output key and manifest slot must match outputId",
        })
      }
      const blobOwner = blobUrls.get(record.blobUrl)
      if (blobOwner !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["outputsByOutputId", outputKey, "blobUrl"],
          message: `blobUrl is already assigned to ${blobOwner}`,
        })
      }
      blobUrls.set(record.blobUrl, record.outputId)
      if (record.downloadId !== undefined) {
        const downloadOwner = downloadIds.get(record.downloadId)
        if (downloadOwner !== undefined) {
          context.addIssue({
            code: "custom",
            path: ["outputsByOutputId", outputKey, "downloadId"],
            message: `downloadId is already assigned to ${downloadOwner}`,
          })
        }
        downloadIds.set(record.downloadId, record.outputId)
      }
    }
  })

export function parseEpoch5NativeOutputState(value: unknown) {
  if (value === undefined)
    return nativeOutputStateSchema.parse({
      manifestsByJobId: {},
      outputsByOutputId: {},
    })
  const parsed = nativeOutputStateSchema.safeParse(value)
  if (!parsed.success) {
    throw new InvalidDurableStateError("Invalid durable native output state", {
      cause: parsed.error,
    })
  }
  return parsed.data
}
