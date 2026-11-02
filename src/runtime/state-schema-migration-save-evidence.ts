import { z } from "zod"

import { rebuildSeriesHistory } from "@/src/domain/history/cleanup-policy"
import {
  composeDownloadedChapterKey,
  type DownloadedChapterRecord,
} from "@/src/domain/history/types"
import { nativeOutputJobIdentityMatches } from "@/src/domain/native-output/state"
import { parseEpoch5NativeOutputState } from "./state-schema-migration-native-schema"
type NativeOutputState = ReturnType<typeof parseEpoch5NativeOutputState>
import { LOCAL_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import {
  DownloadTaskStateSchema,
  PendingUndoActionSchema,
} from "./state-schema-migration-queue-schemas"
import {
  DownloadedChapterRecordSchema,
  SeriesDownloadHistorySchema,
  parseHistoryAggregate,
} from "./state-schema-migration-history-schema"
import { readIndexedNativeState } from "./state-schema-migration-output"

const confirmationSchema = z.number().finite().nonnegative().optional()
const ChapterSchema = DownloadTaskStateSchema.shape.chapters.element.extend({
  saveConfirmedAt: confirmationSchema,
})
export const Epoch5DownloadTaskStateSchema = DownloadTaskStateSchema.safeExtend(
  {
    chapters: z.array(ChapterSchema),
  }
)
export const Epoch5PendingUndoActionSchema = PendingUndoActionSchema.safeExtend(
  {
    taskSnapshot: Epoch5DownloadTaskStateSchema,
  }
)
type DownloadTaskState = z.infer<typeof Epoch5DownloadTaskStateSchema>
type TaskChapter = DownloadTaskState["chapters"][number]

const RecordSchema = DownloadedChapterRecordSchema.extend({
  saveConfirmedAt: confirmationSchema,
})
const SeriesSchema = SeriesDownloadHistorySchema.extend({
  downloadedChapters: z.array(RecordSchema),
})

export function validateSaveEvidenceHistory(
  raw: Record<string, unknown>
): void {
  const records = z.array(RecordSchema).parse(raw.downloadedChapters)
  const series = z
    .record(z.string().min(1), SeriesSchema)
    .parse(raw.seriesDownloadHistory)
  const stripProof = (record: DownloadedChapterRecord) => {
    const copy = { ...record }
    delete copy.saveConfirmedAt
    return copy
  }
  parseHistoryAggregate({
    downloadedChapters: records.map(stripProof),
    seriesDownloadHistory: Object.fromEntries(
      Object.entries(series).map(([key, value]) => [
        key,
        {
          ...value,
          downloadedChapters: value.downloadedChapters.map(stripProof),
        },
      ])
    ),
    clearCutoffs: raw.clearCutoffs,
  })
  const expected = rebuildSeriesHistory(records)
  for (const key of Object.keys(expected)) {
    if (JSON.stringify(series[key]) !== JSON.stringify(expected[key])) {
      throw new Error(
        "Stored history save evidence diverges between aggregates"
      )
    }
  }
}

export function readEpoch5NativeOutputState(
  stored: Record<string, unknown>
): NativeOutputState {
  return parseEpoch5NativeOutputState(readIndexedNativeState(stored))
}

type NativeManifest = NativeOutputState["manifestsByJobId"][string]
type NativeSlot = NativeManifest["slots"][number]
type NativeSettlement = NonNullable<TaskChapter["nativeOutputSettlement"]>

function matchesChapter(
  reference: { taskId: string; chapterId: string } | undefined,
  task: DownloadTaskState,
  chapter: TaskChapter
): boolean {
  return (
    reference !== undefined &&
    reference.taskId === task.id &&
    reference.chapterId === chapter.id
  )
}

function confirmsRequestedBatch(
  manifest: NativeManifest,
  settlement: NativeSettlement
): boolean {
  return (
    manifest.phase === "sealed" &&
    manifest.attempt === settlement.attempt &&
    manifest.outputsRequested > 0 &&
    manifest.outputsRequested === settlement.requested &&
    manifest.outputsFailedBeforeHandoff === 0 &&
    manifest.slots.length === manifest.outputsRequested
  )
}

function confirmedOutputTime(
  slot: NativeSlot,
  manifest: NativeManifest,
  native: NativeOutputState
): number | undefined {
  if (slot?.disposition !== "tracked") return undefined
  const output = native.outputsByOutputId[slot.outputId]
  if (
    !output ||
    !nativeOutputJobIdentityMatches(output, manifest) ||
    output.phase !== "complete"
  )
    return undefined
  return output.terminalAt
}

function confirmedBatchTime(
  manifest: NativeManifest,
  native: NativeOutputState
): number | undefined {
  const times: number[] = []
  for (const slot of manifest.slots) {
    const time = confirmedOutputTime(slot, manifest, native)
    if (time === undefined) return undefined
    times.push(time)
  }
  return Math.max(...times)
}

function confirmedAt(
  task: DownloadTaskState,
  chapter: TaskChapter,
  native: NativeOutputState
): number | undefined {
  if (chapter.status !== "completed") return undefined
  if (chapter.outputDestination === "fsa") return chapter.lastUpdated
  const settlement = chapter.nativeOutputSettlement
  if (!settlement || !matchesChapter(settlement, task, chapter))
    return undefined
  const manifest = native.manifestsByJobId[settlement.jobId]
  if (
    !manifest ||
    !matchesChapter(manifest, task, chapter) ||
    !confirmsRequestedBatch(manifest, settlement)
  )
    return undefined
  return confirmedBatchTime(manifest, native)
}

type SaveEvidence = {
  saveConfirmedAt: number
  outputDestination: "fsa" | "downloads-api"
}
type Proofs = Map<string, Map<number, SaveEvidence>>

function upgradeTaskSaveEvidence(
  task: DownloadTaskState,
  native: NativeOutputState,
  proofs: Proofs
): DownloadTaskState {
  return {
    ...task,
    chapters: task.chapters.map((chapter) => {
      const saveConfirmedAt = confirmedAt(task, chapter, native)
      if (saveConfirmedAt === undefined) return { ...chapter }
      const key = composeDownloadedChapterKey(
        task.siteIntegrationId,
        task.mangaId,
        chapter.id
      )
      const byTime = proofs.get(key) ?? new Map<number, SaveEvidence>()
      const proof: SaveEvidence = {
        saveConfirmedAt,
        outputDestination: chapter.outputDestination ?? "downloads-api",
      }
      byTime.set(chapter.lastUpdated, proof)
      proofs.set(key, byTime)
      return { ...chapter, ...proof }
    }),
  }
}

function upgradeHistoryRecord(
  record: DownloadedChapterRecord,
  proofs: Proofs
): DownloadedChapterRecord {
  if (record.outputDestination === "fsa")
    return { ...record, saveConfirmedAt: record.downloadedAt }
  const key = composeDownloadedChapterKey(
    record.siteIntegrationId,
    record.seriesId,
    record.chapterId
  )
  const proof = proofs.get(key)?.get(record.downloadedAt)
  return {
    ...record,
    ...(proof !== undefined &&
    (record.outputDestination === undefined ||
      record.outputDestination === proof.outputDestination)
      ? proof
      : {}),
  }
}

function historySaveEvidenceWrites(
  stored: Record<string, unknown>,
  proofs: Proofs
): Record<string, unknown> {
  if (
    ![
      LOCAL_STORAGE_KEYS.downloadedChapters,
      LOCAL_STORAGE_KEYS.seriesDownloadHistory,
      LOCAL_STORAGE_KEYS.downloadHistoryClearCutoffs,
    ].some((key) => key in stored)
  )
    return {}
  const history = parseHistoryAggregate({
    downloadedChapters: stored[LOCAL_STORAGE_KEYS.downloadedChapters],
    seriesDownloadHistory: stored[LOCAL_STORAGE_KEYS.seriesDownloadHistory],
    clearCutoffs: stored[LOCAL_STORAGE_KEYS.downloadHistoryClearCutoffs],
  })
  const records = history.downloadedChapters.map((record) =>
    upgradeHistoryRecord(record, proofs)
  )
  return {
    [LOCAL_STORAGE_KEYS.downloadedChapters]: records,
    [LOCAL_STORAGE_KEYS.seriesDownloadHistory]: rebuildSeriesHistory(records),
    [LOCAL_STORAGE_KEYS.downloadHistoryClearCutoffs]: history.clearCutoffs,
  }
}

export function buildSaveEvidenceWrites(
  stored: Record<string, unknown>
): Record<string, unknown> {
  const queue = z
    .array(DownloadTaskStateSchema)
    .parse(
      stored[LOCAL_STORAGE_KEYS.downloadQueue] === undefined
        ? []
        : stored[LOCAL_STORAGE_KEYS.downloadQueue]
    )
  const undo = z
    .array(PendingUndoActionSchema)
    .parse(
      stored[LOCAL_STORAGE_KEYS.pendingUndoActions] === undefined
        ? []
        : stored[LOCAL_STORAGE_KEYS.pendingUndoActions]
    )
  const native = readEpoch5NativeOutputState(stored)
  const proofs: Proofs = new Map()
  const writes: Record<string, unknown> = {
    [LOCAL_STORAGE_KEYS.downloadQueue]: queue.map((task) =>
      upgradeTaskSaveEvidence(task, native, proofs)
    ),
    [LOCAL_STORAGE_KEYS.pendingUndoActions]: undo.map((action) => ({
      ...action,
      taskSnapshot: upgradeTaskSaveEvidence(
        action.taskSnapshot,
        native,
        proofs
      ),
    })),
  }
  Object.assign(writes, historySaveEvidenceWrites(stored, proofs))
  return writes
}
