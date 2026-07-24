import { beforeEach, describe, expect, it, vi } from "vitest"

const storageMocks = vi.hoisted(() => ({
  getAll: vi.fn(),
  setAll: vi.fn(),
}))

vi.mock("@/src/storage/site-integration-enablement-service", () => ({
  siteIntegrationEnablementService: storageMocks,
}))

vi.mock("@/src/runtime/logger", () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

import {
  OPTIONAL_BROAD_HTTPS_ORIGIN,
  includesBroadHttpsPermission,
  reconcileBroadHttpsPermissionEnablement,
  removeBroadHttpsPermissionIfUnused,
  requestIntegrationHostPermission,
} from "@/src/site-integrations/host-permission-service"

describe("site integration optional host permissions", () => {
  const contains = vi.fn()
  const request = vi.fn()
  const remove = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    storageMocks.getAll.mockResolvedValue({})
    storageMocks.setAll.mockResolvedValue(undefined)
    contains.mockResolvedValue(false)
    request.mockResolvedValue(false)
    remove.mockResolvedValue(true)
    vi.stubGlobal("chrome", {
      permissions: { contains, request, remove },
    })
  })

  it("requests broad HTTPS access only for integrations that declare it", async () => {
    await expect(requestIntegrationHostPermission("pixiv-comic")).resolves.toBe(
      true
    )
    expect(request).not.toHaveBeenCalled()

    request.mockResolvedValueOnce(true)
    await expect(requestIntegrationHostPermission("mangadex")).resolves.toBe(
      true
    )
    expect(request).toHaveBeenCalledWith({
      origins: [OPTIONAL_BROAD_HTTPS_ORIGIN],
    })
  })

  it("disables a broad-host integration when its permission is missing", async () => {
    storageMocks.getAll.mockResolvedValue({ mangadex: true })

    await expect(reconcileBroadHttpsPermissionEnablement()).resolves.toEqual({
      changed: true,
      enablement: { mangadex: false },
    })
    expect(storageMocks.setAll).toHaveBeenCalledWith({ mangadex: false })
  })

  it("keeps an enabled broad-host integration when permission exists", async () => {
    storageMocks.getAll.mockResolvedValue({ mangadex: true })
    contains.mockResolvedValue(true)

    await expect(reconcileBroadHttpsPermissionEnablement()).resolves.toEqual({
      changed: false,
      enablement: { mangadex: true },
    })
    expect(storageMocks.setAll).not.toHaveBeenCalled()
  })

  it("reconciles abandoned broad access when no persisted integration needs it", async () => {
    storageMocks.getAll.mockResolvedValue({ mangadex: false })
    contains.mockResolvedValue(true)

    await expect(reconcileBroadHttpsPermissionEnablement()).resolves.toEqual({
      changed: false,
      enablement: { mangadex: false },
    })
    expect(remove).toHaveBeenCalledWith({
      origins: [OPTIONAL_BROAD_HTTPS_ORIGIN],
    })
  })

  it("removes broad access only when no enabled integration needs it", async () => {
    contains.mockResolvedValue(true)

    await expect(
      removeBroadHttpsPermissionIfUnused({ mangadex: false })
    ).resolves.toBe(true)
    expect(remove).toHaveBeenCalledWith({
      origins: [OPTIONAL_BROAD_HTTPS_ORIGIN],
    })

    remove.mockClear()
    await expect(
      removeBroadHttpsPermissionIfUnused({ mangadex: true })
    ).resolves.toBe(false)
    expect(remove).not.toHaveBeenCalled()
  })

  it("recognizes revocation of the broad HTTPS origin", () => {
    expect(
      includesBroadHttpsPermission({
        origins: [OPTIONAL_BROAD_HTTPS_ORIGIN],
      })
    ).toBe(true)
    expect(includesBroadHttpsPermission({ origins: [] })).toBe(false)
  })
})
