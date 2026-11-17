// Lightweight structured logger for browser contexts
import {
  redactDiagnostic,
  redactDiagnosticText,
} from "@/src/runtime/diagnostic-redaction"

import type { LogLevel } from "@/src/shared/download-contract"
import type { DiagnosticContext } from "./diagnostic-store"
import { createDiagnosticWriter } from "./diagnostic-writer"

type BufferedDebugEntry = {
  msg: string
  data: unknown
  bufferedAt: number
  capturedAt: number
}

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

const DEFAULT_LOG_LEVEL: LogLevel = "warn"
const MAX_PENDING_DEBUG_ENTRIES = 50

let minLevel: LogLevel | null = null
let recoverPreference: (() => void) | undefined
let hasAppliedPersistedSettings = false
let pendingDebugEntries: BufferedDebugEntry[] = []
let writer: ReturnType<typeof createDiagnosticWriter> | undefined

export function startDiagnosticRecording(context: DiagnosticContext): void {
  writer ??= createDiagnosticWriter(context)
}

export async function flushDiagnostics(): Promise<void> {
  await writer?.flush()
}

export function setDiagnosticPreferenceRecovery(
  recover: () => void
): () => void {
  recoverPreference = recover
  return () => {
    if (recoverPreference === recover) recoverPreference = undefined
  }
}

function emit(
  level: LogLevel,
  message: string,
  details: unknown,
  timestamp: number
): void {
  const prefix = `[TMD] ${message}`
  if (details === undefined) console[level](prefix)
  else console[level](prefix, details)
  writer?.record(level, message, details, timestamp)
}

function appendPendingDebugEntry(msg: string, data: unknown): void {
  if (pendingDebugEntries.length >= MAX_PENDING_DEBUG_ENTRIES) {
    pendingDebugEntries.shift()
  }
  pendingDebugEntries.push({
    msg: redactDiagnosticText(msg),
    data: redactDiagnostic(data),
    bufferedAt: performance.now(),
    capturedAt: Date.now(),
  })
}

function addBufferedTiming(
  data: unknown,
  capturedAt: number
): Record<string, unknown> {
  const timing = {
    bufferedForMs: Math.round(performance.now() - capturedAt),
  }
  if (
    data &&
    typeof data === "object" &&
    !Array.isArray(data) &&
    !(data instanceof Error)
  ) {
    return { ...(data as Record<string, unknown>), ...timing }
  }
  return data === undefined ? timing : { data, ...timing }
}

function flushPendingDebugEntries(): void {
  const entries = pendingDebugEntries
  pendingDebugEntries = []
  for (const entry of entries) {
    emit(
      "debug",
      entry.msg,
      addBufferedTiming(entry.data, entry.bufferedAt),
      entry.capturedAt
    )
  }
}

function settlePendingDebugEntries(): void {
  if (minLevel === "debug") {
    flushPendingDebugEntries()
    return
  }
  pendingDebugEntries = []
}

export function applyDiagnosticLogLevel(level: LogLevel | null): void {
  minLevel = level
  hasAppliedPersistedSettings = true
  settlePendingDebugEntries()
}

function shouldWrite(level: LogLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[minLevel ?? DEFAULT_LOG_LEVEL]
}

function write(level: LogLevel, msg: string, data?: unknown) {
  if (minLevel === null) recoverPreference?.()
  if (
    level === "debug" &&
    !hasAppliedPersistedSettings &&
    !shouldWrite(level)
  ) {
    appendPendingDebugEntry(msg, data)
    return
  }
  if (!shouldWrite(level)) return
  const capturedAt = Date.now()
  emit(level, redactDiagnosticText(msg), redactDiagnostic(data), capturedAt)
}

export const logger = {
  debug: (msg: string, data?: unknown) => write("debug", msg, data),
  info: (msg: string, data?: unknown) => write("info", msg, data),
  warn: (msg: string, data?: unknown) => write("warn", msg, data),
  error: (msg: string, data?: unknown) => write("error", msg, data),
}

export default logger
