import {
  DirectoryNotFoundError,
  PermissionExpiredError,
} from "@/src/types/errors"
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  OptionsConfigurationService,
  type OptionsConfigurationServiceDependencies,
} from "@/entrypoints/background/options-configuration-service"
import {
  OptionsConfigurationRepository,
  type OptionsConfigurationSnapshot,
} from "@/src/storage/options-configuration-repository"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import { SETTINGS_STORAGE_KEY } from "@/src/storage/settings-repository"
import { SITE_OVERRIDES_STORAGE_KEY } from "@/src/storage/site-overrides-service"
import { SITE_INTEGRATION_ENABLEMENT_STORAGE_KEY } from "@/src/storage/site-integration-enablement-service"
import { SITE_INTEGRATION_SETTINGS_STORAGE_KEY } from "@/src/storage/site-integration-settings-service"

const folders = vi.hoisted(() => ({
  load: vi.fn(),
  check: vi.fn(),
  prune: vi.fn(async () => undefined),
}))
vi.mock("@/src/storage/fs-access", () => ({
  loadDownloadRootHandle: folders.load,
  checkPermissionBeforeWrite: folders.check,
  removeUnusedDownloadRootHandles: folders.prune,
}))

beforeEach(() => {
  folders.load.mockReset()
  folders.check.mockReset()
  folders.check.mockResolvedValue(undefined)
})

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
  storage: ConstructorParameters<typeof OptionsConfigurationRepository>[0],
  calls: string[] = []
): OptionsConfigurationServiceDependencies {
  const settingsRepository = {
    getSettings: vi.fn(async () => structuredClone(DEFAULT_SETTINGS)),
    acceptExternalDocument: vi.fn(() => calls.push("settings-cache")),
  }
  return {
    configurationRepository: new OptionsConfigurationRepository(
      storage,
      settingsRepository
    ),
    settingsRepository,
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
  it.each([
    [
      new PermissionExpiredError({ component: "options", operation: "save" }),
      "Permission was denied for the selected folder. Choose another folder or grant access.",
    ],
    [
      new DirectoryNotFoundError("Folder", {
        component: "options",
        operation: "save",
      }),
      "The selected download folder does not exist or was deleted. Please select a valid folder.",
    ],
    [
      new Error("browser-internal details"),
      "The saved folder needs access. Grant access again or select a folder.",
    ],
  ])("localizes late capability failures", async (failure, message) => {
    const next = configuration()
    next.settings.downloads.destination = "file-system-access"
    next.settings.downloads.customDirectoryHandleId = "folder-new"
    folders.load.mockResolvedValue({ kind: "directory", name: "New" })
    folders.check.mockRejectedValueOnce(failure)
    const storage = {
      get: vi.fn(async () => storedConfiguration()),
      set: vi.fn(),
    }
    const service = new OptionsConfigurationService(createDependencies(storage))
    await expect(service.saveConfiguration(next)).rejects.toThrow(message)
    expect(storage.set).not.toHaveBeenCalled()
  })

  it("commits the staged folder reference after verifying its capability", async () => {
    const next = configuration()
    next.settings.downloads.destination = "file-system-access"
    next.settings.downloads.customDirectoryHandleId = "folder-new"
    const handle = { kind: "directory", name: "New folder" }
    folders.load.mockResolvedValue(handle)
    const storage = {
      get: vi.fn(async () => storedConfiguration()),
      set: vi.fn(async () => undefined),
    }
    const service = new OptionsConfigurationService(createDependencies(storage))

    await expect(service.saveConfiguration(next)).resolves.toEqual(next)
    expect(folders.load).toHaveBeenCalledWith("folder-new")
    expect(folders.check).toHaveBeenCalledWith(handle)
    expect(storage.set).toHaveBeenCalledWith(storedConfiguration(next))
  })

  it.each(["missing", "revoked"])(
    "preserves the saved configuration when the staged capability is %s",
    async (failure) => {
      const next = configuration()
      next.settings.downloads.destination = "file-system-access"
      next.settings.downloads.customDirectoryHandleId = "folder-new"
      folders.load.mockResolvedValue(
        failure === "missing" ? undefined : { kind: "directory", name: "New" }
      )
      if (failure === "revoked")
        folders.check.mockRejectedValue(new Error("Permission required"))
      const storage = {
        get: vi.fn(async () => storedConfiguration()),
        set: vi.fn(async () => undefined),
      }
      const service = new OptionsConfigurationService(
        createDependencies(storage)
      )

      await expect(service.saveConfiguration(next)).rejects.toThrow()
      expect(storage.set).not.toHaveBeenCalled()
      await expect(service.getConfiguration()).resolves.toEqual(configuration())
    }
  )

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
    expect(storage.get).toHaveBeenCalledTimes(1)

    releaseSet()
    await expect(saving).resolves.toEqual(next)
    await expect(reading).resolves.toEqual(next)
    expect(storage.get).toHaveBeenCalledTimes(3)
    expect(storage.set).toHaveBeenCalledTimes(1)
  })

  it("detaches a queued save from caller mutation", async () => {
    const initial = storedConfiguration()
    const first = configuration({
      overrides: { mangadex: { pathTemplate: "First" } },
    })
    const second = configuration({
      overrides: { mangadex: { pathTemplate: "Second" } },
    })
    let releaseFirst!: () => void
    let firstSetStarted!: () => void
    const firstSetGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const firstSetReady = new Promise<void>((resolve) => {
      firstSetStarted = resolve
    })
    let setCount = 0
    const storage = {
      get: vi.fn(async () => structuredClone(initial)),
      set: vi.fn(async () => {
        setCount += 1
        if (setCount === 1) {
          firstSetStarted()
          await firstSetGate
        }
      }),
    }
    const service = new OptionsConfigurationService(createDependencies(storage))

    const firstSave = service.saveConfiguration(first)
    await firstSetReady
    const secondSave = service.saveConfiguration(second)
    second.overrides.mangadex!.pathTemplate = "Mutated after enqueue"
    releaseFirst()

    await firstSave
    await expect(secondSave).resolves.toMatchObject({
      overrides: { mangadex: { pathTemplate: "Second" } },
    })
    expect(storage.set).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        [SITE_OVERRIDES_STORAGE_KEY]: { mangadex: { pathTemplate: "Second" } },
      })
    )
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
