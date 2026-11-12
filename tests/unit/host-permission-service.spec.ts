import { beforeEach, describe, expect, it, vi } from "vitest"
import { siteIntegrationWxtPermissions } from "@/src/runtime/generated/site-integration-wxt-permissions"

const storageMocks = vi.hoisted(() => ({
  getAll: vi.fn(),
  setAll: vi.fn(),
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
  getIntegrationOptionalHostPermissionOrigins,
  includesManagedHostPermission,
  reconcileOptionalHostPermissionEnablement,
  removeUnusedHostPermissions,
  requestIntegrationHostPermission,
} from "@/src/site-integrations/host-permission-service"

describe("site integration optional host permissions", () => {
  const contains = vi.fn()
  const request = vi.fn()
  const remove = vi.fn()
  const getAll = vi.fn()
  const getManifest = vi.fn(() => ({
    host_permissions: [
      ...siteIntegrationWxtPermissions.requiredOrigins,
    ] as string[],
    optional_host_permissions: [
      ...siteIntegrationWxtPermissions.optionalOrigins,
    ] as string[],
  }))

  beforeEach(() => {
    vi.clearAllMocks()
    storageMocks.getAll.mockResolvedValue({})
    storageMocks.setAll.mockResolvedValue(undefined)
    contains.mockResolvedValue(false)
    request.mockResolvedValue(false)
    remove.mockResolvedValue(true)
    getAll.mockResolvedValue({ origins: [] })
    vi.stubGlobal("chrome", {
      runtime: { getManifest },
      permissions: { contains, request, remove, getAll },
    })
  })

  it("uses the loaded manifest when a build promotes optional origins to required", async () => {
    getManifest.mockReturnValueOnce({
      host_permissions: ["https://*/*"],
      optional_host_permissions: [],
    })
    await expect(
      removeUnusedHostPermissions({ mangadex: false })
    ).resolves.toBe(false)
    expect(remove).not.toHaveBeenCalled()
  })

  it("requests no optional access for a default-enabled fixed-origin integration", async () => {
    await expect(requestIntegrationHostPermission("pixiv-comic")).resolves.toBe(
      true
    )
    expect(request).not.toHaveBeenCalled()

    request.mockResolvedValueOnce(true)
    await expect(requestIntegrationHostPermission("mangadex")).resolves.toBe(
      true
    )
    expect(request).toHaveBeenCalledWith({
      origins: getIntegrationOptionalHostPermissionOrigins("mangadex"),
    })
  })

  it("preserves an explicitly declared broad permission for a disabled provider", () => {
    expect(getIntegrationOptionalHostPermissionOrigins("mangadex")).toEqual([
      "https://*/*",
    ])
  })

  it("disables a provider when its required host permissions are missing", async () => {
    storageMocks.getAll.mockResolvedValue({ mangadex: true })

    await expect(
      reconcileOptionalHostPermissionEnablement(storageMocks)
    ).resolves.toEqual({
      changed: true,
      enablement: { mangadex: false },
      disabledIntegrationIds: ["mangadex"],
    })
    expect(storageMocks.setAll).toHaveBeenCalledWith({ mangadex: false })
  })

  it("keeps an enabled provider when its required host permissions exist", async () => {
    storageMocks.getAll.mockResolvedValue({ mangadex: true })
    contains.mockResolvedValue(true)

    await expect(
      reconcileOptionalHostPermissionEnablement(storageMocks)
    ).resolves.toEqual({
      changed: false,
      enablement: { mangadex: true },
      disabledIntegrationIds: [],
    })
    expect(storageMocks.setAll).not.toHaveBeenCalled()
  })

  it("reconciles all abandoned optional access when no persisted integration needs it", async () => {
    storageMocks.getAll.mockResolvedValue({ mangadex: false })
    contains.mockResolvedValue(true)
    getAll.mockResolvedValue({ origins: [OPTIONAL_BROAD_HTTPS_ORIGIN] })

    await expect(
      reconcileOptionalHostPermissionEnablement(storageMocks)
    ).resolves.toEqual({
      changed: false,
      enablement: { mangadex: false },
      disabledIntegrationIds: [],
    })
    expect(remove).toHaveBeenCalledWith({
      origins: getIntegrationOptionalHostPermissionOrigins("mangadex"),
    })
  })

  it("removes optional access only when no enabled integration needs it", async () => {
    contains.mockResolvedValue(true)
    getAll.mockResolvedValue({ origins: [OPTIONAL_BROAD_HTTPS_ORIGIN] })

    await expect(
      removeUnusedHostPermissions({ mangadex: false })
    ).resolves.toBe(true)
    expect(remove).toHaveBeenCalledWith({
      origins: getIntegrationOptionalHostPermissionOrigins("mangadex"),
    })

    remove.mockClear()
    await expect(removeUnusedHostPermissions({ mangadex: true })).resolves.toBe(
      false
    )
    expect(remove).not.toHaveBeenCalled()
  })

  it("preserves fixed-site access when broad HTTPS access was never granted", async () => {
    const origin = "https://comic.pixiv.net/*"
    let granted = true
    getAll.mockImplementation(async () => ({
      origins: granted ? [origin] : [],
    }))
    contains.mockImplementation(async () => granted)
    remove.mockImplementation(async () => {
      // Chrome's wildcard removal also covers narrower runtime grants.
      granted = false
      return true
    })

    await removeUnusedHostPermissions({ mangadex: false })

    expect(await contains({ origins: [origin] })).toBe(true)
  })

  it("recognizes revocation of any generated optional provider origin", () => {
    expect(
      includesManagedHostPermission({
        origins: [OPTIONAL_BROAD_HTTPS_ORIGIN],
      })
    ).toBe(true)
    expect(includesManagedHostPermission({ origins: [] })).toBe(false)
  })
})
