import { describe, expect, it, vi } from "vitest"

const { append } = vi.hoisted(() => ({
  append: vi.fn<(entries: { json: string }[]) => Promise<void>>(),
}))

vi.mock("@/src/runtime/diagnostic-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/runtime/diagnostic-store")>()),
  appendDiagnosticEntries: append,
}))

describe("diagnostic delivery", () => {
  it("bounds work behind an unavailable store and resumes after a failed transaction", async () => {
    const held = Promise.withResolvers<void>()
    append
      .mockImplementationOnce(() => held.promise)
      .mockResolvedValue(undefined)
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { logger, startDiagnosticRecording, flushDiagnostics } =
      await import("@/src/runtime/logger")
    startDiagnosticRecording("options")
    try {
      logger.warn("active write")
      await vi.waitFor(() => expect(append).toHaveBeenCalledOnce())
      for (let i = 0; i < 250; i += 1) logger.warn(`queued ${i}`)
      expect(warn).toHaveBeenCalledTimes(251)
      held.reject(new Error("Fixture transaction aborted"))
      await flushDiagnostics()

      const attempted = append.mock.calls.flatMap(([batch]) =>
        batch.map((entry) => entry.json)
      )
      expect(attempted.length).toBeGreaterThan(1)
      expect(attempted.length).toBeLessThan(250)
      expect(attempted.at(-1)).not.toContain("queued 249")

      logger.warn("later write", {
        headers: { Authorization: "PRIVATE_HEADER" },
      })
      await flushDiagnostics()
      const persisted = append.mock.calls.at(-1)?.[0][0]?.json ?? ""
      expect(persisted).toContain("later write")
      expect(persisted).toContain("[REDACTED]")
      expect(persisted).not.toContain("PRIVATE_HEADER")
    } finally {
      warn.mockRestore()
    }
  })
})
