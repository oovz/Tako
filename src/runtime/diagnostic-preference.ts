import { LogLevelSchema, type LogLevel } from "@/src/shared/download-contract"
import logger, {
  applyDiagnosticLogLevel,
  setDiagnosticPreferenceRecovery,
} from "./logger"
import { sendRuntimeMessage } from "./send-runtime-message"
import { SETTINGS_STORAGE_KEYS } from "./storage-keys"

const settingsKey = SETTINGS_STORAGE_KEYS.global
const PREFERENCE_RETRY_INTERVAL_MS = 1_000
const listeners = new Set<() => void>()
let preference: LogLevel | null = null
let hasReportedFallback = false
let offscreenRead = 0

function parsePreference(value: unknown): LogLevel | null {
  const settings = value as { advanced?: { logLevel?: unknown } } | undefined
  const level = LogLevelSchema.safeParse(settings?.advanced?.logLevel)
  return level.success ? level.data : null
}

function updatePreference(next: LogLevel | null): void {
  applyDiagnosticLogLevel(next)
  if (next === null && !hasReportedFallback) {
    hasReportedFallback = true
    logger.warn("Saved logging level unavailable. Recording Warning and Error.")
  } else if (next !== null) {
    hasReportedFallback = false
  }
  if (next === preference) return
  preference = next
  if (next !== null) logger.debug("Saved diagnostic logging level applied")
  for (const listener of listeners) listener()
}

export const getDiagnosticPreference = () => preference
export function subscribeToDiagnosticPreference(
  listener: () => void
): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export async function readStoredDiagnosticPreference(): Promise<LogLevel | null> {
  try {
    const stored = await chrome.storage.local.get(settingsKey)
    return parsePreference(stored[settingsKey])
  } catch {
    return null
  }
}

function recoverPreferenceOnActivity(load: () => Promise<void>) {
  let nextAttempt = 0
  let pending = false
  const retry = () => {
    const now = performance.now()
    if (pending || preference !== null || now < nextAttempt) return
    pending = true
    nextAttempt = now + PREFERENCE_RETRY_INTERVAL_MS
    void load().finally(() => {
      pending = false
    })
  }
  const stop = setDiagnosticPreferenceRecovery(retry)
  retry()
  return { retry, stop }
}

export function trackOffscreenDiagnosticPreference(): void {
  recoverPreferenceOnActivity(refreshOffscreenDiagnosticPreference)
}

export function trackLocalDiagnosticPreference(
  onChange?: () => void
): () => void {
  let generation = 0
  let stopped = false
  const apply = async () => {
    const request = ++generation
    const level = await readStoredDiagnosticPreference()
    if (!stopped && request === generation) updatePreference(level)
  }
  const changed: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (
    changes,
    area
  ) => {
    if (area !== "local" || !(settingsKey in changes)) return
    generation += 1
    const change = changes[settingsKey]
    const level = parsePreference(change.newValue)
    updatePreference(level)
    if (level !== parsePreference(change.oldValue)) onChange?.()
  }
  chrome.storage?.onChanged?.addListener(changed)
  const recovery = recoverPreferenceOnActivity(apply)
  if (typeof window !== "undefined")
    window.addEventListener("focus", recovery.retry)
  return () => {
    stopped = true
    recovery.stop()
    if (typeof window !== "undefined")
      window.removeEventListener("focus", recovery.retry)
    chrome.storage?.onChanged?.removeListener(changed)
  }
}

export async function refreshOffscreenDiagnosticPreference(): Promise<void> {
  const request = ++offscreenRead
  let level: LogLevel | null = null
  try {
    const response = await sendRuntimeMessage({
      target: "background",
      type: "GET_DIAGNOSTIC_PREFERENCE",
    })
    if (response.success) level = response.level
  } catch {
    // The document continues to use the startup fallback until it can read a level.
  }
  if (request === offscreenRead) updatePreference(level)
}
