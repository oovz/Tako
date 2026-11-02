import { z } from "zod"

import { parseEpoch5NativeOutputState } from "./state-schema-migration-native-schema"
import { isRecord } from "@/src/shared/type-guards"

export const nativeStorageKeys = {
  index: "pendingOutputs:index",
  manifestPrefix: "pendingOutputs:manifest:",
  outputPrefix: "pendingOutputs:output:",
} as const

const NativeStorageIndexSchema = z.strictObject({
  jobIds: z.array(z.string().min(1)),
  outputIds: z.array(z.string().min(1)),
  downloadIdToOutputId: z.record(z.string().min(1), z.string().min(1)),
})

export function parseNativeStorageIndex(raw: unknown) {
  return NativeStorageIndexSchema.parse(
    raw === undefined
      ? { jobIds: [], outputIds: [], downloadIdToOutputId: {} }
      : raw
  )
}

const LegacySettlementSchema = z
  .strictObject({
    jobId: z.string().min(1),
    attempt: z.number().int().nonnegative(),
    taskId: z.string().min(1),
    chapterId: z.string().min(1),
    requested: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    interrupted: z.number().int().nonnegative(),
    surrendered: z.number().int().nonnegative(),
    lastSuccessfulDownloadId: z.number().int().nonnegative().optional(),
    appliedAt: z.number().finite().nonnegative(),
  })
  .refine(
    (value) =>
      value.completed + value.interrupted + value.surrendered ===
      value.requested
  )

function convertErrorCategory(raw: unknown): unknown {
  return raw === "browser_download_unobservable"
    ? "browser_handoff_interrupted"
    : raw
}

function convertSettlement(raw: unknown): unknown {
  if (!isRecord(raw) || !("surrendered" in raw)) return raw
  const { surrendered, ...settlement } = LegacySettlementSchema.parse(raw)
  return {
    ...settlement,
    interrupted: settlement.interrupted + surrendered,
    ...(surrendered > 0 ? { acceptanceUncertain: true } : {}),
  }
}

/** Removed representations are accepted only at this one-way conversion boundary. */
export function convertStoredTask(raw: unknown): unknown {
  if (!isRecord(raw)) return raw
  const { activeBlock, ...task } = raw
  return {
    ...task,
    activeBlock:
      activeBlock === "native_output_action_required" ? undefined : activeBlock,
    errorCategory: convertErrorCategory(task.errorCategory),
    chapters: Array.isArray(task.chapters)
      ? task.chapters.map((chapter: unknown) => {
          if (!isRecord(chapter)) return chapter
          return {
            ...chapter,
            errorCategory: convertErrorCategory(chapter.errorCategory),
            nativeOutputSettlement: convertSettlement(
              chapter.nativeOutputSettlement
            ),
          }
        })
      : task.chapters,
  }
}

function convertOutput(raw: unknown): unknown {
  if (!isRecord(raw) || raw.phase !== "surrendered") return raw
  const { surrenderedAt, ...record } = raw
  if (
    typeof surrenderedAt !== "number" ||
    !Number.isFinite(surrenderedAt) ||
    surrenderedAt < 0 ||
    typeof record.erasedAt !== "number" ||
    surrenderedAt < record.erasedAt ||
    record.terminalAt !== undefined
  )
    throw new Error("Invalid surrendered native output")
  return { ...record, phase: "waiting" }
}

function indexedNativeRecords(
  stored: Record<string, unknown>,
  ids: string[],
  prefix: string
) {
  return Object.fromEntries(
    ids.flatMap((id) => {
      const value = stored[prefix + id]
      return value === undefined ? [] : [[id, value]]
    })
  )
}

/** Read the indexed documents; each migration validates its own historical epoch. */
export function readIndexedNativeState(
  stored: Record<string, unknown>,
  index = parseNativeStorageIndex(stored[nativeStorageKeys.index])
) {
  return {
    manifestsByJobId: indexedNativeRecords(
      stored,
      index.jobIds,
      nativeStorageKeys.manifestPrefix
    ),
    outputsByOutputId: indexedNativeRecords(
      stored,
      index.outputIds,
      nativeStorageKeys.outputPrefix
    ),
  }
}

type IndexedNativeState = {
  manifestsByJobId: Record<string, unknown>
  outputsByOutputId: Record<string, { downloadId?: number; outputId: string }>
}

/** Serialize an already validated epoch without interpreting its save evidence. */
export function nativeStateWrites(
  state: IndexedNativeState
): Record<string, unknown> {
  return {
    [nativeStorageKeys.index]: {
      jobIds: Object.keys(state.manifestsByJobId),
      outputIds: Object.keys(state.outputsByOutputId),
      downloadIdToOutputId: Object.fromEntries(
        Object.values(state.outputsByOutputId).flatMap((output) =>
          output.downloadId === undefined
            ? []
            : [[String(output.downloadId), output.outputId]]
        )
      ),
    },
    ...Object.fromEntries(
      Object.entries(state.manifestsByJobId).map(([id, manifest]) => [
        nativeStorageKeys.manifestPrefix + id,
        manifest,
      ])
    ),
    ...Object.fromEntries(
      Object.entries(state.outputsByOutputId).map(([id, output]) => [
        nativeStorageKeys.outputPrefix + id,
        output,
      ])
    ),
  }
}

function convertManifest(raw: unknown): unknown {
  if (!isRecord(raw)) throw new Error("Invalid native output manifest")
  // The former job-release receipt proves accounting acknowledgement, without proving a successful save.
  const manifest = { ...raw }
  if (
    manifest.dependencyReleasedAt !== undefined &&
    manifest.settlementAcknowledgedAt === undefined
  )
    manifest.settlementAcknowledgedAt = manifest.dependencyReleasedAt
  return manifest
}

/** Converts indexed records together so identity and resource invariants are validated. */
export function convertStoredNativeState(
  stored: Record<string, unknown>
): Record<string, unknown> {
  if (stored[nativeStorageKeys.index] === undefined) return {}
  const index = parseNativeStorageIndex(stored[nativeStorageKeys.index])
  if (
    new Set(index.jobIds).size !== index.jobIds.length ||
    new Set(index.outputIds).size !== index.outputIds.length
  )
    throw new Error("Native output index contains duplicate identities")
  const records = readIndexedNativeState(stored, index)
  const state = parseEpoch5NativeOutputState({
    outputsByOutputId: Object.fromEntries(
      Object.entries(records.outputsByOutputId).map(([id, raw]) => [
        id,
        convertOutput(raw),
      ])
    ),
    manifestsByJobId: Object.fromEntries(
      Object.entries(records.manifestsByJobId).map(([id, raw]) => [
        id,
        convertManifest(raw),
      ])
    ),
  })
  return nativeStateWrites(state)
}

export function validateNativeOutputMigrationWrites(
  writes: Record<string, unknown>,
  parseState: (raw: unknown) => {
    outputsByOutputId: Record<string, { downloadId?: number; outputId: string }>
  } = parseEpoch5NativeOutputState
): void {
  const index = parseNativeStorageIndex(writes[nativeStorageKeys.index])
  const keys = new Set([
    nativeStorageKeys.index,
    ...index.jobIds.map((id) => nativeStorageKeys.manifestPrefix + id),
    ...index.outputIds.map((id) => nativeStorageKeys.outputPrefix + id),
  ])
  if (
    Object.keys(writes).some(
      (key) => key.startsWith("pendingOutputs:") && !keys.has(key)
    )
  ) {
    throw new Error(
      "State migration journal contains an unindexed native output key"
    )
  }
  for (const key of keys)
    if (!Object.hasOwn(writes, key))
      throw new Error(
        "State migration journal is missing an indexed native output"
      )
  const state = parseState({
    manifestsByJobId: Object.fromEntries(
      index.jobIds.map((id) => [
        id,
        writes[nativeStorageKeys.manifestPrefix + id],
      ])
    ),
    outputsByOutputId: Object.fromEntries(
      index.outputIds.map((id) => [
        id,
        writes[nativeStorageKeys.outputPrefix + id],
      ])
    ),
  })
  const mapped = Object.fromEntries(
    Object.values(state.outputsByOutputId).flatMap((output) =>
      output.downloadId === undefined
        ? []
        : [[String(output.downloadId), output.outputId]]
    )
  )
  if (
    Object.keys(mapped).length !==
      Object.keys(index.downloadIdToOutputId).length ||
    Object.entries(mapped).some(
      ([id, outputId]) => index.downloadIdToOutputId[id] !== outputId
    )
  ) {
    throw new Error(
      "State migration journal native download index does not match its records"
    )
  }
}
