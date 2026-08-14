import { z } from "zod"

import {
  attachNativeDownload,
  ensureNativeOutputManifest,
  interruptNativeOutputBeforeAcceptance,
  markNativeDownloadTerminal,
  markNativeOutputAcceptanceUnknown,
  markNativeOutputAccountingDisposition,
  markNativeOutputBlobReleased,
  markNativeOutputDependencyReleased,
  markNativeOutputJobDependencyReleased,
  markNativeOutputSurrendered,
  observeNativeDownloadErased,
  prepareNativeOutput,
  sealNativeOutputManifest,
  type NativeOutputKernelDecision,
} from "@/src/domain/native-output/kernel"
import {
  createEmptyNativeOutputState,
  isNativeOutputLive,
  type NativeOutputManifest,
  type NativeOutputRecord,
  type NativeOutputState,
} from "@/src/domain/native-output/state"
import { InvalidDurableStateError } from "@/src/runtime/runtime-phase-errors"
import { StorageMutationQueue } from "./storage-mutation-queue"

/**
 * Native-output persistence layout.
 *
 * Live work is stored as one manifest key per job and one output key per
 * output, plus a small index mapping live IDs and download IDs. Fully
 * released records and manifests are pruned from storage, so startup
 * hydration and every transition touch only the currently active job instead
 * of an ever-growing whole-history document.
 *
 *   pendingOutputs:index            -> { jobIds, outputIds, downloadIdToOutputId }
 *   pendingOutputs:manifest:<jobId> -> NativeOutputManifest
 *   pendingOutputs:output:<outputId>-> NativeOutputRecord
 *
 * A fully released output has `dependencyReleasedAt` set; once every tracked
 * output of a job is released (or pruned), the manifest is pruned as well.
 * Absence of a record therefore means it was fully released, never that it
 * was lost: the queue task keeps the terminal accounting.
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

const manifestSchema: z.ZodType<NativeOutputManifest> = z
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
    sealedAt: nonnegativeFiniteNumber.optional(),
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
        manifest.sealedAt !== undefined ||
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
      manifest.dependencyReleasedAt !== undefined &&
      (manifest.sealedAt === undefined ||
        manifest.dependencyReleasedAt < manifest.sealedAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["dependencyReleasedAt"],
        message: "job dependency cannot precede manifest sealing",
      })
    }
  })

const outputRecordSchema: z.ZodType<NativeOutputRecord> = z
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
      "waiting",
      "complete",
      "interrupted",
      "surrendered",
    ]),
    createdAt: nonnegativeFiniteNumber,
    acceptanceStartedAt: nonnegativeFiniteNumber.optional(),
    downloadId: nonnegativeInteger.optional(),
    terminalAt: nonnegativeFiniteNumber.optional(),
    error: z.string().optional(),
    erasedAt: nonnegativeFiniteNumber.optional(),
    surrenderedAt: nonnegativeFiniteNumber.optional(),
    accountingDisposition: z.enum(["pending", "accounted", "not_owner"]),
    accountingDispositionAt: nonnegativeFiniteNumber.optional(),
    blobReleasedAt: nonnegativeFiniteNumber.optional(),
    dependencyReleasedAt: nonnegativeFiniteNumber.optional(),
  })
  .superRefine((record, context) => {
    const isTerminal =
      record.phase === "complete" || record.phase === "interrupted"
    const isSettled = isTerminal || record.phase === "surrendered"
    const requiresAcceptance =
      record.phase === "acceptance_unknown" ||
      record.phase === "waiting" ||
      record.phase === "complete" ||
      record.phase === "surrendered" ||
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
      (record.phase === "prepared" || record.phase === "acceptance_unknown") &&
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
      isTerminal &&
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
      record.surrenderedAt !== undefined &&
      (record.erasedAt === undefined || record.phase !== "surrendered")
    ) {
      context.addIssue({
        code: "custom",
        path: ["surrenderedAt"],
        message: "surrender requires an erased observation",
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
      (!isSettled || record.accountingDispositionAt === undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["accountingDisposition"],
        message: "accounting disposition requires a terminal output",
      })
    }
    if (
      record.blobReleasedAt !== undefined &&
      record.blobReleasedAt < record.createdAt
    ) {
      context.addIssue({
        code: "custom",
        path: ["blobReleasedAt"],
        message: "Blob release cannot precede preparation",
      })
    }
    if (
      record.dependencyReleasedAt !== undefined &&
      (!isSettled ||
        record.accountingDisposition === "pending" ||
        record.blobReleasedAt === undefined ||
        record.dependencyReleasedAt < record.blobReleasedAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["dependencyReleasedAt"],
        message:
          "dependency release requires terminal accounting and Blob release",
      })
    }
  })

const nativeOutputStateSchema: z.ZodType<NativeOutputState> = z
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

export function parseCurrentNativeOutputState(
  value: unknown
): NativeOutputState {
  if (value === undefined) return createEmptyNativeOutputState()
  const parsed = nativeOutputStateSchema.safeParse(value)
  if (!parsed.success) {
    throw new InvalidDurableStateError("Invalid durable native output state", {
      cause: parsed.error,
    })
  }
  return parsed.data
}

function parseManifest(value: unknown): NativeOutputManifest {
  const parsed = manifestSchema.safeParse(value)
  if (!parsed.success) {
    throw new InvalidDurableStateError(
      "Invalid durable native output manifest",
      {
        cause: parsed.error,
      }
    )
  }
  return parsed.data
}

function parseOutputRecord(value: unknown): NativeOutputRecord {
  const parsed = outputRecordSchema.safeParse(value)
  if (!parsed.success) {
    throw new InvalidDurableStateError("Invalid durable native output record", {
      cause: parsed.error,
    })
  }
  return parsed.data
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

  async listLiveOutputs(): Promise<NativeOutputRecord[]> {
    const state = await this.snapshot()
    return Object.values(state.outputsByOutputId).filter(isNativeOutputLive)
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

  async markSurrendered(
    input: Parameters<typeof markNativeOutputSurrendered>[1]
  ): Promise<ReturnType<typeof markNativeOutputSurrendered>["result"]> {
    const detached = structuredClone(input)
    return await this.execute((state) =>
      markNativeOutputSurrendered(state, detached)
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
}
