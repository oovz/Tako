import { describe, expect, it, vi } from "vitest"
import { getTabId } from "@/tests/e2e/fixtures/state-helpers"

describe("Chrome tab lookup timing", () => {
  it("accepts a valid tab query that takes longer than two seconds", async () => {
    const worker = {
      url: () => "chrome-extension://test/background.js",
      evaluate: vi
        .fn()
        .mockResolvedValueOnce(true)
        .mockImplementationOnce(async () => {
          await new Promise((resolve) => setTimeout(resolve, 2_200))
          return 42
        }),
    }
    const context = { serviceWorkers: () => [worker] }
    const page = {
      bringToFront: vi.fn(async () => undefined),
      url: () => "https://mangadex.org/title/test",
    }
    await expect(getTabId(page as never, context as never)).resolves.toBe(42)
  }, 10_000)
})
