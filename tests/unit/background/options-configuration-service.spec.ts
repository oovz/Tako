import { describe, expect, it, vi } from "vitest"

import {
  OptionsConfigurationService,
  type OptionsConfigurationServiceDependencies,
  type OptionsConfigurationSnapshot,
} from "@/entrypoints/background/options-configuration-service"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import { SETTINGS_STORAGE_KEY } from "@/src/storage/settings-repository"
import { SITE_OVERRIDES_STORAGE_KEY } from "@/src/storage/site-overrides-service"
import { SITE_INTEGRATION_ENABLEMENT_STORAGE_KEY } from "@/src/storage/site-integration-enablement-service"
import { SITE_INTEGRATION_SETTINGS_STORAGE_KEY } from "@/src/storage/site-integration-settings-service"

function configuration(
  overrides: Partial<OptionsConfigurationSnapshot> = {}
): OptionsConfigurationSnapshot {
  return {
    settings: structuredClone(DEFAULT_SETTINGS),
    overrides: {},
    enablement: {},
    integrationSettings: {},
    ...overrides,
  }
}

function createDependencies(
  storage: OptionsConfigurationServiceDependencies["storage"],
  calls: string[] = []
): OptionsConfigurationServiceDependencies {
  return {
    storage,
    settingsRepository: {
      getSettings: vi.fn(async () => structuredClone(DEFAULT_SETTINGS)),
      acceptExternalDocument: vi.fn(() => calls.push("settings-cache")),
    },
    historyRepository: {
      getStorageStats: vi.fn(async () => ({
        totalChapters: 2,
        totalSeries: 1,
        oldestDownload: 1,
        newestDownload: 2,
      })),
      getAllSeriesHistory: vi.fn(async () => [
        {
          siteIntegrationId: "mangadex",
          seriesId: "series-1",
          seriesTitle: "Series 1",
          downloadedChapters: [
            {
              chapterId: "chapter-1",
              siteIntegrationId: "mangadex",
              seriesId: "series-1",
              seriesTitle: "Series 1",
              title: "Chapter 1",
              url: "https://example.test/chapter-1",
              downloadedAt: 1,
              format: "none" as const,
            },
          ],
          lastUpdated: 1,
        },
      ]),
    },
    applySettingsSideEffects: vi.fn(async () => {
      calls.push("effects")
    }),
    cleanupRateLimiters: vi.fn(() => calls.push("rate-limiters")),
  }
}

function storedConfiguration(
  next: OptionsConfigurationSnapshot = configuration()
): Record<string, unknown> {
  return {
    [SETTINGS_STORAGE_KEY]: structuredClone(next.settings),
    [SITE_OVERRIDES_STORAGE_KEY]: structuredClone(next.overrides),
    [SITE_INTEGRATION_ENABLEMENT_STORAGE_KEY]: structuredClone(next.enablement),
    [SITE_INTEGRATION_SETTINGS_STORAGE_KEY]: structuredClone(
      next.integrationSettings
    ),
  }
}

describe("OptionsConfigurationService", () => {
  it("serializes reads behind a save and returns one untorn snapshot", async () => {
    const initial = storedConfiguration()
    const next = configuration({
      overrides: { mangadex: { pathTemplate: "Updated" } },
      enablement: { mangadex: false },
    })
    let releaseSet!: () => void
    let setStarted!: () => void
    const setGate = new Promise<void>((resolve) => {
      releaseSet = resolve
    })
    const setReady = new Promise<void>((resolve) => {
      setStarted = resolve
    })
    let current = initial
    const storage = {
      get: vi.fn(async () => structuredClone(current)),
      set: vi.fn(async (value: Record<string, unknown>) => {
        setStarted()
        await setGate
        current = value
      }),
    }
    const service = new OptionsConfigurationService(createDependencies(storage))

    const saving = service.saveConfiguration(next)
    await setReady
    const reading = service.getConfiguration()
    expect(storage.get).not.toHaveBeenCalled()

    releaseSet()
    await expect(saving).resolves.toEqual(next)
    await expect(reading).resolves.toEqual(next)
    expect(storage.get).toHaveBeenCalledTimes(1)
    expect(storage.set).toHaveBeenCalledTimes(1)
  })

  it("performs one exact four-key durable write before publication", async () => {
    const storage = {
      get: vi.fn(async () => storedConfiguration()),
      set: vi.fn(async () => undefined),
    }
    const calls: string[] = []
    const deps = createDependencies(storage, calls)
    const service = new OptionsConfigurationService(deps)
    const next = configuration({
      overrides: { mangadex: { pathTemplate: "Local" } },
      enablement: { mangadex: true },
      integrationSettings: { mangadex: { imageQuality: "data-saver" } },
    })

    await expect(service.saveConfiguration(next)).resolves.toEqual(next)

    expect(storage.set).toHaveBeenCalledTimes(1)
    expect(storage.set).toHaveBeenCalledWith({
      [SETTINGS_STORAGE_KEY]: next.settings,
      [SITE_OVERRIDES_STORAGE_KEY]: next.overrides,
      [SITE_INTEGRATION_ENABLEMENT_STORAGE_KEY]: next.enablement,
      [SITE_INTEGRATION_SETTINGS_STORAGE_KEY]: next.integrationSettings,
    })
    expect(calls).toEqual(["settings-cache", "effects", "rate-limiters"])
    expect(
      vi.mocked(deps.settingsRepository.acceptExternalDocument).mock
        .invocationCallOrder[0]
    ).toBeGreaterThan(vi.mocked(storage.set).mock.invocationCallOrder[0])
  })

  it("does not publish caches or side effects when the durable write fails", async () => {
    const storage = {
      get: vi.fn(async () => storedConfiguration()),
      set: vi.fn(async () => {
        throw new Error("storage unavailable")
      }),
    }
    const calls: string[] = []
    const deps = createDependencies(storage, calls)
    const service = new OptionsConfigurationService(deps)

    await expect(service.saveConfiguration(configuration())).rejects.toThrow(
      "storage unavailable"
    )
    expect(storage.set).toHaveBeenCalledTimes(1)
    expect(
      deps.settingsRepository.acceptExternalDocument
    ).not.toHaveBeenCalled()
    expect(deps.applySettingsSideEffects).not.toHaveBeenCalled()
    expect(deps.cleanupRateLimiters).not.toHaveBeenCalled()
    expect(calls).toEqual([])
  })

  it("rejects invalid provider settings before opening the durable write", async () => {
    const storage = {
      get: vi.fn(async () => storedConfiguration()),
      set: vi.fn(async () => undefined),
    }
    const deps = createDependencies(storage)
    const service = new OptionsConfigurationService(deps)

    await expect(
      service.saveConfiguration(
        configuration({
          integrationSettings: { mangadex: { unknownSetting: true } },
        })
      )
    ).rejects.toThrow(/Unknown site integration setting/)
    expect(storage.set).not.toHaveBeenCalled()
    expect(deps.applySettingsSideEffects).not.toHaveBeenCalled()
  })

  it("rejects unknown provider IDs before opening the durable write", async () => {
    const storage = {
      get: vi.fn(async () => storedConfiguration()),
      set: vi.fn(async () => undefined),
    }
    const deps = createDependencies(storage)
    const service = new OptionsConfigurationService(deps)

    await expect(
      service.saveConfiguration(
        configuration({
          overrides: { "unknown-provider": { outputFormat: "cbz" } },
        })
      )
    ).rejects.toThrow(/Unknown site integration ID/)
    expect(storage.set).not.toHaveBeenCalled()
  })

  it("rejects unknown enablement IDs before opening the durable write", async () => {
    const storage = {
      get: vi.fn(async () => storedConfiguration()),
      set: vi.fn(async () => undefined),
    }
    const deps = createDependencies(storage)
    const service = new OptionsConfigurationService(deps)

    await expect(
      service.saveConfiguration(
        configuration({ enablement: { "unknown-provider": true } })
      )
    ).rejects.toThrow(/Unknown site integration ID/)
    expect(storage.set).not.toHaveBeenCalled()
  })

  it("loads the full configuration and history projection", async () => {
    const storage = {
      get: vi.fn(async () => storedConfiguration()),
      set: vi.fn(async () => undefined),
    }
    const service = new OptionsConfigurationService(createDependencies(storage))

    await expect(service.getOptionsConfiguration()).resolves.toEqual({
      configuration: configuration(),
      historyStats: { totalChapters: 2, totalSeries: 1 },
      historySeries: [
        {
          siteIntegrationId: "mangadex",
          seriesId: "series-1",
          seriesTitle: "Series 1",
          chapterCount: 1,
        },
      ],
    })
  })
})
