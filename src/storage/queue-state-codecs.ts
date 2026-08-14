import { z } from "zod"

import type {
  ActiveDispatchLease,
  DownloadTaskState,
  PendingUndoAction,
} from "@/src/domain/queue/state"
import { InvalidDurableStateError } from "@/src/runtime/runtime-phase-errors"
import {
  ActiveDispatchLeaseSchema,
  DownloadTaskStateSchema,
  PendingUndoActionSchema,
} from "@/src/runtime/queue-state-schemas"

function parseOrThrow<T>(
  schema: z.ZodType<T>,
  value: unknown,
  description: string
): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new InvalidDurableStateError(`Invalid durable ${description}`, {
      cause: parsed.error,
    })
  }
  return parsed.data
}

export function parseCurrentDownloadQueue(value: unknown): DownloadTaskState[] {
  if (value === undefined) return []
  return parseOrThrow(z.array(DownloadTaskStateSchema), value, "download queue")
}

export function parseCurrentActiveDispatchLease(
  value: unknown
): ActiveDispatchLease | null {
  if (value === undefined || value === null) return null
  return parseOrThrow(ActiveDispatchLeaseSchema, value, "active dispatch lease")
}

export function parseCurrentPendingUndoActions(
  value: unknown
): PendingUndoAction[] {
  if (value === undefined) return []
  return parseOrThrow(
    z.array(PendingUndoActionSchema),
    value,
    "pending Undo actions"
  )
}
