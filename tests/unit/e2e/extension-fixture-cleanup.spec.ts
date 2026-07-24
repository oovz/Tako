import { mkdtemp, access } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import type { BrowserContext } from "@playwright/test"

import { teardownExtensionResources } from "@/tests/e2e/fixtures/extension"

describe("extension E2E fixture cleanup", () => {
  it("closes later resources and removes the profile after an earlier cleanup failure", async () => {
    const userDataDir = await mkdtemp(path.join(os.tmpdir(), "tmd-cleanup-"))
    const cleanupOrder: string[] = []
    const context = {
      pages: () => [],
      serviceWorkers: () => [],
      close: async () => {
        cleanupOrder.push("context")
        throw new Error("context close failed")
      },
    } as unknown as BrowserContext
    const localMockServer = {
      url: "http://127.0.0.1:0",
      port: 0,
      addRoute: () => undefined,
      close: async () => {
        cleanupOrder.push("mock-server")
      },
    }

    await expect(
      teardownExtensionResources({
        context,
        localMockServer,
        userDataDir,
        dnrRulesToInstall: [],
      })
    ).rejects.toThrow(/Teardown failed/)

    expect(cleanupOrder).toEqual(["context", "mock-server"])
    await expect(access(userDataDir)).rejects.toThrow()
  })
})
