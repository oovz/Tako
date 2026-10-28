import { beforeEach, describe, expect, it, vi } from "vitest"

import { OptionsConfigurationService } from "@/entrypoints/background/options-configuration-service"
import { OptionsFsaController } from "@/entrypoints/options/controllers/options-fsa-controller"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import { OptionsConfigurationRepository } from "@/src/storage/options-configuration-repository"
import { SETTINGS_STORAGE_KEY } from "@/src/storage/settings-repository"
import {
  loadDownloadRootHandle,
  saveDownloadRootHandle,
  removeUnusedDownloadRootHandles,
} from "@/src/storage/fs-access"

const capabilityStorage = vi.hoisted(
  () => new Map<string, FileSystemDirectoryHandle>()
)
vi.mock("@/src/storage/fs-access", () => ({
  saveDownloadRootHandle: vi.fn(async (handle, id) => {
    capabilityStorage.set(id, handle)
  }),
  loadDownloadRootHandle: vi.fn(async (id) => capabilityStorage.get(id)),
  checkPermissionBeforeWrite: vi.fn(async () => undefined),
  removeUnusedDownloadRootHandles: vi.fn(
    async (candidates: ReadonlySet<string>, retained: ReadonlySet<string>) => {
      for (const id of candidates) {
        if (!retained.has(id)) capabilityStorage.delete(id)
      }
    }
  ),
}))

function folder(name: string): FileSystemDirectoryHandle {
  return { kind: "directory", name } as FileSystemDirectoryHandle
}

function createHarness() {
  const oldFolder = folder("Old folder")
  const newFolder = folder("New folder")
  capabilityStorage.set("old-folder", oldFolder)
  const oldSettings = structuredClone(DEFAULT_SETTINGS)
  oldSettings.downloads.destination = "file-system-access"
  oldSettings.downloads.customDirectoryHandleId = "old-folder"
  const stored: Record<string, unknown> = {
    [SETTINGS_STORAGE_KEY]: oldSettings,
  }
  const storage = {
    get: vi.fn(async () => structuredClone(stored)),
    set: vi.fn(async (values: Record<string, unknown>) => {
      Object.assign(stored, structuredClone(values))
    }),
  }
  const effects = vi.fn(async () => undefined)
  function freshRuntime() {
    return new OptionsConfigurationService({
      configurationRepository: new OptionsConfigurationRepository(storage, {
        getSettings: async () => structuredClone(DEFAULT_SETTINGS),
      }),
      settingsRepository: { acceptExternalDocument: vi.fn() },
      historyRepository: {
        getStorageStats: vi.fn(),
        getAllSeriesHistory: vi.fn(),
      },
      applySettingsSideEffects: effects,
      cleanupRateLimiters: vi.fn(),
    })
  }
  async function readPair() {
    const configuration = await freshRuntime().getConfiguration()
    return {
      configuration,
      folder: await loadDownloadRootHandle(
        configuration.settings.downloads.customDirectoryHandleId
      ),
    }
  }
  async function prepare() {
    const configuration = (await readPair()).configuration
    const controller = new OptionsFsaController()
    await controller.stage(newFolder, "new-folder")
    configuration.settings.downloads.customDirectoryHandleId = "new-folder"
    configuration.settings.downloads.pathTemplate = "New/<SERIES_TITLE>"
    return configuration
  }
  return {
    oldFolder,
    newFolder,
    storage,
    effects,
    freshRuntime,
    readPair,
    prepare,
  }
}

beforeEach(() => {
  capabilityStorage.clear()
  vi.clearAllMocks()
})

describe("destination configuration commit", () => {
  it("preserves the saved pair when staging fails", async () => {
    const harness = createHarness()
    vi.mocked(saveDownloadRootHandle).mockRejectedValueOnce(
      new Error("IndexedDB aborted")
    )
    await expect(harness.prepare()).rejects.toThrow("IndexedDB aborted")
    const recovered = await harness.readPair()
    expect(recovered.folder).toBe(harness.oldFolder)
    expect(harness.storage.set).not.toHaveBeenCalled()
  })

  it("retries cleanup of retired capabilities on a later save", async () => {
    const harness = createHarness()
    await harness.prepare()
    const submitted = await harness.prepare()
    vi.mocked(removeUnusedDownloadRootHandles).mockRejectedValueOnce(
      new Error("IndexedDB unavailable")
    )
    const service = harness.freshRuntime()
    await expect(service.saveConfiguration(submitted)).resolves.toEqual(
      submitted
    )
    expect(capabilityStorage.has("old-folder")).toBe(true)
    await service.saveConfiguration(submitted)
    expect([...capabilityStorage.keys()]).toEqual(["new-folder"])
    expect((await harness.readPair()).folder).toBe(harness.newFolder)
  })

  it("preserves staged capabilities belonging to queued saves", async () => {
    const harness = createHarness()
    const first = await harness.prepare()
    const second = structuredClone(first)
    second.settings.downloads.customDirectoryHandleId = "second-folder"
    const secondFolder = folder("Second folder")
    await new OptionsFsaController().stage(secondFolder, "second-folder")
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const commit = harness.storage.set.getMockImplementation()!
    harness.storage.set.mockImplementationOnce(async (values) => {
      await gate
      await commit(values)
    })
    const service = harness.freshRuntime()
    const firstSave = service.saveConfiguration(first)
    await vi.waitFor(() => expect(harness.storage.set).toHaveBeenCalledOnce())
    const secondSave = service.saveConfiguration(second)
    release()
    await expect(firstSave).resolves.toEqual(first)
    await expect(secondSave).resolves.toEqual(second)
    expect((await harness.readPair()).folder).toBe(secondFolder)
    expect([...capabilityStorage.keys()]).toEqual(["second-folder"])
  })

  it("preserves a different page's staged capability before its save is submitted", async () => {
    const harness = createHarness()
    const submitted = await harness.prepare()
    const otherFolder = folder("Other page folder")
    await new OptionsFsaController().stage(otherFolder, "other-page-stage")
    await harness.freshRuntime().saveConfiguration(submitted)
    expect(capabilityStorage.get("other-page-stage")).toBe(otherFolder)
    const otherConfiguration = structuredClone(submitted)
    otherConfiguration.settings.downloads.customDirectoryHandleId =
      "other-page-stage"
    await harness.freshRuntime().saveConfiguration(otherConfiguration)
    expect((await harness.readPair()).folder).toBe(otherFolder)
  })

  it("recovers the saved pair when Options closes after staging and before submission", async () => {
    const harness = createHarness()
    await harness.prepare()

    const recovered = await harness.readPair()
    expect(
      recovered.configuration.settings.downloads.customDirectoryHandleId
    ).toBe("old-folder")
    expect(recovered.configuration.settings.downloads.pathTemplate).toBe(
      DEFAULT_SETTINGS.downloads.pathTemplate
    )
    expect(recovered.folder).toBe(harness.oldFolder)
  })

  it("retains the old pair after a failed configuration write without compensation", async () => {
    const harness = createHarness()
    const submitted = await harness.prepare()
    harness.storage.set.mockRejectedValueOnce(new Error("storage unavailable"))

    await expect(
      harness.freshRuntime().saveConfiguration(submitted)
    ).rejects.toThrow("storage unavailable")
    // Recovery needs reads only, even while further writes remain unavailable.
    harness.storage.set.mockRejectedValue(
      new Error("storage still unavailable")
    )
    const recovered = await harness.readPair()
    expect(
      recovered.configuration.settings.downloads.customDirectoryHandleId
    ).toBe("old-folder")
    expect(recovered.folder).toBe(harness.oldFolder)
    expect(harness.storage.set).toHaveBeenCalledTimes(1)
  })

  it("finishes an accepted save after its Options caller closes", async () => {
    const harness = createHarness()
    const submitted = await harness.prepare()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const commit = harness.storage.set.getMockImplementation()!
    harness.storage.set.mockImplementationOnce(async (values) => {
      await gate
      await commit(values)
    })
    const saving = harness.freshRuntime().saveConfiguration(submitted)
    await vi.waitFor(() => expect(harness.storage.set).toHaveBeenCalledOnce())
    const before = await harness.readPair()
    expect(before.folder).toBe(harness.oldFolder)
    release()
    await saving

    const recovered = await harness.readPair()
    expect(recovered.configuration).toEqual(submitted)
    expect(recovered.folder).toBe(harness.newFolder)
  })

  it("recovers the committed pair after interruption before publication", async () => {
    const harness = createHarness()
    const submitted = await harness.prepare()
    harness.effects.mockRejectedValueOnce(new Error("worker stopped"))

    await expect(
      harness.freshRuntime().saveConfiguration(submitted)
    ).rejects.toThrow("worker stopped")
    const recovered = await harness.readPair()
    expect(recovered.configuration).toEqual(submitted)
    expect(recovered.folder).toBe(harness.newFolder)
    expect(capabilityStorage.has("old-folder")).toBe(false)
  })

  it("keeps the committed pair when storage acknowledges a write ambiguously", async () => {
    const harness = createHarness()
    const submitted = await harness.prepare()
    const commit = harness.storage.set.getMockImplementation()!
    harness.storage.set.mockImplementationOnce(async (values) => {
      await commit(values)
      throw new Error("response lost")
    })
    await expect(
      harness.freshRuntime().saveConfiguration(submitted)
    ).rejects.toThrow("response lost")

    const recovered = await harness.readPair()
    expect(recovered.configuration).toEqual(submitted)
    expect(recovered.folder).toBe(harness.newFolder)
  })
})
