import { z } from "zod"

import { DownloadErrorCategorySchema } from "@/src/shared/download-contract"

import {
  acknowledgeNativeOutputSettlement,
  attachNativeDownload,
  ensureNativeOutputManifest,
  interruptNativeOutputBeforeAcceptance,
  markNativeOutputOutcomeUnknown,
  markNativeDownloadTerminal,
  markNativeOutputAcceptanceUnknown,
  markNativeOutputAccountingDisposition,
  markNativeOutputBlobReleased,
  markNativeOutputDependencyReleased,
  markNativeOutputJobDependencyReleased,
  observeNativeDownloadErased,
  observeNativeDownloadPending,
  prepareNativeOutput,
  sealNativeOutputManifest,
  type NativeOutputKernelDecision,
} from "@/src/domain/native-output/kernel"
import {
  createEmptyNativeOutputState,
  canReleaseNativeOutputBlob,
  canAccountNativeOutput,
  isNativeOutputTerminal,
  nativeOutputJobIdentityMatches,
  type NativeOutputManifest,
  type NativeOutputRecord,
  type NativeOutputState,
} from "@/src/domain/native-output/state"
import { InvalidDurableStateError } from "@/src/runtime/runtime-phase-errors"
import { StorageMutationQueue } from "./storage-mutation-queue"
import { parseDurableState } from "./durable-state-codecs"

/**
 * Prune output records after their resource dependencies are released.
 * Retain each job manifest until settlement is acknowledged and all tracked
 * outputs are released. The queue task retains terminal accounting.
 */

const nonemptyString = z.string().min(1)
const nonnegativeInteger = z.number().int().nonnegative()
const nonnegativeFiniteNumber = z.number().finite().nonnegative()

const INDEX_KEY = "pendingOutputs:index"
const MANIFEST_KEY_PREFIX = "pendingOutputs:manifest:"
const OUTPUT_KEY_PREFIX = "pendingOutputs:output:"

function manifestStorageKey(jobId: string): string {
  return `${MANIFEST_KEY_PREFIX}${jobId}`
}

function outputStorageKey(outputId: string): string {
  return `${OUTPUT_KEY_PREFIX}${outputId}`
}

interface NativeOutputStorageIndex {
  jobIds: string[]
  outputIds: string[]
  downloadIdToOutputId: Record<string, string>
}

const nativeOutputStorageIndexSchema = z.strictObject({
  jobIds: z.array(nonemptyString),
  outputIds: z.array(nonemptyString),
  downloadIdToOutputId: z.record(nonemptyString, nonemptyString),
})

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

const manifestInputSchema = z.strictObject({
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

type ParsedManifest = z.infer<typeof manifestInputSchema>
const manifestSchema: z.ZodType<NativeOutputManifest> =
  manifestInputSchema.superRefine(validateManifest)

function reportInvalidNativeOutput(
  context: z.RefinementCtx,
  path: (string | number)[],
  message: string
): void {
  context.addIssue({ code: "custom", path, message })
}

function validateManifest(
  manifest: ParsedManifest,
  context: z.RefinementCtx
): void {
  validateManifestCounts(manifest, context)
  const untrackedCount = manifest.slots.filter(
    (slot) => slot?.disposition === "untracked_failed"
  ).length
  if (manifest.phase === "open")
    validateOpenManifest(manifest, untrackedCount, context)
  else validateSealedManifest(manifest, untrackedCount, context)
  validateManifestLifecycle(manifest, context)
}

function validateManifestCounts(
  manifest: ParsedManifest,
  context: z.RefinementCtx
): void {
  if (manifest.slots.length !== manifest.outputsRequested) {
    reportInvalidNativeOutput(
      context,
      ["slots"],
      "manifest slots must equal outputsRequested"
    )
  }
  if (manifest.outputsFailedBeforeHandoff > manifest.outputsRequested) {
    reportInvalidNativeOutput(
      context,
      ["outputsFailedBeforeHandoff"],
      "failed-before-handoff cannot exceed requested outputs"
    )
  }
}

function validateOpenManifest(
  manifest: ParsedManifest,
  untrackedCount: number,
  context: z.RefinementCtx
): void {
  if (
    manifest.errorMessage !== undefined ||
    manifest.errorCategory !== undefined ||
    manifest.sealedAt !== undefined ||
    manifest.settlementAcknowledgedAt !== undefined ||
    manifest.dependencyReleasedAt !== undefined ||
    manifest.outputsFailedBeforeHandoff !== 0 ||
    untrackedCount !== 0
  ) {
    reportInvalidNativeOutput(
      context,
      ["phase"],
      "open manifest contains sealed state"
    )
  }
}

function validateSealedManifest(
  manifest: ParsedManifest,
  untrackedCount: number,
  context: z.RefinementCtx
): void {
  if (
    manifest.sealedAt === undefined ||
    manifest.sealedAt < manifest.createdAt ||
    manifest.slots.some((slot) => slot === null) ||
    untrackedCount !== manifest.outputsFailedBeforeHandoff
  ) {
    reportInvalidNativeOutput(
      context,
      ["phase"],
      "sealed manifest is incomplete"
    )
  }
}

function validateManifestLifecycle(
  manifest: ParsedManifest,
  context: z.RefinementCtx
): void {
  if (
    hasInvalidLifecycleTimestamp(
      manifest.settlementAcknowledgedAt,
      manifest.sealedAt
    )
  ) {
    reportInvalidNativeOutput(
      context,
      ["settlementAcknowledgedAt"],
      "settlement acknowledgement requires a monotonic sealed manifest"
    )
  }
  if (
    hasInvalidLifecycleTimestamp(
      manifest.dependencyReleasedAt,
      manifest.settlementAcknowledgedAt
    )
  ) {
    reportInvalidNativeOutput(
      context,
      ["dependencyReleasedAt"],
      "job dependency requires settlement acknowledgement"
    )
  }
}

function hasInvalidLifecycleTimestamp(
  timestamp: number | undefined,
  predecessor: number | undefined
): boolean {
  return (
    timestamp !== undefined &&
    (predecessor === undefined || timestamp < predecessor)
  )
}

const outputRecordInputSchema = z.strictObject({
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
    "outcome_unknown",
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

type ParsedOutputRecord = z.infer<typeof outputRecordInputSchema>
const outputRecordSchema: z.ZodType<NativeOutputRecord> =
  outputRecordInputSchema.superRefine(validateOutputRecord)

function validateOutputRecord(
  record: ParsedOutputRecord,
  context: z.RefinementCtx
): void {
  if (record.outputIndex >= record.outputCount) {
    reportInvalidNativeOutput(
      context,
      ["outputIndex"],
      "output index must be in range"
    )
  }
  validateOutputAcceptance(record, context)
  validateOutputHandoff(record, context)
  validateOutputTerminalTime(record, context)
  validateOutputErasure(record, context)
  validateOutputAccounting(record, context)
  const hasConsumptionEvidence = hasRecordedBlobConsumption(record)
  validateOutputBlobRelease(record, hasConsumptionEvidence, context)
  validateOutputDependencyRelease(record, hasConsumptionEvidence, context)
}

function requiresNativeAcceptance(record: ParsedOutputRecord): boolean {
  return (
    record.phase === "acceptance_unknown" ||
    record.phase === "outcome_unknown" ||
    record.phase === "waiting" ||
    record.phase === "complete" ||
    (record.phase === "interrupted" && record.acceptanceStartedAt !== undefined)
  )
}

function validateOutputAcceptance(
  record: ParsedOutputRecord,
  context: z.RefinementCtx
): void {
  if (
    requiresNativeAcceptance(record) &&
    (record.acceptanceStartedAt === undefined ||
      record.acceptanceStartedAt < record.createdAt)
  ) {
    reportInvalidNativeOutput(
      context,
      ["acceptanceStartedAt"],
      "accepted phases require a monotonic acceptance timestamp"
    )
  }
  if (
    (record.phase === "prepared" || record.phase === "acceptance_unknown") &&
    (record.downloadId !== undefined || record.terminalAt !== undefined)
  ) {
    reportInvalidNativeOutput(
      context,
      ["phase"],
      "pre-acceptance phases cannot contain native result state"
    )
  }
}

function validateOutputHandoff(
  record: ParsedOutputRecord,
  context: z.RefinementCtx
): void {
  if (
    (record.phase === "waiting" || record.phase === "complete") &&
    record.downloadId === undefined
  ) {
    reportInvalidNativeOutput(
      context,
      ["downloadId"],
      "accepted output phase requires downloadId"
    )
  }
  if (
    (record.phase === "waiting" || record.phase === "outcome_unknown") &&
    record.terminalAt !== undefined
  ) {
    reportInvalidNativeOutput(
      context,
      ["terminalAt"],
      "waiting output cannot be terminal"
    )
  }
}

function validateOutputTerminalTime(
  record: ParsedOutputRecord,
  context: z.RefinementCtx
): void {
  if (
    (isNativeOutputTerminal(record) || record.terminalAt !== undefined) &&
    (record.terminalAt === undefined ||
      record.terminalAt < record.createdAt ||
      (record.acceptanceStartedAt !== undefined &&
        record.terminalAt < record.acceptanceStartedAt))
  ) {
    reportInvalidNativeOutput(
      context,
      ["terminalAt"],
      "terminal output requires a monotonic terminal timestamp"
    )
  }
}

function validateOutputErasure(
  record: ParsedOutputRecord,
  context: z.RefinementCtx
): void {
  if (record.erasedAt !== undefined && record.downloadId === undefined) {
    reportInvalidNativeOutput(
      context,
      ["erasedAt"],
      "erased observation requires downloadId"
    )
  }
  if (hasInvalidLifecycleTimestamp(record.erasedByBrowserAt, record.erasedAt)) {
    reportInvalidNativeOutput(
      context,
      ["erasedByBrowserAt"],
      "browser erasure requires a monotonic erased observation"
    )
  }
}

function validateOutputAccounting(
  record: ParsedOutputRecord,
  context: z.RefinementCtx
): void {
  if (
    record.accountingDisposition === "pending" &&
    record.accountingDispositionAt !== undefined
  ) {
    reportInvalidNativeOutput(
      context,
      ["accountingDispositionAt"],
      "pending accounting cannot have a disposition timestamp"
    )
  }
  if (
    record.accountingDisposition !== "pending" &&
    (!canAccountNativeOutput(record) ||
      record.accountingDispositionAt === undefined)
  ) {
    reportInvalidNativeOutput(
      context,
      ["accountingDisposition"],
      "accounting disposition requires a resolved output outcome"
    )
  }
}

function hasRecordedBlobConsumption(record: ParsedOutputRecord): boolean {
  return (
    canReleaseNativeOutputBlob(record) ||
    ((record.phase === "waiting" || record.phase === "outcome_unknown") &&
      record.erasedAt !== undefined)
  )
}

function validateOutputBlobRelease(
  record: ParsedOutputRecord,
  hasConsumptionEvidence: boolean,
  context: z.RefinementCtx
): void {
  if (
    record.blobReleasedAt !== undefined &&
    (record.blobReleasedAt < record.createdAt || !hasConsumptionEvidence)
  ) {
    reportInvalidNativeOutput(
      context,
      ["blobReleasedAt"],
      "Blob release requires browser consumption evidence after preparation"
    )
  }
}

function validateOutputDependencyRelease(
  record: ParsedOutputRecord,
  hasConsumptionEvidence: boolean,
  context: z.RefinementCtx
): void {
  if (
    record.dependencyReleasedAt !== undefined &&
    (!hasConsumptionEvidence ||
      record.accountingDisposition === "pending" ||
      record.blobReleasedAt === undefined ||
      record.dependencyReleasedAt < record.blobReleasedAt)
  ) {
    reportInvalidNativeOutput(
      context,
      ["dependencyReleasedAt"],
      "dependency release requires resolved accounting and Blob release"
    )
  }
}

const nativeOutputStateInputSchema = z.strictObject({
  manifestsByJobId: z.record(z.string(), manifestSchema),
  outputsByOutputId: z.record(z.string(), outputRecordSchema),
})

type ParsedNativeOutputState = z.infer<typeof nativeOutputStateInputSchema>
const nativeOutputStateSchema: z.ZodType<NativeOutputState> =
  nativeOutputStateInputSchema.superRefine(validateNativeOutputState)

function validateNativeOutputState(
  state: ParsedNativeOutputState,
  context: z.RefinementCtx
): void {
  const blobUrls = new Map<string, string>()
  const downloadIds = new Map<number, string>()
  const trackedOutputIds = new Set<string>()
  for (const [jobKey, manifest] of Object.entries(state.manifestsByJobId)) {
    validateManifestStateEntry(
      state,
      jobKey,
      manifest,
      trackedOutputIds,
      context
    )
  }
  for (const [outputKey, record] of Object.entries(state.outputsByOutputId)) {
    validateOutputStateEntry(
      outputKey,
      record,
      trackedOutputIds,
      blobUrls,
      downloadIds,
      context
    )
  }
}

function validateManifestStateEntry(
  state: ParsedNativeOutputState,
  jobKey: string,
  manifest: ParsedManifest,
  trackedOutputIds: Set<string>,
  context: z.RefinementCtx
): void {
  if (jobKey !== manifest.jobId) {
    reportInvalidNativeOutput(
      context,
      ["manifestsByJobId", jobKey, "jobId"],
      "manifest key must match jobId"
    )
  }
  manifest.slots.forEach((slot, outputIndex) => {
    validateTrackedSlot(
      state,
      jobKey,
      manifest,
      slot,
      outputIndex,
      trackedOutputIds,
      context
    )
  })
  validateManifestSettlement(state, jobKey, manifest, context)
  validateManifestDependencyRelease(state, jobKey, manifest, context)
}

function validateTrackedSlot(
  state: ParsedNativeOutputState,
  jobKey: string,
  manifest: ParsedManifest,
  slot: ParsedManifest["slots"][number],
  outputIndex: number,
  trackedOutputIds: Set<string>,
  context: z.RefinementCtx
): void {
  if (slot?.disposition !== "tracked") return
  const path = ["manifestsByJobId", jobKey, "slots", outputIndex]
  if (trackedOutputIds.has(slot.outputId)) {
    reportInvalidNativeOutput(
      context,
      path,
      "outputId may occupy only one manifest slot"
    )
  }
  trackedOutputIds.add(slot.outputId)
  const record = state.outputsByOutputId[slot.outputId]
  if (record === undefined) {
    // A pruned sealed output is already fully released; open slots need records.
    if (manifest.phase === "open") {
      reportInvalidNativeOutput(
        context,
        path,
        "open manifest slots require their exact output record"
      )
    }
    return
  }
  if (
    !nativeOutputJobIdentityMatches(record, manifest) ||
    record.outputCount !== manifest.outputsRequested ||
    record.outputIndex !== outputIndex
  ) {
    reportInvalidNativeOutput(
      context,
      path,
      "tracked slot must reference its exact output identity"
    )
  }
}

function validateManifestSettlement(
  state: ParsedNativeOutputState,
  jobKey: string,
  manifest: ParsedManifest,
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
  ) {
    reportInvalidNativeOutput(
      context,
      ["manifestsByJobId", jobKey, "settlementAcknowledgedAt"],
      "settlement acknowledgement requires resolved output accounting"
    )
  }
}

function validateManifestDependencyRelease(
  state: ParsedNativeOutputState,
  jobKey: string,
  manifest: ParsedManifest,
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
  ) {
    reportInvalidNativeOutput(
      context,
      ["manifestsByJobId", jobKey, "dependencyReleasedAt"],
      "job dependency requires every tracked dependency release"
    )
  }
}

function validateOutputStateEntry(
  outputKey: string,
  record: ParsedOutputRecord,
  trackedOutputIds: ReadonlySet<string>,
  blobUrls: Map<string, string>,
  downloadIds: Map<number, string>,
  context: z.RefinementCtx
): void {
  if (outputKey !== record.outputId || !trackedOutputIds.has(outputKey)) {
    reportInvalidNativeOutput(
      context,
      ["outputsByOutputId", outputKey],
      "output key and manifest slot must match outputId"
    )
  }
  const blobOwner = blobUrls.get(record.blobUrl)
  if (blobOwner !== undefined) {
    reportInvalidNativeOutput(
      context,
      ["outputsByOutputId", outputKey, "blobUrl"],
      `blobUrl is already assigned to ${blobOwner}`
    )
  }
  blobUrls.set(record.blobUrl, record.outputId)
  if (record.downloadId !== undefined) {
    const downloadOwner = downloadIds.get(record.downloadId)
    if (downloadOwner !== undefined) {
      reportInvalidNativeOutput(
        context,
        ["outputsByOutputId", outputKey, "downloadId"],
        `downloadId is already assigned to ${downloadOwner}`
      )
    }
    downloadIds.set(record.downloadId, record.outputId)
  }
}

export function parseCurrentNativeOutputState(
  value: unknown
): NativeOutputState {
  if (value === undefined) return createEmptyNativeOutputState()
  return parseDurableState(
    nativeOutputStateSchema,
    value,
    "native output state"
  )
}

function parseManifest(value: unknown): NativeOutputManifest {
  return parseDurableState(manifestSchema, value, "native output manifest")
}

function parseOutputRecord(value: unknown): NativeOutputRecord {
  return parseDurableState(outputRecordSchema, value, "native output record")
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (typeof left !== "object" || typeof right !== "object") return false
  if (left === null || right === null) return false
  if (Array.isArray(left) !== Array.isArray(right)) return false
  const leftEntries = Object.entries(left)
  const rightEntries = Object.entries(right)
  if (leftEntries.length !== rightEntries.length) return false
  const rightByKey = new Map(rightEntries)
  return leftEntries.every(
    ([key, value]) =>
      rightByKey.has(key) && deepEqual(value, rightByKey.get(key))
  )
}

/** Drop fully released outputs and their completed manifests from the state. */
function pruneReleasedState(state: NativeOutputState): NativeOutputState {
  const retainedOutputIds = new Set(
    Object.values(state.outputsByOutputId)
      .filter((record) => record.dependencyReleasedAt === undefined)
      .map((record) => record.outputId)
  )
  const outputsByOutputId = Object.fromEntries(
    Object.entries(state.outputsByOutputId).filter(([outputId]) =>
      retainedOutputIds.has(outputId)
    )
  )
  const manifestsByJobId = Object.fromEntries(
    Object.entries(state.manifestsByJobId).filter(
      ([, manifest]) =>
        manifest.dependencyReleasedAt === undefined ||
        manifest.slots.some(
          (slot) =>
            slot?.disposition === "tracked" &&
            retainedOutputIds.has(slot.outputId)
        )
    )
  )
  return { manifestsByJobId, outputsByOutputId }
}

function buildIndex(state: NativeOutputState): NativeOutputStorageIndex {
  const downloadIdToOutputId: Record<string, string> = {}
  for (const record of Object.values(state.outputsByOutputId)) {
    if (record.downloadId === undefined) continue
    downloadIdToOutputId[String(record.downloadId)] = record.outputId
  }
  return {
    jobIds: Object.keys(state.manifestsByJobId),
    outputIds: Object.keys(state.outputsByOutputId),
    downloadIdToOutputId,
  }
}

function diffChangedValues(
  previous: NativeOutputState,
  next: NativeOutputState
): Record<string, unknown> {
  const changed: Record<string, unknown> = {}
  for (const [jobId, manifest] of Object.entries(next.manifestsByJobId)) {
    if (!deepEqual(previous.manifestsByJobId[jobId], manifest)) {
      changed[manifestStorageKey(jobId)] = manifest
    }
  }
  for (const [outputId, record] of Object.entries(next.outputsByOutputId)) {
    if (!deepEqual(previous.outputsByOutputId[outputId], record)) {
      changed[outputStorageKey(outputId)] = record
    }
  }
  if (Object.keys(changed).length > 0) {
    changed[INDEX_KEY] = buildIndex(next)
  }
  return changed
}

function diffRemovedKeys(
  previous: NativeOutputState,
  next: NativeOutputState
): string[] {
  const removed: string[] = []
  for (const jobId of Object.keys(previous.manifestsByJobId)) {
    if (next.manifestsByJobId[jobId] === undefined) {
      removed.push(manifestStorageKey(jobId))
    }
  }
  for (const outputId of Object.keys(previous.outputsByOutputId)) {
    if (next.outputsByOutputId[outputId] === undefined) {
      removed.push(outputStorageKey(outputId))
    }
  }
  return removed
}

export class NativeOutputRepository {
  private readonly mutations = new StorageMutationQueue()
  private hydrated = false
  private cache = createEmptyNativeOutputState()

  private invalidate(): void {
    this.hydrated = false
    this.cache = createEmptyNativeOutputState()
  }

  private async readIndex(): Promise<NativeOutputStorageIndex> {
    const stored = await chrome.storage.local.get(INDEX_KEY)
    const value = stored[INDEX_KEY]
    if (value === undefined) {
      return { jobIds: [], outputIds: [], downloadIdToOutputId: {} }
    }
    const parsed = nativeOutputStorageIndexSchema.safeParse(value)
    if (!parsed.success) {
      throw new InvalidDurableStateError(
        "Invalid durable native output index",
        { cause: parsed.error }
      )
    }
    return parsed.data
  }

  private async hydrateLocked(): Promise<NativeOutputState> {
    if (this.hydrated) return structuredClone(this.cache)
    try {
      const index = await this.readIndex()
      const keys = [
        ...index.jobIds.map(manifestStorageKey),
        ...index.outputIds.map(outputStorageKey),
      ]
      const stored =
        keys.length === 0 ? {} : await chrome.storage.local.get(keys)
      const manifestsByJobId: Record<string, NativeOutputManifest> = {}
      const outputsByOutputId: Record<string, NativeOutputRecord> = {}
      let staleIndexEntry = false
      for (const jobId of index.jobIds) {
        const value = stored[manifestStorageKey(jobId)]
        if (value === undefined) {
          staleIndexEntry = true
          continue
        }
        manifestsByJobId[jobId] = parseManifest(value)
      }
      for (const outputId of index.outputIds) {
        const value = stored[outputStorageKey(outputId)]
        if (value === undefined) {
          staleIndexEntry = true
          continue
        }
        outputsByOutputId[outputId] = parseOutputRecord(value)
      }
      this.cache = structuredClone(
        parseCurrentNativeOutputState({ manifestsByJobId, outputsByOutputId })
      )
      if (staleIndexEntry) {
        // Repair the durable index so cold starts stop reading absent keys.
        // A stale index that references absent records is safer than one that
        // omits still-live records, but it must be corrected durably here.
        await chrome.storage.local.set({
          [INDEX_KEY]: buildIndex(this.cache),
        })
      }
      this.hydrated = true
      return structuredClone(this.cache)
    } catch (error) {
      this.invalidate()
      throw error
    }
  }

  private async execute<TResult>(
    decide: (state: NativeOutputState) => NativeOutputKernelDecision<TResult>
  ): Promise<TResult> {
    return await this.mutations.run(async () => {
      const state = await this.hydrateLocked()
      const decision = decide(state)
      if (
        decision.result &&
        (decision.result as { outcome?: string }).outcome !== "applied"
      ) {
        return structuredClone(decision.result)
      }

      const candidate = structuredClone(
        parseCurrentNativeOutputState(decision.next)
      )
      const persisted = pruneReleasedState(candidate)
      const validated = structuredClone(
        parseCurrentNativeOutputState(persisted)
      )
      const changed = diffChangedValues(this.cache, validated)
      const removed = diffRemovedKeys(this.cache, validated)
      if (removed.length > 0 && !Object.hasOwn(changed, INDEX_KEY)) {
        // Removal-only pruning still changes the durable index: rewrite it so
        // cold starts never read keys that no longer exist.
        changed[INDEX_KEY] = buildIndex(validated)
      }
      try {
        if (removed.length > 0) {
          await chrome.storage.local.remove(removed)
        }
        if (Object.keys(changed).length > 0) {
          await chrome.storage.local.set(changed)
        }
      } catch (error) {
        this.invalidate()
        throw error
      }
      this.cache = validated
      this.hydrated = true
      return structuredClone(decision.result)
    })
  }

  async initialize(): Promise<void> {
    await this.mutations.run(async () => {
      this.invalidate()
      await this.hydrateLocked()
    })
  }

  async snapshot(): Promise<NativeOutputState> {
    return await this.mutations.run(async () =>
      structuredClone(await this.hydrateLocked())
    )
  }

  async getByOutputId(
    outputId: string
  ): Promise<NativeOutputRecord | undefined> {
    return await this.mutations.run(async () => {
      const stored = await chrome.storage.local.get(outputStorageKey(outputId))
      const value = stored[outputStorageKey(outputId)]
      return value === undefined ? undefined : parseOutputRecord(value)
    })
  }

  async getByDownloadId(
    downloadId: number
  ): Promise<NativeOutputRecord | undefined> {
    return await this.mutations.run(async () => {
      const index = await this.readIndex()
      const outputId = index.downloadIdToOutputId[String(downloadId)]
      if (outputId === undefined) return undefined
      const stored = await chrome.storage.local.get(outputStorageKey(outputId))
      const value = stored[outputStorageKey(outputId)]
      return value === undefined ? undefined : parseOutputRecord(value)
    })
  }

  async getManifest(jobId: string): Promise<NativeOutputManifest | undefined> {
    return await this.mutations.run(async () => {
      const stored = await chrome.storage.local.get(manifestStorageKey(jobId))
      const value = stored[manifestStorageKey(jobId)]
      return value === undefined ? undefined : parseManifest(value)
    })
  }

  async hasLiveDependencies(): Promise<boolean> {
    const state = await this.snapshot()
    return (
      Object.values(state.manifestsByJobId).length > 0 ||
      Object.values(state.outputsByOutputId).length > 0
    )
  }

  async ensureManifest(
    input: Parameters<typeof ensureNativeOutputManifest>[1]
  ): Promise<ReturnType<typeof ensureNativeOutputManifest>["result"]> {
    const detached = structuredClone(input)
    return await this.execute((state) =>
      ensureNativeOutputManifest(state, detached)
    )
  }

  async prepare(
    input: Parameters<typeof prepareNativeOutput>[1]
  ): Promise<ReturnType<typeof prepareNativeOutput>["result"]> {
    const detached = structuredClone(input)
    return await this.execute((state) => prepareNativeOutput(state, detached))
  }

  async sealManifest(
    input: Parameters<typeof sealNativeOutputManifest>[1]
  ): Promise<ReturnType<typeof sealNativeOutputManifest>["result"]> {
    const detached = structuredClone(input)
    return await this.execute((state) =>
      sealNativeOutputManifest(state, detached)
    )
  }

  async markAcceptanceUnknown(
    input: Parameters<typeof markNativeOutputAcceptanceUnknown>[1]
  ): Promise<ReturnType<typeof markNativeOutputAcceptanceUnknown>["result"]> {
    const detached = structuredClone(input)
    return await this.execute((state) =>
      markNativeOutputAcceptanceUnknown(state, detached)
    )
  }

  async attachDownload(
    input: Parameters<typeof attachNativeDownload>[1]
  ): Promise<ReturnType<typeof attachNativeDownload>["result"]> {
    const detached = structuredClone(input)
    return await this.execute((state) => attachNativeDownload(state, detached))
  }

  async interruptBeforeAcceptance(
    input: Parameters<typeof interruptNativeOutputBeforeAcceptance>[1]
  ): Promise<
    ReturnType<typeof interruptNativeOutputBeforeAcceptance>["result"]
  > {
    const detached = structuredClone(input)
    return await this.execute((state) =>
      interruptNativeOutputBeforeAcceptance(state, detached)
    )
  }

  async observePending(
    input: Parameters<typeof observeNativeDownloadPending>[1]
  ): Promise<ReturnType<typeof observeNativeDownloadPending>["result"]> {
    const detached = structuredClone(input)
    return await this.execute((state) =>
      observeNativeDownloadPending(state, detached)
    )
  }

  async markOutcomeUnknown(
    input: Parameters<typeof markNativeOutputOutcomeUnknown>[1]
  ): Promise<ReturnType<typeof markNativeOutputOutcomeUnknown>["result"]> {
    const detached = structuredClone(input)
    return await this.execute((state) =>
      markNativeOutputOutcomeUnknown(state, detached)
    )
  }

  async markTerminal(
    input: Parameters<typeof markNativeDownloadTerminal>[1]
  ): Promise<ReturnType<typeof markNativeDownloadTerminal>["result"]> {
    const detached = structuredClone(input)
    return await this.execute((state) =>
      markNativeDownloadTerminal(state, detached)
    )
  }

  async observeErased(
    input: Parameters<typeof observeNativeDownloadErased>[1]
  ): Promise<ReturnType<typeof observeNativeDownloadErased>["result"]> {
    const detached = structuredClone(input)
    return await this.execute((state) =>
      observeNativeDownloadErased(state, detached)
    )
  }

  async markAccountingDisposition(
    input: Parameters<typeof markNativeOutputAccountingDisposition>[1]
  ): Promise<
    ReturnType<typeof markNativeOutputAccountingDisposition>["result"]
  > {
    const detached = structuredClone(input)
    return await this.execute((state) =>
      markNativeOutputAccountingDisposition(state, detached)
    )
  }

  async markBlobReleased(
    input: Parameters<typeof markNativeOutputBlobReleased>[1]
  ): Promise<ReturnType<typeof markNativeOutputBlobReleased>["result"]> {
    const detached = structuredClone(input)
    return await this.execute((state) =>
      markNativeOutputBlobReleased(state, detached)
    )
  }

  async markDependencyReleased(
    input: Parameters<typeof markNativeOutputDependencyReleased>[1]
  ): Promise<ReturnType<typeof markNativeOutputDependencyReleased>["result"]> {
    const detached = structuredClone(input)
    return await this.execute((state) =>
      markNativeOutputDependencyReleased(state, detached)
    )
  }

  async markJobDependencyReleased(
    input: Parameters<typeof markNativeOutputJobDependencyReleased>[1]
  ): Promise<
    ReturnType<typeof markNativeOutputJobDependencyReleased>["result"]
  > {
    const detached = structuredClone(input)
    return await this.execute((state) =>
      markNativeOutputJobDependencyReleased(state, detached)
    )
  }

  async acknowledgeSettlement(
    input: Parameters<typeof acknowledgeNativeOutputSettlement>[1]
  ): Promise<ReturnType<typeof acknowledgeNativeOutputSettlement>["result"]> {
    const detached = structuredClone(input)
    return await this.execute((state) =>
      acknowledgeNativeOutputSettlement(state, detached)
    )
  }
}
