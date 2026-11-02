import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  SITE_INTEGRATION_SETTINGS_STORAGE_KEY,
  SiteIntegrationSettingsService,
} from "@/src/storage/site-integration-settings-service"
import {
  SITE_OVERRIDES_STORAGE_KEY,
  SiteOverridesService,
} from "@/src/storage/site-overrides-service"

describe("site integration document updates", () => {
  let stored: Record<string, unknown>
  let settings: SiteIntegrationSettingsService
  let overrides: SiteOverridesService
  const get = vi.fn(async (key: string) =>
    key in stored ? { [key]: structuredClone(stored[key]) } : {}
  )
  const set = vi.fn<(items: Record<string, unknown>) => Promise<void>>()

  beforeEach(() => {
    stored = {}
    get.mockClear()
    set.mockReset()
    set.mockImplementation(async (items) => {
      Object.assign(stored, structuredClone(items))
    })
    settings = new SiteIntegrationSettingsService()
    overrides = new SiteOverridesService()
    vi.stubGlobal("chrome", { storage: { local: { get, set } } })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const documents = [
    {
      name: "site integration settings",
      key: SITE_INTEGRATION_SETTINGS_STORAGE_KEY,
      update: (siteId: string) =>
        settings.updateForSite(siteId, { imageQuality: "data" }),
      expected: { mangadex: { imageQuality: "data" } },
    },
    {
      name: "site overrides",
      key: SITE_OVERRIDES_STORAGE_KEY,
      update: (siteId: string) =>
        overrides.updateForSite(siteId, { outputFormat: "cbz" }),
      expected: { mangadex: { outputFormat: "cbz" } },
    },
  ]

  it.each(documents)(
    "rejects an unknown provider before reading or writing $name",
    async ({ name, update }) => {
      await expect(update("unknown-provider")).rejects.toThrow(
        `Unknown site integration ID in ${name}: unknown-provider`
      )
      expect(get).not.toHaveBeenCalled()
      expect(set).not.toHaveBeenCalled()
    }
  )

  it.each(documents)(
    "continues queued $name updates after a failed write",
    async ({ key, update, expected }) => {
      const failure = new Error("storage write failed")
      set.mockRejectedValueOnce(failure)
      const rejected = expect(update("mangadex")).rejects.toBe(failure)
      const next = update("mangadex")

      await rejected
      await next

      expect(stored[key]).toEqual(expected)
      expect(set).toHaveBeenCalledTimes(2)
    }
  )

  it("updates overrides while a settings write is pending", async () => {
    const writeStarted = Promise.withResolvers<void>()
    const releaseWrite = Promise.withResolvers<void>()
    set.mockImplementationOnce(async (items) => {
      writeStarted.resolve()
      await releaseWrite.promise
      Object.assign(stored, structuredClone(items))
    })

    const settingsUpdate = settings.updateForSite("mangadex", {
      imageQuality: "data",
    })
    await writeStarted.promise
    const overridesUpdate = overrides.updateForSite("mangadex", {
      outputFormat: "cbz",
    })

    try {
      await vi.waitFor(() => {
        expect(stored[SITE_OVERRIDES_STORAGE_KEY]).toEqual({
          mangadex: { outputFormat: "cbz" },
        })
      })
      await overridesUpdate
      expect(stored[SITE_INTEGRATION_SETTINGS_STORAGE_KEY]).toBeUndefined()
    } finally {
      releaseWrite.resolve()
      await settingsUpdate
    }

    expect(stored[SITE_INTEGRATION_SETTINGS_STORAGE_KEY]).toEqual({
      mangadex: { imageQuality: "data" },
    })
  })
})
