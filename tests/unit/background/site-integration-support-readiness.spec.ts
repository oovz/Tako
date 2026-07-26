import { describe, expect, it, vi } from "vitest"

import { createSiteIntegrationSupportReadiness } from "@/entrypoints/background/site-integration-support-readiness"

describe("site integration support readiness", () => {
  it("retries after a failed current attempt", async () => {
    const reconcilePermissionEnablement = vi
      .fn()
      .mockRejectedValueOnce(new Error("permission lookup failed"))
      .mockResolvedValueOnce({ enablement: { mangadex: false } })
    const applyEnablement = vi.fn()
    const readiness = createSiteIntegrationSupportReadiness({
      reconcilePermissionEnablement,
      initializeMetadata: vi.fn(async () => undefined),
      applyEnablement,
    })

    await expect(readiness.ensureInitialized()).rejects.toThrow(
      "permission lookup failed"
    )
    await expect(readiness.ensureInitialized()).resolves.toBeUndefined()

    expect(reconcilePermissionEnablement).toHaveBeenCalledTimes(2)
    expect(applyEnablement).toHaveBeenCalledWith({ mangadex: false })
  })

  it("hands stale callers to the invalidated attempt without applying stale enablement", async () => {
    let resolveFirst:
      | ((value: { enablement: Record<string, boolean> }) => void)
      | undefined
    const firstReconciliation = new Promise<{
      enablement: Record<string, boolean>
    }>((resolve) => {
      resolveFirst = resolve
    })
    const reconcilePermissionEnablement = vi
      .fn()
      .mockReturnValueOnce(firstReconciliation)
      .mockResolvedValueOnce({ enablement: { mangadex: false } })
    const applyEnablement = vi.fn()
    const readiness = createSiteIntegrationSupportReadiness({
      reconcilePermissionEnablement,
      initializeMetadata: vi.fn(async () => undefined),
      applyEnablement,
    })

    const staleCaller = readiness.ensureInitialized()
    readiness.invalidate()
    const currentCaller = readiness.ensureInitialized()
    await currentCaller

    resolveFirst?.({ enablement: { mangadex: true } })
    await staleCaller

    expect(applyEnablement).toHaveBeenCalledTimes(1)
    expect(applyEnablement).toHaveBeenCalledWith({ mangadex: false })
  })
})
