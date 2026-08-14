import { describe, expect, it } from "vitest"

import {
  siteIntegrationCatalog,
  getDefinition,
  isEnabled,
  requiresBroadHttpsPermission,
} from "@/src/site-integrations/catalog"

describe("site integration registry", () => {
  it("returns undefined when definition is missing", () => {
    expect(getDefinition("__unknown__")).toBeUndefined()
  })

  it("returns definition when integration id exists", () => {
    const definition = siteIntegrationCatalog[0]
    expect(definition).toBeDefined()
    if (!definition) {
      throw new Error("Expected at least one definition")
    }
    expect(getDefinition(definition.id)?.id).toBe(definition.id)
  })

  it("exposes registry maturity and resolution metadata", () => {
    const ids = siteIntegrationCatalog.map((definition) => definition.id)
    expect(new Set(ids).size).toBe(ids.length)

    for (const definition of siteIntegrationCatalog) {
      expect(definition.version).toBeTypeOf("string")
      expect(["experimental", "stable"]).toContain(definition.maturity)
      expect(definition.shipped).toBe(true)
      expect([
        "official-api",
        "unofficial-api",
        "dom-scraping",
        "hybrid",
      ]).toContain(definition.implementationType)
      expect(definition.requiredOrigins.length).toBeGreaterThan(0)
      expect(
        definition.requiredOrigins.every((origin) =>
          /^https:\/\/(?:\*\.)?[^/]+\/.*$/.test(origin)
        )
      ).toBe(true)
      expect(Object.values(definition.runtimes).some(Boolean)).toBe(true)
      if (requiresBroadHttpsPermission(definition.id)) {
        expect(definition.enabledByDefault).toBe(false)
      }
    }

    expect(
      siteIntegrationCatalog.find((definition) => definition.id === "mangadex")
        ?.enabledByDefault
    ).toBe(false)
  })

  it("uses enabledByDefault when no user override exists", () => {
    const definition = siteIntegrationCatalog.find(
      (item) => item.enabledByDefault !== false
    )
    expect(definition).toBeDefined()
    if (!definition) {
      throw new Error("Expected at least one enabled definition")
    }

    expect(isEnabled(definition.id, {})).toBe(true)
  })

  it("declares credential mode and exact origins for every shipped provider role", () => {
    for (const definition of siteIntegrationCatalog) {
      const policies = definition.endpointPolicies
      expect(policies.length).toBeGreaterThan(0)
      for (const policy of policies) {
        expect(["include", "omit"]).toContain(policy.credentials)
        expect(["fixed", "provider-issued"]).toContain(policy.originKind)
        expect(policy.purpose.length).toBeGreaterThan(0)
        expect(policy.origins.length).toBeGreaterThan(0)
        expect(
          policy.origins.every((origin) =>
            /^https:\/\/(?:\*\.)?[^/]+\/.*$/.test(origin)
          )
        ).toBe(true)
      }
    }
  })

  it("applies user override when provided", () => {
    const definition = siteIntegrationCatalog.find((item) => item.shipped)
    expect(definition).toBeDefined()
    if (!definition) {
      throw new Error("Expected at least one enabled definition")
    }

    expect(isEnabled(definition.id, { [definition.id]: false })).toBe(false)
    expect(isEnabled(definition.id, { [definition.id]: true })).toBe(true)
  })
})
