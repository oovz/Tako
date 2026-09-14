import { EventEmitter } from "node:events"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { format } from "node:util"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  installContextDiagnostics,
  installPageDiagnostics,
} from "@/tests/e2e/fixtures/diagnostics"

const secret = "SYNTHETIC_OPAQUE_CONSOLE_PAYLOAD"

describe("browser diagnostic output", () => {
  afterEach(() => vi.restoreAllMocks())

  it("keeps provider errors and failed-request text out of live workflow records", async () => {
    const page = Object.assign(new EventEmitter(), {
      url: () => `https://provider.example/page?token=${secret}`,
    })
    const records: unknown[] = []
    installPageDiagnostics(page as never, (value) => records.push(value))
    page.emit("console", {
      type: () => "error",
      text: () => secret,
      page: () => page,
      worker: () => null,
    })
    page.emit("pageerror", new Error(secret))
    page.emit("requestfailed", {
      url: page.url,
      failure: () => ({ errorText: secret }),
    })
    await vi.waitFor(() => expect(records).toHaveLength(3))
    const emitted = JSON.stringify(records)
    expect(emitted).not.toContain(secret)
    expect(emitted).toContain("https://provider.example/page")
    expect(emitted).toContain("page-error")
    expect(emitted).toContain("request-failed")
  })

  it.each([
    "extension-page",
    "extension-worker",
    "provider-page",
    "provider-worker",
    "unknown",
  ])("redacts final saved %s console output", async (source) => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined)
    const context = new EventEmitter()
    installContextDiagnostics(context as never)
    const extension = source.startsWith("extension")
    const url = extension
      ? "chrome-extension://tako/background.js"
      : `https://provider.example/page?token=${secret}`
    const jsonValue = vi.fn(async () => ({
      headers: { "x-provider-session": secret },
      stage: "provider-resolution",
      requestId: 4,
      error: { name: "TypeError", message: "Failed to fetch" },
    }))
    context.emit("console", {
      type: () => "warning",
      text: () => secret,
      page: () => (source.endsWith("page") ? { url: () => url } : null),
      worker: () => (source.endsWith("worker") ? { url: () => url } : null),
      args: () => [{ jsonValue }],
    })
    await vi.waitFor(() => expect(log).toHaveBeenCalledOnce())
    const directory = await mkdtemp(path.join(tmpdir(), "tako-console-"))
    try {
      const artifact = path.join(directory, "diagnostics.json")
      await writeFile(
        artifact,
        log.mock.calls.map((args) => format(...args)).join("\n")
      )
      const saved = await readFile(artifact, "utf8")
      expect(saved).not.toContain(secret)
      expect(saved).toContain("warning")
      if (extension) {
        expect(saved).toContain("provider-resolution")
        expect(saved).toMatch(/requestId[" :]+4/)
        expect(saved).toContain("Failed to fetch")
      } else {
        expect(jsonValue).not.toHaveBeenCalled()
      }
    } finally {
      expect(
        path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep)
      ).toBe(true)
      await rm(directory, { recursive: true, force: true })
    }
  })
})
