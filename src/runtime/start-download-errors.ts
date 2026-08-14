import { z } from "zod"

/**
 * Typed, stable START_DOWNLOAD failure codes. The UI maps each code to a
 * localized, actionable message; raw exception strings never cross the
 * runtime-message boundary for this command.
 */
export const START_DOWNLOAD_FAILURE_CODES = [
  "stale_series_context",
  "invalid_chapter_selection",
  "integration_disabled",
  "host_permission_required",
  "durable_state_failure",
] as const

export type StartDownloadFailureCode =
  (typeof START_DOWNLOAD_FAILURE_CODES)[number]

export const StartDownloadFailureCodeSchema = z.enum(
  START_DOWNLOAD_FAILURE_CODES
)

/** Background-raised rejection with a stable, contract-level code. */
export class StartDownloadRejectedError extends Error {
  readonly code: StartDownloadFailureCode

  constructor(code: StartDownloadFailureCode, message: string) {
    super(message)
    this.name = "StartDownloadRejectedError"
    this.code = code
  }
}
