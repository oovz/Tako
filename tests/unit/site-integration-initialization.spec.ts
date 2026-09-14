import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

describe("site integration enablement initialization", () => {
  const addListener = vi.fn()
  const localGet = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    addListener.mockReset()
    localGet.mockResolvedValue({})
    vi.stubGlobal("chrome", {
      storage: {
        local: { get: localGet },
        onChanged: { addListener },
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("registers the storage listener synchronously before hydration", async () => {
    let resolveLoader!: (value: Record<string, boolean>) => void
    const loader = vi.fn(
      () =>
        new Promise<Record<string, boolean>>((resolve) => {
          resolveLoader = resolve
        })
    )
    const {
      initializeSiteIntegrationEnablement,
      registerSiteIntegrationEnablementListener,
    } = await import("@/src/runtime/site-integration-initialization")

    registerSiteIntegrationEnablementListener({ getAll: vi.fn() })
    const initialization = initializeSiteIntegrationEnablement(loader)
    expect(addListener).toHaveBeenCalledTimes(1)

    resolveLoader({ mangadex: true })
    await initialization
    const { getEnablementMap } = await import("@/src/site-integrations/catalog")
    expect(getEnablementMap()).toEqual({ mangadex: true })
  })

  it("rejects malformed current enablement changes", async () => {
    const { registerSiteIntegrationEnablementListener } =
      await import("@/src/runtime/site-integration-initialization")
    registerSiteIntegrationEnablementListener({ getAll: vi.fn() })

    const listener = addListener.mock.calls[0]?.[0] as (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: chrome.storage.AreaName
    ) => void
    expect(() =>
      listener(
        {
          siteIntegrationEnablement: {
            oldValue: null,
            newValue: { mangadex: false, invalid: "ignored" },
          },
        } as Record<string, chrome.storage.StorageChange>,
        "local"
      )
    ).toThrow()
    const { getEnablementMap } = await import("@/src/site-integrations/catalog")
    expect(getEnablementMap()).toEqual({})
  })

  it("loads offscreen enablement without registering mutable runtime metadata", async () => {
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async () => ({ success: true, enablement: {} })),
      },
    })
    const { initializeOffscreenSiteIntegrations } =
      await import("@/src/runtime/site-integration-offscreen-initialization")
    await initializeOffscreenSiteIntegrations()
    const { getEnablementMap } = await import("@/src/site-integrations/catalog")
    expect(getEnablementMap()).toEqual({})
  })
})

describe("generated background integration catalog", () => {
  it("contains one adapter for every shipped background provider", async () => {
    const { getDefinitions } = await import("@/src/site-integrations/catalog")
    const { backgroundSiteAdaptersById } =
      await import("@/src/runtime/generated/site-integration-background-registry")
    const shippedBackgroundIds = getDefinitions()
      .filter(
        (definition) => definition.shipped && definition.runtimes.background
      )
      .map((definition) => definition.id)
      .sort()
    expect(Object.keys(backgroundSiteAdaptersById).sort()).toEqual(
      shippedBackgroundIds
    )
    for (const definition of getDefinitions()) {
      if (definition.shipped && definition.runtimes.background) {
        expect(backgroundSiteAdaptersById[definition.id]).toBeDefined()
        expect(backgroundSiteAdaptersById[definition.id]).not.toHaveProperty(
          "id"
        )
      }
    }
  })

  it("uses definition-owned keys for offscreen and page-probe registries", async () => {
    const { getDefinitions } = await import("@/src/site-integrations/catalog")
    const { offscreenSiteAdaptersById } =
      await import("@/src/runtime/generated/site-integration-offscreen-registry")
    const { siteIntegrationPageProbesById } =
      await import("@/src/runtime/generated/site-integration-page-probe-registry")

    for (const definition of getDefinitions()) {
      if (definition.shipped && definition.runtimes.offscreen) {
        expect(offscreenSiteAdaptersById[definition.id]).toBeDefined()
        expect(offscreenSiteAdaptersById[definition.id]).not.toHaveProperty(
          "id"
        )
      }
      if (definition.shipped && definition.pageProbe !== "none") {
        expect(siteIntegrationPageProbesById[definition.id]).toBeDefined()
        expect(siteIntegrationPageProbesById[definition.id]).not.toHaveProperty(
          "id"
        )
      }
    }
  })
})
