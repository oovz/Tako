import { afterEach, describe, expect, it } from "vitest"

import {
  siteIntegrationCatalog,
  getDefinition,
  isEnabled,
  requiresBroadHttpsPermission,
  setEnablementMap,
  getEnablementMap,
} from "@/src/site-integrations/catalog"

describe("site integration registry", () => {
  afterEach(() => {
    setEnablementMap({})
  })

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

  it("exposes valid registry definitions and resolution metadata", () => {
    const ids = siteIntegrationCatalog.map((definition) => definition.id)
    expect(new Set(ids).size).toBe(ids.length)

    for (const definition of siteIntegrationCatalog) {
      expect(definition.version).toBeTypeOf("string")
      expect(Array.isArray(definition.contributors)).toBe(true)
      expect(definition.contributors.length).toBeGreaterThan(0)
      expect(
        definition.contributors.every(
          (c) => typeof c === "string" && c.length > 0
        )
      ).toBe(true)
      expect(definition.shipped).toBe(true)
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

  it("hydrates and projects module-scope enablement map with fallback to defaults", () => {
    const enabledDef = siteIntegrationCatalog.find(
      (item) => item.enabledByDefault === true && item.shipped
    )
    const disabledDef = siteIntegrationCatalog.find(
      (item) => item.enabledByDefault === false && item.shipped
    )
    expect(enabledDef).toBeDefined()
    expect(disabledDef).toBeDefined()
    if (!enabledDef || !disabledDef) return

    // Reset to empty map (simulating unhydrated/default state)
    setEnablementMap({})
    expect(getEnablementMap()).toEqual({})
    expect(isEnabled(enabledDef.id)).toBe(true)
    expect(isEnabled(disabledDef.id)).toBe(false)

    // Set explicit enablement map
    setEnablementMap({
      [enabledDef.id]: false,
      [disabledDef.id]: true,
    })
    expect(getEnablementMap()).toEqual({
      [enabledDef.id]: false,
      [disabledDef.id]: true,
    })
    expect(isEnabled(enabledDef.id)).toBe(false)
    expect(isEnabled(disabledDef.id)).toBe(true)
  })
})
