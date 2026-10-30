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

const manifestDocumentSchema = z.strictObject({
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

type NativeManifest = z.infer<typeof manifestDocumentSchema>

function validateManifestCounts(
  manifest: NativeManifest,
  context: z.RefinementCtx
): void {
  if (manifest.slots.length !== manifest.outputsRequested)
    context.addIssue({
      code: "custom",
      path: ["slots"],
      message: "manifest slots must equal outputsRequested",
    })
  if (manifest.outputsFailedBeforeHandoff > manifest.outputsRequested)
    context.addIssue({
      code: "custom",
      path: ["outputsFailedBeforeHandoff"],
      message: "failed-before-handoff cannot exceed requested outputs",
    })
}

function hasSealedManifestState(
  manifest: NativeManifest,
  untrackedCount: number
): boolean {
  return (
    manifest.errorMessage !== undefined ||
    manifest.errorCategory !== undefined ||
    manifest.sealedAt !== undefined ||
    manifest.settlementAcknowledgedAt !== undefined ||
    manifest.dependencyReleasedAt !== undefined ||
    manifest.outputsFailedBeforeHandoff !== 0 ||
    untrackedCount !== 0
  )
}

function validateSealedManifest(
  manifest: NativeManifest,
  untrackedCount: number,
  context: z.RefinementCtx
): void {
  if (
    manifest.sealedAt === undefined ||
    manifest.sealedAt < manifest.createdAt ||
    manifest.slots.some((slot) => slot === null) ||
    untrackedCount !== manifest.outputsFailedBeforeHandoff
  )
    context.addIssue({
      code: "custom",
      path: ["phase"],
      message: "sealed manifest is incomplete",
    })
}

function validateManifestPhase(
  manifest: NativeManifest,
  context: z.RefinementCtx
): void {
  const untrackedCount = manifest.slots.filter(
    (slot) => slot?.disposition === "untracked_failed"
  ).length
  if (manifest.phase === "open") {
    if (hasSealedManifestState(manifest, untrackedCount))
      context.addIssue({
        code: "custom",
        path: ["phase"],
        message: "open manifest contains sealed state",
      })
  } else validateSealedManifest(manifest, untrackedCount, context)
}

function validateMonotonicReceipt(
  receipt: number | undefined,
  predecessor: number | undefined,
  path: string[],
  message: string,
  context: z.RefinementCtx
): void {
  if (
    receipt !== undefined &&
    (predecessor === undefined || receipt < predecessor)
  )
    context.addIssue({ code: "custom", path, message })
}

function validateManifestReceiptTimes(
  manifest: NativeManifest,
  context: z.RefinementCtx
): void {
  validateMonotonicReceipt(
    manifest.settlementAcknowledgedAt,
    manifest.sealedAt,
    ["settlementAcknowledgedAt"],
    "settlement acknowledgement requires a monotonic sealed manifest",
    context
  )
  validateMonotonicReceipt(
    manifest.dependencyReleasedAt,
    manifest.settlementAcknowledgedAt,
    ["dependencyReleasedAt"],
    "job dependency requires settlement acknowledgement",
    context
  )
}

function validateManifest(
  manifest: NativeManifest,
  context: z.RefinementCtx
): void {
  validateManifestCounts(manifest, context)
  validateManifestPhase(manifest, context)
  validateManifestReceiptTimes(manifest, context)
}

const manifestSchema = manifestDocumentSchema.superRefine(validateManifest)

const outputRecordDocumentSchema = z.strictObject({
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

type NativeOutputRecord = z.infer<typeof outputRecordDocumentSchema>

function requiresRecordedAcceptance(record: NativeOutputRecord): boolean {
  return (
    record.phase === "acceptance_unknown" ||
    record.phase === "handoff_interrupted" ||
    record.phase === "waiting" ||
    record.phase === "complete" ||
    (record.phase === "interrupted" && record.acceptanceStartedAt !== undefined)
  )
}

function validateOutputIndex(
  record: NativeOutputRecord,
  context: z.RefinementCtx
): void {
  if (record.outputIndex >= record.outputCount)
    context.addIssue({
      code: "custom",
      path: ["outputIndex"],
      message: "output index must be in range",
    })
}

function validateAcceptanceTime(
  record: NativeOutputRecord,
  context: z.RefinementCtx
): void {
  if (
    requiresRecordedAcceptance(record) &&
    (record.acceptanceStartedAt === undefined ||
      record.acceptanceStartedAt < record.createdAt)
  )
    context.addIssue({
      code: "custom",
      path: ["acceptanceStartedAt"],
      message: "accepted phases require a monotonic acceptance timestamp",
    })
}

function validatePreAcceptanceState(
  record: NativeOutputRecord,
  context: z.RefinementCtx
): void {
  if (
    (record.phase === "prepared" ||
      record.phase === "acceptance_unknown" ||
      record.phase === "handoff_interrupted") &&
    (record.downloadId !== undefined || record.terminalAt !== undefined)
  )
    context.addIssue({
      code: "custom",
      path: ["phase"],
      message: "pre-acceptance phases cannot contain native result state",
    })
}

function validateAcceptedDownloadIdentity(
  record: NativeOutputRecord,
  context: z.RefinementCtx
): void {
  if (
    (record.phase === "waiting" || record.phase === "complete") &&
    record.downloadId === undefined
  )
    context.addIssue({
      code: "custom",
      path: ["downloadId"],
      message: "accepted output phase requires downloadId",
    })
}

function validateWaitingTerminalState(
  record: NativeOutputRecord,
  context: z.RefinementCtx
): void {
  if (record.phase === "waiting" && record.terminalAt !== undefined)
    context.addIssue({
      code: "custom",
      path: ["terminalAt"],
      message: "waiting output cannot be terminal",
    })
}

function validateTerminalTime(
  record: NativeOutputRecord,
  context: z.RefinementCtx
): void {
  const isTerminal =
    record.phase === "complete" || record.phase === "interrupted"
  if (
    (isTerminal || record.terminalAt !== undefined) &&
    (record.terminalAt === undefined ||
      record.terminalAt < record.createdAt ||
      (record.acceptanceStartedAt !== undefined &&
        record.terminalAt < record.acceptanceStartedAt))
  )
    context.addIssue({
      code: "custom",
      path: ["terminalAt"],
      message: "terminal output requires a monotonic terminal timestamp",
    })
}

function validateErasureEvidence(
  record: NativeOutputRecord,
  context: z.RefinementCtx
): void {
  if (record.erasedAt !== undefined && record.downloadId === undefined)
    context.addIssue({
      code: "custom",
      path: ["erasedAt"],
      message: "erased observation requires downloadId",
    })
  validateMonotonicReceipt(
    record.erasedByBrowserAt,
    record.erasedAt,
    ["erasedByBrowserAt"],
    "browser erasure requires a monotonic erased observation",
    context
  )
}

function validateOutputAccounting(
  record: NativeOutputRecord,
  context: z.RefinementCtx
): void {
  if (
    record.accountingDisposition === "pending" &&
    record.accountingDispositionAt !== undefined
  )
    context.addIssue({
      code: "custom",
      path: ["accountingDispositionAt"],
      message: "pending accounting cannot have a disposition timestamp",
    })
  if (
    record.accountingDisposition !== "pending" &&
    (!canAccountNativeOutput(record) ||
      record.accountingDispositionAt === undefined)
  )
    context.addIssue({
      code: "custom",
      path: ["accountingDisposition"],
      message: "accounting disposition requires a resolved handoff",
    })
}

function hasBlobConsumptionEvidence(record: NativeOutputRecord): boolean {
  return (
    canReleaseNativeOutputBlob(record) ||
    (record.phase === "waiting" && record.erasedAt !== undefined)
  )
}

function validateOutputBlobRelease(
  record: NativeOutputRecord,
  context: z.RefinementCtx
): void {
  if (
    record.blobReleasedAt !== undefined &&
    (record.blobReleasedAt < record.createdAt ||
      !hasBlobConsumptionEvidence(record))
  )
    context.addIssue({
      code: "custom",
      path: ["blobReleasedAt"],
      message:
        "Blob release requires browser consumption evidence after preparation",
    })
}

function validateOutputDependencyRelease(
  record: NativeOutputRecord,
  context: z.RefinementCtx
): void {
  if (
    record.dependencyReleasedAt !== undefined &&
    (!hasBlobConsumptionEvidence(record) ||
      record.accountingDisposition === "pending" ||
      record.blobReleasedAt === undefined ||
      record.dependencyReleasedAt < record.blobReleasedAt)
  )
    context.addIssue({
      code: "custom",
      path: ["dependencyReleasedAt"],
      message:
        "dependency release requires resolved accounting and Blob release",
    })
}

function validateOutputRecord(
  record: NativeOutputRecord,
  context: z.RefinementCtx
): void {
  validateOutputIndex(record, context)
  validateAcceptanceTime(record, context)
  validatePreAcceptanceState(record, context)
  validateAcceptedDownloadIdentity(record, context)
  validateWaitingTerminalState(record, context)
  validateTerminalTime(record, context)
  validateErasureEvidence(record, context)
  validateOutputAccounting(record, context)
  validateOutputBlobRelease(record, context)
  validateOutputDependencyRelease(record, context)
}

const outputRecordSchema =
  outputRecordDocumentSchema.superRefine(validateOutputRecord)

const nativeOutputStateDocumentSchema = z.strictObject({
  manifestsByJobId: z.record(z.string(), manifestSchema),
  outputsByOutputId: z.record(z.string(), outputRecordSchema),
})

type NativeOutputState = z.infer<typeof nativeOutputStateDocumentSchema>
type ManifestSlot = NativeManifest["slots"][number]

function matchesManifestJob(
  record: NativeOutputRecord,
  manifest: NativeManifest
): boolean {
  return (
    record.jobId === manifest.jobId &&
    record.attempt === manifest.attempt &&
    record.taskId === manifest.taskId &&
    record.chapterId === manifest.chapterId &&
    record.fingerprint === manifest.fingerprint &&
    record.documentInstanceId === manifest.documentInstanceId
  )
}

function matchesManifestSlot(
  record: NativeOutputRecord,
  manifest: NativeManifest,
  outputIndex: number
): boolean {
  return (
    matchesManifestJob(record, manifest) &&
    record.outputCount === manifest.outputsRequested &&
    record.outputIndex === outputIndex
  )
}

function validateTrackedSlot(
  state: NativeOutputState,
  jobKey: string,
  manifest: NativeManifest,
  slot: ManifestSlot,
  outputIndex: number,
  trackedOutputIds: Set<string>,
  context: z.RefinementCtx
): void {
  if (slot?.disposition !== "tracked") return
  const path = ["manifestsByJobId", jobKey, "slots", outputIndex]
  if (trackedOutputIds.has(slot.outputId))
    context.addIssue({
      code: "custom",
      path,
      message: "outputId may occupy only one manifest slot",
    })
  trackedOutputIds.add(slot.outputId)
  const record = state.outputsByOutputId[slot.outputId]
  if (record === undefined) {
    // A sealed manifest may retain a slot whose fully released record was pruned.
    if (manifest.phase === "open")
      context.addIssue({
        code: "custom",
        path,
        message: "open manifest slots require their exact output record",
      })
    return
  }
  if (!matchesManifestSlot(record, manifest, outputIndex))
    context.addIssue({
      code: "custom",
      path,
      message: "tracked slot must reference its exact output identity",
    })
}

function validateManifestAccounting(
  state: NativeOutputState,
  jobKey: string,
  manifest: NativeManifest,
  context: z.RefinementCtx
): void {
  if (
    manifest.settlementAcknowledgedAt !== undefined &&
    manifest.slots.some(
      (slot) =>
        slot?.disposition === "tracked" &&
        state.outputsByOutputId[slot.outputId]?.accountingDisposition ===
          "pending"
    )
  )
    context.addIssue({
      code: "custom",
      path: ["manifestsByJobId", jobKey, "settlementAcknowledgedAt"],
      message: "settlement acknowledgement requires resolved output accounting",
    })
}

function validateManifestDependencies(
  state: NativeOutputState,
  jobKey: string,
  manifest: NativeManifest,
  context: z.RefinementCtx
): void {
  if (manifest.dependencyReleasedAt === undefined) return
  const tracked = manifest.slots.flatMap((slot) =>
    slot?.disposition === "tracked" ? [slot.outputId] : []
  )
  if (
    tracked.some((outputId) => {
      const record = state.outputsByOutputId[outputId]
      return record !== undefined && record.dependencyReleasedAt === undefined
    })
  )
    context.addIssue({
      code: "custom",
      path: ["manifestsByJobId", jobKey, "dependencyReleasedAt"],
      message: "job dependency requires every tracked dependency release",
    })
}

function validateManifestState(
  state: NativeOutputState,
  jobKey: string,
  manifest: NativeManifest,
  trackedOutputIds: Set<string>,
  context: z.RefinementCtx
): void {
  if (jobKey !== manifest.jobId)
    context.addIssue({
      code: "custom",
      path: ["manifestsByJobId", jobKey, "jobId"],
      message: "manifest key must match jobId",
    })
  manifest.slots.forEach((slot, index) =>
    validateTrackedSlot(
      state,
      jobKey,
      manifest,
      slot,
      index,
      trackedOutputIds,
      context
    )
  )
  validateManifestAccounting(state, jobKey, manifest, context)
  validateManifestDependencies(state, jobKey, manifest, context)
}

function validateOutputMembership(
  outputKey: string,
  record: NativeOutputRecord,
  trackedOutputIds: Set<string>,
  context: z.RefinementCtx
): void {
  if (outputKey !== record.outputId || !trackedOutputIds.has(outputKey))
    context.addIssue({
      code: "custom",
      path: ["outputsByOutputId", outputKey],
      message: "output key and manifest slot must match outputId",
    })
}

function claimUniqueOutputIdentity<TKey extends string | number>(
  key: TKey,
  outputKey: string,
  outputId: string,
  owners: Map<TKey, string>,
  field: "blobUrl" | "downloadId",
  context: z.RefinementCtx
): void {
  const owner = owners.get(key)
  if (owner !== undefined)
    context.addIssue({
      code: "custom",
      path: ["outputsByOutputId", outputKey, field],
      message: `${field} is already assigned to ${owner}`,
    })
  owners.set(key, outputId)
}

function validateBlobOwnership(
  outputKey: string,
  record: NativeOutputRecord,
  blobUrls: Map<string, string>,
  context: z.RefinementCtx
): void {
  claimUniqueOutputIdentity(
    record.blobUrl,
    outputKey,
    record.outputId,
    blobUrls,
    "blobUrl",
    context
  )
}

function validateDownloadOwnership(
  outputKey: string,
  record: NativeOutputRecord,
  downloadIds: Map<number, string>,
  context: z.RefinementCtx
): void {
  if (record.downloadId === undefined) return
  claimUniqueOutputIdentity(
    record.downloadId,
    outputKey,
    record.outputId,
    downloadIds,
    "downloadId",
    context
  )
}

function validateNativeOutputState(
  state: NativeOutputState,
  context: z.RefinementCtx
): void {
  const blobUrls = new Map<string, string>()
  const downloadIds = new Map<number, string>()
  const trackedOutputIds = new Set<string>()
  for (const [key, manifest] of Object.entries(state.manifestsByJobId))
    validateManifestState(state, key, manifest, trackedOutputIds, context)
  for (const [key, record] of Object.entries(state.outputsByOutputId)) {
    validateOutputMembership(key, record, trackedOutputIds, context)
    validateBlobOwnership(key, record, blobUrls, context)
    validateDownloadOwnership(key, record, downloadIds, context)
  }
}

const nativeOutputStateSchema = nativeOutputStateDocumentSchema.superRefine(
  validateNativeOutputState
)

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
