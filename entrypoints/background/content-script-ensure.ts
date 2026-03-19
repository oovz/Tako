const CONTENT_SCRIPT_ENSURE_THROTTLE_MS = 1000

export interface ShouldSkipContentScriptEnsureOptions {
  lastAttemptTimestamp: number
  now: number
  force: boolean
}

export function shouldSkipContentScriptEnsure(
  options: ShouldSkipContentScriptEnsureOptions,
): boolean {
  const { lastAttemptTimestamp, now, force } = options

  if (force) {
    return false
  }

  return now - lastAttemptTimestamp < CONTENT_SCRIPT_ENSURE_THROTTLE_MS
}
