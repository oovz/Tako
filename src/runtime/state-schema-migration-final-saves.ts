import { z } from "zod"

import { parseCurrentNativeOutputState } from "@/src/storage/native-output-repository"
import { LOCAL_STORAGE_KEYS } from "./storage-keys"
import {
  DownloadTaskStateSchema,
  PendingUndoActionSchema,
} from "./queue-state-schemas"
import {
  Epoch6DownloadTaskStateSchema,
  Epoch6PendingUndoActionSchema,
} from "./state-schema-migration-task-destination-schemas"
import { parseEpoch5NativeOutputState } from "./state-schema-migration-native-schema"
import {
  nativeStorageKeys,
  parseNativeStorageIndex,
} from "./state-schema-migration-output"

function currentCategory(category: string | undefined) {
  return category === "browser_handoff_interrupted"
    ? "browser_output_unconfirmed"
    : category
}

function currentTask(task: z.infer<typeof Epoch6DownloadTaskStateSchema>) {
  return DownloadTaskStateSchema.parse({
    ...task,
    errorCategory: currentCategory(task.errorCategory),
    chapters: task.chapters.map((chapter) => {
      const previous = chapter.nativeOutputSettlement
      const settlement =
        previous &&
        (() => {
          const { acceptanceUncertain, ...rest } = previous
          return {
            ...rest,
            ...(acceptanceUncertain ? { outputUncertain: true } : {}),
            errorCategory: currentCategory(previous.errorCategory),
          }
        })()
      return {
        ...chapter,
        errorCategory: currentCategory(chapter.errorCategory),
        nativeOutputSettlement: settlement,
      }
    }),
  })
}

/** Converts initiation-era ownership without upgrading an already recorded outcome. */
export function buildFinalSaveWrites(
  stored: Record<string, unknown>
): Record<string, unknown> {
  const queue = z
    .array(Epoch6DownloadTaskStateSchema)
    .parse(
      stored[LOCAL_STORAGE_KEYS.downloadQueue] === undefined
        ? []
        : stored[LOCAL_STORAGE_KEYS.downloadQueue]
    )
  const undo = z
    .array(Epoch6PendingUndoActionSchema)
    .parse(
      stored[LOCAL_STORAGE_KEYS.pendingUndoActions] === undefined
        ? []
        : stored[LOCAL_STORAGE_KEYS.pendingUndoActions]
    )
  const writes: Record<string, unknown> = {
    [LOCAL_STORAGE_KEYS.downloadQueue]: queue.map(currentTask),
    [LOCAL_STORAGE_KEYS.pendingUndoActions]: undo.map((action) =>
      PendingUndoActionSchema.parse({
        ...action,
        taskSnapshot: currentTask(action.taskSnapshot),
      })
    ),
  }
  if (stored[nativeStorageKeys.index] === undefined) return writes
  const index = parseNativeStorageIndex(stored[nativeStorageKeys.index])
  const previous = parseEpoch5NativeOutputState({
    manifestsByJobId: Object.fromEntries(
      index.jobIds.flatMap((id) => {
        const raw = stored[nativeStorageKeys.manifestPrefix + id]
        return raw === undefined ? [] : [[id, raw]]
      })
    ),
    outputsByOutputId: Object.fromEntries(
      index.outputIds.flatMap((id) => {
        const raw = stored[nativeStorageKeys.outputPrefix + id]
        return raw === undefined ? [] : [[id, raw]]
      })
    ),
  })
  const state = parseCurrentNativeOutputState({
    manifestsByJobId: Object.fromEntries(
      Object.entries(previous.manifestsByJobId).map(([id, manifest]) => [
        id,
        { ...manifest, errorCategory: currentCategory(manifest.errorCategory) },
      ])
    ),
    outputsByOutputId: Object.fromEntries(
      Object.entries(previous.outputsByOutputId).map(([id, output]) => [
        id,
        {
          ...output,
          ...((output.phase === "waiting" &&
            (output.accountingDisposition !== "pending" ||
              output.erasedAt !== undefined)) ||
          output.phase === "handoff_interrupted"
            ? {
                phase: "outcome_unknown",
                error: "Chrome file-save outcome could not be established",
              }
            : {}),
        },
      ])
    ),
  })
  Object.assign(writes, {
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
  })
  return writes
}
