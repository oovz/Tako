import { afterEach, describe, expect, it, vi } from "vitest"

import {
  getIntegrationHostPermissionOrigins,
  hasIntegrationHostPermission,
  hasIntegrationOptionalHostPermission,
} from "@/src/site-integrations/host-permission-service"

afterEach(() => vi.unstubAllGlobals())

describe("integration host access", () => {
  it("distinguishes manifest access from optional broad provider access", () => {
    expect(getIntegrationHostPermissionOrigins("pixiv-comic")).toContain(
      "https://comic.pixiv.net/*"
    )
    expect(getIntegrationHostPermissionOrigins("mangadex")).toEqual([
      "https://*/*",
    ])
    expect(getIntegrationHostPermissionOrigins("unknown")).toEqual([])
  })

  it("checks required origins while treating an empty optional grant as available", async () => {
    const contains = vi.fn(async () => false)
    vi.stubGlobal("chrome", { permissions: { contains } })
    await expect(
      hasIntegrationOptionalHostPermission("pixiv-comic")
    ).resolves.toBe(true)
    expect(contains).not.toHaveBeenCalled()
    await expect(hasIntegrationHostPermission("pixiv-comic")).resolves.toBe(
      false
    )
    expect(contains).toHaveBeenCalledWith({
      origins: expect.arrayContaining(["https://comic.pixiv.net/*"]),
    })
    await expect(hasIntegrationHostPermission("unknown")).resolves.toBe(true)
  })
})
