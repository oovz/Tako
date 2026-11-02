import { z } from "zod"

import type {
  ActiveDispatchLease,
  DownloadTaskState,
  PendingUndoAction,
} from "@/src/domain/queue/state"
import { parseDurableState } from "./durable-state-codecs"
import {
  ActiveDispatchLeaseSchema,
  DownloadTaskStateSchema,
  PendingUndoActionSchema,
} from "@/src/runtime/queue-state-schemas"

export function parseCurrentDownloadQueue(value: unknown): DownloadTaskState[] {
  return parseCurrentArray(DownloadTaskStateSchema, value, "download queue")
}

export function parseCurrentActiveDispatchLease(
  value: unknown
): ActiveDispatchLease | null {
  if (value === undefined || value === null) return null
  return parseDurableState(
    ActiveDispatchLeaseSchema,
    value,
    "active dispatch lease"
  )
}

export function parseCurrentPendingUndoActions(
  value: unknown
): PendingUndoAction[] {
  return parseCurrentArray(
    PendingUndoActionSchema,
    value,
    "pending Undo actions"
  )
}

function parseCurrentArray<T>(
  schema: z.ZodType<T>,
  value: unknown,
  description: string
): T[] {
  if (value === undefined) return []
  return parseDurableState(z.array(schema), value, description)
}
