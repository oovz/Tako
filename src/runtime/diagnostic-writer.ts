import type { LogLevel } from "@/src/shared/download-contract"
import {
  appendDiagnosticEntries,
  prepareDiagnosticEntry,
  type DiagnosticContext,
  type DiagnosticEntry,
} from "./diagnostic-store"

const MAX_PENDING_ENTRIES = 64

function correlation(
  details: unknown
): Pick<DiagnosticEntry, "taskId" | "chapterId"> {
  if (!details || typeof details !== "object") return {}
  const fields = details as Record<string, unknown>
  function id(value: unknown): string | undefined {
    return typeof value === "string" && value.length <= 256 ? value : undefined
  }
  return {
    taskId: id(fields.taskId),
    chapterId: id(fields.chapterId),
  }
}

export function createDiagnosticWriter(context: DiagnosticContext) {
  const incarnationId = crypto.randomUUID()
  let sequence = 0
  let pending: ReturnType<typeof prepareDiagnosticEntry>[] = []
  let activeCount = 0
  let drain: Promise<void> | undefined

  async function writePending(): Promise<void> {
    while (pending.length > 0) {
      const batch = pending
      pending = []
      activeCount = batch.length
      try {
        await appendDiagnosticEntries(batch)
      } catch {
        // Console output is already available. A failed batch is best effort.
      } finally {
        activeCount = 0
      }
    }
  }

  function record(
    level: LogLevel,
    message: string,
    details: unknown,
    capturedAt: number
  ): void {
    if (pending.length + activeCount >= MAX_PENDING_ENTRIES) return
    try {
      sequence += 1
      pending.push(
        prepareDiagnosticEntry({
          id: `${incarnationId}:${String(sequence).padStart(16, "0")}`,
          incarnationId,
          sequence,
          context,
          capturedAt,
          level,
          message,
          details,
          ...correlation(details),
        })
      )
      void startDrain()
    } catch {
      // Serialization failures must not affect the caller.
    }
  }

  function startDrain() {
    drain ??= Promise.resolve()
      .then(writePending)
      .finally(() => {
        drain = undefined
        if (pending.length) void startDrain()
      })
    return drain
  }

  async function flush(): Promise<void> {
    while (drain) await drain
  }

  return { record, flush }
}
