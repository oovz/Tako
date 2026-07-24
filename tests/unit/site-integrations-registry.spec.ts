import { describe, expect, it } from "vitest"

import {
  SITE_INTEGRATION_MANIFESTS,
  getManifest,
  isEnabled,
} from "@/src/site-integrations/registry"

describe("site integration registry", () => {
  it("returns null when manifest is missing", () => {
    expect(getManifest("__unknown__")).toBeNull()
  })

  it("returns manifest when integration id exists", () => {
    const manifest = SITE_INTEGRATION_MANIFESTS[0]
    expect(manifest).toBeDefined()
    if (!manifest) {
      throw new Error("Expected at least one manifest")
    }
    expect(getManifest(manifest.id)?.id).toBe(manifest.id)
  })

  it("exposes registry maturity and resolution metadata", () => {
    const ids = SITE_INTEGRATION_MANIFESTS.map((manifest) => manifest.id)
    expect(new Set(ids).size).toBe(ids.length)

    for (const manifest of SITE_INTEGRATION_MANIFESTS) {
      expect(manifest.version).toBeTypeOf("string")
      expect(["experimental", "stable"]).toContain(manifest.maturity)
      expect(manifest.shipped).toBe(true)
      expect([
        "official-api",
        "unofficial-api",
        "dom-scraping",
        "hybrid",
      ]).toContain(manifest.implementationType)
      expect(manifest.requiredOrigins.length).toBeGreaterThan(0)
      expect(
        manifest.requiredOrigins.every((origin) =>
          /^https:\/\/(?:\*\.)?[^/]+\/.*$/.test(origin)
        )
      ).toBe(true)
      expect(Object.values(manifest.runtimes).some(Boolean)).toBe(true)
      if (manifest.requiresBroadHttpsPermission) {
        expect(manifest.enabledByDefault).toBe(false)
      }
    }

    expect(
      SITE_INTEGRATION_MANIFESTS.find((manifest) => manifest.id === "mangadex")
        ?.enabledByDefault
    ).toBe(false)
  })

  it("uses enabledByDefault when no user override exists", () => {
    const manifest = SITE_INTEGRATION_MANIFESTS.find(
      (item) => item.enabledByDefault !== false
    )
    expect(manifest).toBeDefined()
    if (!manifest) {
      throw new Error("Expected at least one enabled manifest")
    }

    expect(isEnabled(manifest.id, {})).toBe(true)
  })

  it("applies user override when provided", () => {
    const manifest = SITE_INTEGRATION_MANIFESTS.find((item) => item.shipped)
    expect(manifest).toBeDefined()
    if (!manifest) {
      throw new Error("Expected at least one enabled manifest")
    }

    expect(isEnabled(manifest.id, { [manifest.id]: false })).toBe(false)
    expect(isEnabled(manifest.id, { [manifest.id]: true })).toBe(true)
  })
})
