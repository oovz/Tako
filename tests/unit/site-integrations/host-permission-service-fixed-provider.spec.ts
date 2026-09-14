import { beforeEach, describe, expect, it, vi } from "vitest"

const { definitions } = vi.hoisted(() => ({
  definitions: [
    {
      id: "fixed-only",
      shipped: true,
      enabledByDefault: false,
      requiredOrigins: ["https://fixed.example/*"],
      optionalOrigins: [],
    },
    {
      id: "shared-enabled",
      shipped: true,
      enabledByDefault: true,
      requiredOrigins: ["https://mandatory.example/*"],
      optionalOrigins: ["https://shared.example/*"],
    },
    {
      id: "shared-disabled",
      shipped: true,
      enabledByDefault: false,
      requiredOrigins: ["https://shared.example/*"],
      optionalOrigins: [],
    },
    {
      id: "mandatory-overlap-disabled",
      shipped: true,
      enabledByDefault: false,
      requiredOrigins: ["https://mandatory.example/*"],
      optionalOrigins: [],
    },
  ],
}))

vi.mock("@/src/site-integrations/catalog", () => ({
  getDefinition: (id: string) =>
    definitions.find((definition) => definition.id === id),
  getDefinitions: () => definitions,
  isEnabled: (id: string, overrides: Record<string, boolean>) => {
    const definition = definitions.find((candidate) => candidate.id === id)
    if (!definition?.shipped) return false
    return overrides[id] ?? definition.enabledByDefault
  },
}))

vi.mock("@/src/runtime/generated/site-integration-wxt-permissions", () => ({
  siteIntegrationWxtPermissions: {
    requiredOrigins: ["https://mandatory.example/*"],
    optionalOrigins: [
      "https://fixed.example/*",
      "https://shared.example/*",
      "https://mandatory.example/*",
    ],
  },
}))

import {
  getIntegrationOptionalHostPermissionOrigins,
  includesManagedHostPermission,
  removeUnusedHostPermissions,
  requestIntegrationHostPermission,
} from "@/src/site-integrations/host-permission-service"

describe("fixed-only provider host permissions", () => {
  const request = vi.fn()
  const remove = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    request.mockResolvedValue(true)
    remove.mockResolvedValue(true)
    vi.stubGlobal("chrome", {
      runtime: {
        getManifest: () => ({
          host_permissions: ["https://mandatory.example/*"],
          optional_host_permissions: [
            "https://fixed.example/*",
            "https://shared.example/*",
            "https://mandatory.example/*",
          ],
        }),
      },
      permissions: { request, remove },
    })
  })

  it("requests the disabled provider's exact required origin", async () => {
    expect(getIntegrationOptionalHostPermissionOrigins("fixed-only")).toEqual([
      "https://fixed.example/*",
    ])
    await expect(requestIntegrationHostPermission("fixed-only")).resolves.toBe(
      true
    )
    expect(request).toHaveBeenCalledWith({
      origins: ["https://fixed.example/*"],
    })
  })

  it("keeps a shared origin while another enabled provider uses it", async () => {
    await expect(
      removeUnusedHostPermissions({
        "fixed-only": false,
        "shared-enabled": true,
        "shared-disabled": false,
        "mandatory-overlap-disabled": false,
      })
    ).resolves.toBe(true)
    expect(remove).toHaveBeenCalledWith({
      origins: ["https://fixed.example/*"],
    })
  })

  it("removes genuinely unused optional origins but never manifest-required origins", async () => {
    await expect(
      removeUnusedHostPermissions({
        "fixed-only": false,
        "shared-enabled": false,
        "shared-disabled": false,
        "mandatory-overlap-disabled": false,
      })
    ).resolves.toBe(true)
    expect(remove).toHaveBeenCalledWith({
      origins: ["https://fixed.example/*", "https://shared.example/*"],
    })
  })

  it("observes removal of an optional origin but ignores manifest-required overlap", () => {
    expect(
      includesManagedHostPermission({
        origins: ["https://fixed.example/*"],
      })
    ).toBe(true)
    expect(
      includesManagedHostPermission({
        origins: ["https://mandatory.example/*"],
      })
    ).toBe(false)
  })
})
