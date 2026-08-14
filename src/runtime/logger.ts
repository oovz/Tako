// Lightweight structured logger for browser contexts
// Simplified: uses only logLevel (no separate debugMode flag)
import type { AdvancedSettings } from "@/src/domain/settings/types"

type LogLevel = "debug" | "info" | "warn" | "error"

type LoggerConfig = {
  minLevel: LogLevel
}

type BufferedDebugEntry = {
  msg: string
  data: unknown
  capturedAt: number
}

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

// Ref: https://github.com/vitejs/vite/blob/main/docs/guide/env-and-mode.md
// Vite injects import.meta.env in extension builds. Playwright also imports
// runtime modules while collecting tests in Node, where that object is absent.
const IS_DEV_BUILD =
  typeof import.meta.env !== "undefined" && import.meta.env.DEV === true
const DEFAULT_LOG_LEVEL: LogLevel = IS_DEV_BUILD ? "debug" : "warn"
const MAX_PENDING_DEBUG_ENTRIES = 50

let forceDebug = false
let config: LoggerConfig = { minLevel: DEFAULT_LOG_LEVEL }
let hasAppliedPersistedSettings = false
let pendingDebugEntries: BufferedDebugEntry[] = []

function writeToConsole(level: LogLevel, msg: string, data?: unknown): void {
  const prefix = `[TMD] ${msg}`
  const payload = data !== undefined ? [prefix, data] : [prefix]
  switch (level) {
    case "debug":
      console.debug(...payload)
      return
    case "info":
      console.info(...payload)
      return
    case "warn":
      console.warn(...payload)
      return
    case "error":
      console.error(...payload)
      return
  }
}

function appendPendingDebugEntry(msg: string, data: unknown): void {
  if (pendingDebugEntries.length >= MAX_PENDING_DEBUG_ENTRIES) {
    pendingDebugEntries.shift()
  }
  pendingDebugEntries.push({ msg, data, capturedAt: performance.now() })
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
    writeToConsole(
      "debug",
      entry.msg,
      addBufferedTiming(entry.data, entry.capturedAt)
    )
  }
}

function settlePendingDebugEntries(): void {
  if (config.minLevel === "debug") {
    flushPendingDebugEntries()
    return
  }
  pendingDebugEntries = []
}

export function setLoggerForceDebug(value: boolean): void {
  forceDebug = !!value
  if (forceDebug) {
    config = { minLevel: "debug" }
    flushPendingDebugEntries()
  }
}

export function computeLoggerConfig(advanced?: AdvancedSettings): LoggerConfig {
  // Simplified: just use logLevel directly
  if (forceDebug) {
    return { minLevel: "debug" }
  }
  const minLevel: LogLevel = advanced?.logLevel ?? "warn"
  return { minLevel }
}

export function applyAdvancedLoggerSettings(advanced?: AdvancedSettings): void {
  config = computeLoggerConfig(advanced)
  hasAppliedPersistedSettings = true
  settlePendingDebugEntries()
}

export function configureLogger(next: Partial<LoggerConfig>): void {
  config = { ...config, ...next }
}

export function isDebugLoggingEnabled(): boolean {
  return config.minLevel === "debug"
}

function shouldWrite(level: LogLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[config.minLevel]
}

function write(level: LogLevel, msg: string, data?: unknown) {
  if (
    level === "debug" &&
    !hasAppliedPersistedSettings &&
    !forceDebug &&
    !shouldWrite(level)
  ) {
    appendPendingDebugEntry(msg, data)
    return
  }
  if (!shouldWrite(level)) return
  writeToConsole(level, msg, data)
}

export const logger = {
  debug: (msg: string, data?: unknown) => write("debug", msg, data),
  info: (msg: string, data?: unknown) => write("info", msg, data),
  warn: (msg: string, data?: unknown) => write("warn", msg, data),
  error: (msg: string, data?: unknown) => write("error", msg, data),
}

export default logger
