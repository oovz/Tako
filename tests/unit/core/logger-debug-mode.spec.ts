import { afterEach, describe, expect, it, vi } from "vitest"
import { applyDiagnosticLogLevel, logger } from "@/src/runtime/logger"

describe("debug logger output", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("writes Debug entries once the saved level enables them", () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {})
    applyDiagnosticLogLevel("warn")
    logger.debug("Debug filtered at Warning")
    applyDiagnosticLogLevel("debug")
    logger.debug("Debug enabled")
    expect(debug.mock.calls).toEqual([["[TMD] Debug enabled"]])
  })
})
