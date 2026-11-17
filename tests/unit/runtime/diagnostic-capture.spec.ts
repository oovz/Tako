import { describe, expect, it, vi } from "vitest"

describe("extension diagnostic capture", () => {
  it("records uncaught errors once, keeps native reporting, and releases its hooks", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    const { installDiagnosticCapture } =
      await import("@/src/runtime/diagnostic-capture")
    const scope = new EventTarget()
    const stop = installDiagnosticCapture("options", scope)
    const duplicate = installDiagnosticCapture("options", scope)
    try {
      const error = Object.assign(new Event("error", { cancelable: true }), {
        message: "Uncaught fixture",
        error: new Error(
          "Crash https://example.com/chapter?token=SYNTHETIC_EVENT_SECRET"
        ),
      })
      expect(scope.dispatchEvent(error)).toBe(true)
      expect(consoleError.mock.calls).toHaveLength(1)
      const report = JSON.stringify(consoleError.mock.calls)
      expect(report).toContain("https://example.com/chapter")
      expect(report).not.toContain("SYNTHETIC_EVENT_SECRET")

      stop()
      scope.dispatchEvent(error)
      expect(consoleError.mock.calls).toHaveLength(1)
    } finally {
      duplicate()
      stop()
      consoleError.mockRestore()
    }
  })
})
