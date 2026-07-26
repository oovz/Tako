import { beforeEach, describe, expect, it, vi } from "vitest"

describe("logger startup debug receipts", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it("flushes buffered debug receipts once after debug settings load", async () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {})
    const { applyAdvancedLoggerSettings, configureLogger, logger } =
      await import("@/src/runtime/logger")

    configureLogger({ minLevel: "warn" })
    logger.debug("[navigation] Active tab changed", {
      phase: "received",
      tabId: 7,
    })

    expect(debugSpy).not.toHaveBeenCalled()

    applyAdvancedLoggerSettings({
      logLevel: "debug",
      storageCleanupDays: 30,
    })

    expect(debugSpy).toHaveBeenCalledTimes(1)
    expect(debugSpy).toHaveBeenCalledWith(
      "[TMD] [navigation] Active tab changed",
      expect.objectContaining({
        phase: "received",
        tabId: 7,
        bufferedForMs: expect.any(Number),
      })
    )

    applyAdvancedLoggerSettings({
      logLevel: "debug",
      storageCleanupDays: 30,
    })
    expect(debugSpy).toHaveBeenCalledTimes(1)
  })

  it("discards pre-configuration receipts when settings do not enable debug", async () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {})
    const { applyAdvancedLoggerSettings, configureLogger, logger } =
      await import("@/src/runtime/logger")

    configureLogger({ minLevel: "warn" })
    logger.debug("stale startup receipt")

    applyAdvancedLoggerSettings({
      logLevel: "info",
      storageCleanupDays: 30,
    })
    applyAdvancedLoggerSettings({
      logLevel: "debug",
      storageCleanupDays: 30,
    })

    expect(debugSpy).not.toHaveBeenCalled()
  })
})
