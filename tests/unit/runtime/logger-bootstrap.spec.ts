import { beforeEach, describe, expect, it, vi } from "vitest"

describe("logger startup debug receipts", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it("flushes buffered debug receipts once after debug settings load", async () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {})
    const { applyDiagnosticLogLevel, logger } =
      await import("@/src/runtime/logger")

    logger.debug("[navigation] Active tab changed", {
      phase: "received",
      tabId: 7,
    })

    expect(debugSpy).not.toHaveBeenCalled()

    applyDiagnosticLogLevel("debug")

    expect(debugSpy).toHaveBeenCalledTimes(1)
    expect(debugSpy).toHaveBeenCalledWith(
      "[TMD] [navigation] Active tab changed",
      expect.objectContaining({
        phase: "received",
        tabId: 7,
        bufferedForMs: expect.any(Number),
      })
    )

    applyDiagnosticLogLevel("debug")
    expect(debugSpy).toHaveBeenCalledTimes(1)
  })

  it("discards pre-configuration receipts when settings do not enable debug", async () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {})
    const { applyDiagnosticLogLevel, logger } =
      await import("@/src/runtime/logger")

    logger.debug("stale startup receipt")

    applyDiagnosticLogLevel("info")
    applyDiagnosticLogLevel("debug")

    expect(debugSpy).not.toHaveBeenCalled()
  })
})

describe("diagnostic preference startup filtering", () => {
  it("uses Warning until storage supplies a preference, then applies subsequent changes", async () => {
    vi.resetModules()
    const startup = Promise.withResolvers<Record<string, unknown>>()
    let changed!: Parameters<typeof chrome.storage.onChanged.addListener>[0]
    vi.stubGlobal("chrome", {
      storage: {
        local: { get: () => startup.promise },
        onChanged: {
          addListener: (listener: typeof changed) => {
            changed = listener
          },
          removeListener: vi.fn(),
        },
      },
    })
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const info = vi.spyOn(console, "info").mockImplementation(() => {})
    const { getDiagnosticPreference, trackLocalDiagnosticPreference } =
      await import("@/src/runtime/diagnostic-preference")
    const { logger } = await import("@/src/runtime/logger")
    try {
      const subscription = trackLocalDiagnosticPreference()
      try {
        logger.warn("startup warning")
        logger.info("startup info")
        expect(getDiagnosticPreference()).toBeNull()
        expect(warn).toHaveBeenCalledWith("[TMD] startup warning")
        expect(info).not.toHaveBeenCalled()

        changed(
          {
            "settings:global": { newValue: { advanced: { logLevel: "info" } } },
          },
          "local"
        )
        startup.resolve({
          "settings:global": { advanced: { logLevel: "error" } },
        })
        await vi.waitFor(() => expect(getDiagnosticPreference()).toBe("info"))
        await startup.promise
        logger.info("settings recovered")
        expect(info).toHaveBeenCalledWith("[TMD] settings recovered")

        changed(
          {
            "settings:global": {
              newValue: { advanced: { logLevel: "error" } },
            },
          },
          "local"
        )
        logger.warn("filtered warning")
        expect(warn).not.toHaveBeenCalledWith("[TMD] filtered warning")
      } finally {
        subscription()
      }
    } finally {
      vi.restoreAllMocks()
      vi.unstubAllGlobals()
    }
  })
})

it("recovers a readable saved preference during activity without a settings write", async () => {
  vi.resetModules()
  let clock = 0
  vi.spyOn(performance, "now").mockImplementation(() => clock)
  const debug = vi.spyOn(console, "debug").mockImplementation(() => {})
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
  const get = vi
    .fn()
    .mockRejectedValueOnce(new Error("Storage is starting"))
    .mockResolvedValue({
      "settings:global": { advanced: { logLevel: "debug" } },
    })
  vi.stubGlobal("chrome", {
    storage: {
      local: { get },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  })
  const { getDiagnosticPreference, trackLocalDiagnosticPreference } =
    await import("@/src/runtime/diagnostic-preference")
  const { logger } = await import("@/src/runtime/logger")
  const stop = trackLocalDiagnosticPreference()
  try {
    logger.debug("Debug entry during fallback")
    await vi.waitFor(() => expect(warn).toHaveBeenCalled())
    expect(get).toHaveBeenCalledTimes(1)
    expect(getDiagnosticPreference()).toBeNull()
    clock += 1_000
    logger.debug("Activity triggers a new preference read")
    await vi.waitFor(() => expect(getDiagnosticPreference()).toBe("debug"))
    logger.debug("Debug entry after recovery")
    expect(debug).not.toHaveBeenCalledWith("[TMD] Debug entry during fallback")
    expect(debug).toHaveBeenCalledWith("[TMD] Debug entry after recovery")
  } finally {
    stop()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  }
})
