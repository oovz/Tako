import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  applyAdvancedLoggerSettings,
  logger,
  setLoggerForceDebug,
} from "@/src/runtime/logger"
import type { AdvancedSettings } from "@/src/domain/settings/types"

const baseSettings: AdvancedSettings = {
  logLevel: "info",
  storageCleanupDays: 30,
}

const makeSettings = (
  overrides: Partial<AdvancedSettings>
): AdvancedSettings => ({
  ...baseSettings,
  ...overrides,
})

describe("logger", () => {
  let debugSpy: ReturnType<typeof vi.spyOn>
  let infoSpy: ReturnType<typeof vi.spyOn>
  let warnSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {})
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {})
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    setLoggerForceDebug(false)
    applyAdvancedLoggerSettings(baseSettings)
  })

  afterEach(() => {
    debugSpy.mockRestore()
    infoSpy.mockRestore()
    warnSpy.mockRestore()
    errorSpy.mockRestore()
    setLoggerForceDebug(false)
  })

  it("respects logLevel setting", () => {
    applyAdvancedLoggerSettings(makeSettings({ logLevel: "info" }))

    logger.debug("debug message")
    logger.info("info message")
    logger.warn("warn message")

    expect(debugSpy).not.toHaveBeenCalled()
    expect(infoSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })

  it("filters output based on logLevel", () => {
    applyAdvancedLoggerSettings(makeSettings({ logLevel: "error" }))

    logger.info("info message")
    logger.warn("warn message")
    logger.error("error message")

    expect(infoSpy).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalledTimes(1)
  })

  it("forces debug logging when debug is forced", () => {
    setLoggerForceDebug(true)
    applyAdvancedLoggerSettings(makeSettings({ logLevel: "error" }))

    logger.debug("debug message")
    logger.info("info message")

    expect(debugSpy).toHaveBeenCalledTimes(1)
    expect(infoSpy).toHaveBeenCalledTimes(1)
  })

  it("redacts diagnostic payloads before writing them to the console", () => {
    const secret = "SYNTHETIC_LOG_SECRET_MARKER"
    logger.error(
      `Request failed: https://provider.example/image.png?token=${secret}#${secret}`,
      {
        headers: { Authorization: `Bearer ${secret}` },
        cause: new Error(`C:\\Users\\test-user\\${secret}\\image.png`),
      }
    )

    const serialized = JSON.stringify(errorSpy.mock.calls[0])
    expect(serialized).not.toContain(secret)
    expect(serialized).toContain("[REDACTED_PATH]")
    expect(serialized).toContain("[REDACTED]")
  })

  it("redacts custom session-header tuples in structured and serialized payloads", () => {
    const secret = "SYNTHETIC_CUSTOM_SESSION_HEADER"
    logger.warn("provider diagnostic", {
      headers: [["x-provider-session", secret]],
      serialized: JSON.stringify([["x-provider-session", secret]]),
    })

    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain(secret)
  })

  it("redacts single and mixed custom-header pairs at the final logger boundary", () => {
    const secret = "SYNTHETIC_CUSTOM_SINGLE_PAIR"
    logger.warn("provider diagnostic", {
      pair: ["x-provider-session", secret],
      mixed: [["x-provider-session", secret], { stage: "fetch" }],
      serializedPair: JSON.stringify(["x-provider-session", secret]),
    })

    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain(secret)
  })

  it("contains unreadable header tuple cells at the logger boundary", () => {
    const pair: unknown[] = [
      "x-provider-session",
      "SYNTHETIC_UNREADABLE_HEADER",
    ]
    Object.defineProperty(pair, 0, {
      configurable: true,
      get: () => {
        throw new Error("unreadable retained tuple cell")
      },
    })

    expect(() => logger.warn("provider diagnostic", pair)).not.toThrow()
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain(
      "SYNTHETIC_UNREADABLE_HEADER"
    )
  })

  it.each([
    "Authorization: Bearer SYNTHETIC_OPAQUE_SECRET",
    "Proxy-Authorization = Basic SYNTHETIC_OPAQUE_SECRET",
    "request failed; access_token=SYNTHETIC_OPAQUE_SECRET",
    '{"access\\u0054oken":"SYNTHETIC_OPAQUE_SECRET","stage":"fetch"}',
    '{"headers":{"x-provider-session":"SYNTHETIC_OPAQUE_SECRET"}}',
    '{"responseBody":"SYNTHETIC_OPAQUE_SECRET"}',
    '{"password":"SYNTHETIC_OPAQUE_SECRET"',
    '"access\\u0054oken\\u003dSYNTHETIC_OPAQUE_SECRET"',
    '[["Authorization","SYNTHETIC_OPAQUE_SECRET"]]',
    "x-provider-session: SYNTHETIC_OPAQUE_SECRET",
    "X-Custom-Credential: SYNTHETIC_OPAQUE_SECRET",
  ])(
    "omits opaque credential values from final console output: %s",
    (value) => {
      const error = new Error(value, { cause: value })
      logger.warn("Provider resolution failed", {
        stage: "provider-resolution",
        requestId: 4,
        error,
        serialized: value,
      })
      const emitted = JSON.stringify(warnSpy.mock.calls)
      expect(emitted).not.toContain("SYNTHETIC_OPAQUE_SECRET")
      expect(emitted).toContain("provider-resolution")
      expect(emitted).toContain('"requestId":4')
    }
  )
})
