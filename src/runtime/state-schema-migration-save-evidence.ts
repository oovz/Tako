import { z } from "zod"

import { rebuildSeriesHistory } from "@/src/domain/history/cleanup-policy"
import {
  composeDownloadedChapterKey,
  type DownloadedChapterRecord,
} from "@/src/domain/history/types"
import {
  nativeOutputJobIdentityMatches,
  type NativeOutputState,
} from "@/src/domain/native-output/state"
import { parseCurrentNativeOutputState } from "@/src/storage/native-output-repository"
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
import {
  nativeStorageKeys,
  parseNativeStorageIndex,
} from "./state-schema-migration-output"

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
  const index = parseNativeStorageIndex(stored[nativeStorageKeys.index])
  return parseCurrentNativeOutputState({
    manifestsByJobId: Object.fromEntries(
      index.jobIds.flatMap((id) => {
        const value = stored[nativeStorageKeys.manifestPrefix + id]
        return value === undefined ? [] : [[id, value]]
      })
    ),
    outputsByOutputId: Object.fromEntries(
      index.outputIds.flatMap((id) => {
        const value = stored[nativeStorageKeys.outputPrefix + id]
        return value === undefined ? [] : [[id, value]]
      })
    ),
  })
}

function confirmedAt(
  task: DownloadTaskState,
  chapter: TaskChapter,
  native: NativeOutputState
): number | undefined {
  if (chapter.status !== "completed") return undefined
  if (chapter.outputDestination === "fsa") return chapter.lastUpdated
  const settlement = chapter.nativeOutputSettlement
  if (
    !settlement ||
    settlement.taskId !== task.id ||
    settlement.chapterId !== chapter.id
  )
    return undefined
  const manifest = native.manifestsByJobId[settlement.jobId]
  if (
    !manifest ||
    manifest.phase !== "sealed" ||
    manifest.taskId !== task.id ||
    manifest.chapterId !== chapter.id ||
    manifest.attempt !== settlement.attempt ||
    manifest.outputsRequested <= 0 ||
    manifest.outputsRequested !== settlement.requested ||
    manifest.outputsFailedBeforeHandoff !== 0 ||
    manifest.slots.length !== manifest.outputsRequested
  )
    return undefined
  const times: number[] = []
  for (const slot of manifest.slots) {
    if (slot?.disposition !== "tracked") return undefined
    const output = native.outputsByOutputId[slot.outputId]
    if (
      !output ||
      !nativeOutputJobIdentityMatches(output, manifest) ||
      output.phase !== "complete" ||
      output.terminalAt === undefined
    )
      return undefined
    times.push(output.terminalAt)
  }
  return Math.max(...times)
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
  type SaveEvidence = {
    saveConfirmedAt: number
    outputDestination: "fsa" | "downloads-api"
  }
  const proofs = new Map<string, Map<number, SaveEvidence>>()
  const upgradeTask = (task: DownloadTaskState): DownloadTaskState => ({
    ...task,
    chapters: task.chapters.map((chapter) => {
      const saveConfirmedAt = confirmedAt(task, chapter, native)
      if (saveConfirmedAt !== undefined) {
        const key = composeDownloadedChapterKey(
          task.siteIntegrationId,
          task.mangaId,
          chapter.id
        )
        const byTime = proofs.get(key) ?? new Map<number, SaveEvidence>()
        byTime.set(chapter.lastUpdated, {
          saveConfirmedAt,
          outputDestination: chapter.outputDestination ?? "downloads-api",
        })
        proofs.set(key, byTime)
      }
      return {
        ...chapter,
        ...(saveConfirmedAt === undefined
          ? {}
          : {
              saveConfirmedAt,
              outputDestination: chapter.outputDestination ?? "downloads-api",
            }),
      }
    }),
  })
  const writes: Record<string, unknown> = {
    [LOCAL_STORAGE_KEYS.downloadQueue]: queue.map(upgradeTask),
    [LOCAL_STORAGE_KEYS.pendingUndoActions]: undo.map((action) => ({
      ...action,
      taskSnapshot: upgradeTask(action.taskSnapshot),
    })),
  }
  if (
    [
      LOCAL_STORAGE_KEYS.downloadedChapters,
      LOCAL_STORAGE_KEYS.seriesDownloadHistory,
      LOCAL_STORAGE_KEYS.downloadHistoryClearCutoffs,
    ].some((key) => key in stored)
  ) {
    const history = parseHistoryAggregate({
      downloadedChapters: stored[LOCAL_STORAGE_KEYS.downloadedChapters],
      seriesDownloadHistory: stored[LOCAL_STORAGE_KEYS.seriesDownloadHistory],
      clearCutoffs: stored[LOCAL_STORAGE_KEYS.downloadHistoryClearCutoffs],
    })
    const records = history.downloadedChapters.map((record) => {
      if (record.outputDestination === "fsa")
        return { ...record, saveConfirmedAt: record.downloadedAt }
      const proof = proofs
        .get(
          composeDownloadedChapterKey(
            record.siteIntegrationId,
            record.seriesId,
            record.chapterId
          )
        )
        ?.get(record.downloadedAt)
      return {
        ...record,
        ...(proof !== undefined &&
        (record.outputDestination === undefined ||
          record.outputDestination === proof.outputDestination)
          ? proof
          : {}),
      }
    })
    Object.assign(writes, {
      [LOCAL_STORAGE_KEYS.downloadedChapters]: records,
      [LOCAL_STORAGE_KEYS.seriesDownloadHistory]: rebuildSeriesHistory(records),
      [LOCAL_STORAGE_KEYS.downloadHistoryClearCutoffs]: history.clearCutoffs,
    })
  }
  return writes
}
