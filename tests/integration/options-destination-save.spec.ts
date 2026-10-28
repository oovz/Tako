import {
  buildStartDownloadTask,
  loadStartDownloadSettingsInputs,
} from "@/entrypoints/background/download-queue-enqueue"
import { runDestinationAccessExclusive } from "@/entrypoints/background/destination-access"
import { SettingsRepository } from "@/src/storage/settings-repository"
import { DestinationHandleCollector } from "@/entrypoints/background/destination-handle-collector"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { OptionsConfigurationService } from "@/entrypoints/background/options-configuration-service"
import { OptionsFsaController } from "@/entrypoints/options/controllers/options-fsa-controller"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import type { DownloadTaskState } from "@/src/domain/queue/state"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { migrateDurableStateForCurrentSchema } from "@/src/runtime/state-schema-migration"
import { LOCAL_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import { HistoryRepository } from "@/src/storage/history-repository"
import { QueueProjectionService } from "@/src/storage/queue-projection-service"
import { QueueRepository } from "@/src/storage/queue-repository"
import { OptionsConfigurationRepository } from "@/src/storage/options-configuration-repository"
import { SETTINGS_STORAGE_KEY } from "@/src/storage/settings-repository"
import {
  loadDownloadRootHandle,
  saveDownloadRootHandle,
  collectUnusedDownloadRootHandles,
} from "@/src/storage/fs-access"

const managedIds = vi.hoisted(() => new Set<string>())
const capabilityStorage = vi.hoisted(
  () => new Map<string, FileSystemDirectoryHandle>()
)
vi.mock("@/src/storage/fs-access", () => ({
  saveDownloadRootHandle: vi.fn(async (handle, id) => {
    if (capabilityStorage.has(id)) throw new Error("Handle ID already exists")
    capabilityStorage.set(id, handle)
  }),
  loadDownloadRootHandle: vi.fn(async (id) => capabilityStorage.get(id)),
  checkPermissionBeforeWrite: vi.fn(async () => undefined),
  adoptDownloadRootHandle: vi.fn(async (id: string) => {
    managedIds.add(id)
  }),
  collectUnusedDownloadRootHandles: vi.fn(
    async (retained: ReadonlySet<string>) => {
      for (const id of managedIds)
        if (!retained.has(id)) {
          capabilityStorage.delete(id)
          managedIds.delete(id)
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
    remove: vi.fn(async (keys: string | string[]) => {
      for (const key of [keys].flat()) delete stored[key]
    }),
  }
  const effects = vi.fn(async () => undefined)
  function freshRuntime() {
    const service: OptionsConfigurationService =
      new OptionsConfigurationService({
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
        collectUnusedHandles: () => collector.collect(),
      })
    const collector: DestinationHandleCollector =
      new DestinationHandleCollector({
        queueRepository: {
          getRetainedHandleIds: async () => {
            const tasks = [
              ...((stored[
                LOCAL_STORAGE_KEYS.downloadQueue
              ] as DownloadTaskState[]) ?? []),
              ...(
                (stored[LOCAL_STORAGE_KEYS.pendingUndoActions] as {
                  taskSnapshot: DownloadTaskState
                }[]) ?? []
              ).map((action) => action.taskSnapshot),
            ]
            return new Set(
              tasks.flatMap((task) =>
                task.settingsSnapshot.destination.kind ===
                  "file-system-access" &&
                task.settingsSnapshot.destination.handleId
                  ? [task.settingsSnapshot.destination.handleId]
                  : []
              )
            )
          },
        },
        settingsRepository: {
          reload: async () =>
            structuredClone(stored[SETTINGS_STORAGE_KEY] as typeof oldSettings),
        },
        pendingHandleIds: () => service.getPendingHandleIds(),
      })
    return service
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
  managedIds.clear()
  vi.clearAllMocks()
})

afterEach(() => vi.unstubAllGlobals())

describe("destination configuration commit", () => {
  it.each(["get", "set", "remove"] as const)(
    "preserves folder settings and intentional history clearing through a migration %s failure",
    async (operation) => {
      const harness = createHarness()
      const submitted = await harness.prepare()
      const task: DownloadTaskState = {
        id: "retained-task",
        siteIntegrationId: "mangadex",
        mangaId: "series",
        seriesTitle: "Series",
        status: "completed",
        created: 1,
        completed: 20,
        settingsSnapshot: createTaskSettingsSnapshot(
          DEFAULT_SETTINGS,
          "mangadex"
        ),
        chapters: [5, 20].map((lastUpdated) => ({
          requestedPath: "Tako/Chapter.cbz",
          id: `chapter-${lastUpdated}`,
          url: `https://mangadex.org/chapter/chapter-${lastUpdated}`,
          title: `Chapter ${lastUpdated}`,
          index: lastUpdated === 5 ? 0 : 1,
          status: "completed",
          lastUpdated,
          outputs: { requested: 1, committed: 1, failed: 0 },
        })),
      }
      const sourceTask = {
        ...task,
        settingsSnapshot: {
          ...task.settingsSnapshot,
          destination: task.settingsSnapshot.destination.kind,
        },
        chapters: task.chapters.map(
          ({ requestedPath: _path, ...chapter }) => chapter
        ),
      }
      await harness.storage.set({
        stateSchemaEpoch: 2,
        [LOCAL_STORAGE_KEYS.downloadQueue]: [sourceTask],
        [LOCAL_STORAGE_KEYS.downloadedChapters]: [],
        [LOCAL_STORAGE_KEYS.seriesDownloadHistory]: {},
        [LOCAL_STORAGE_KEYS.downloadHistoryClearCutoffs]: {
          allBefore: 10,
          bySeries: {},
          byChapter: {},
        },
      })
      vi.stubGlobal("chrome", {
        storage: {
          local: harness.storage,
          session: { set: vi.fn(async () => undefined) },
        },
      })
      harness.storage[operation].mockRejectedValueOnce(
        new Error("storage unavailable")
      )
      await expect(migrateDurableStateForCurrentSchema()).rejects.toThrow(
        "storage unavailable"
      )
      const retained = await harness.storage.get()
      const retainedSettings = retained[SETTINGS_STORAGE_KEY] as {
        downloads: { customDirectoryHandleId: string }
      }
      expect(
        await loadDownloadRootHandle(
          retainedSettings.downloads.customDirectoryHandleId
        )
      ).toBe(harness.oldFolder)

      await migrateDurableStateForCurrentSchema()
      const history = new HistoryRepository()
      const queue = new QueueRepository(new QueueProjectionService(), history)
      await queue.initialize()
      expect((await queue.getTask(task.id))?.chapters).toHaveLength(2)
      await queue.clearTerminalHistory()
      expect(await queue.getQueue()).toEqual([])
      expect(await history.getDownloadedChapters()).toMatchObject([
        { chapterId: "chapter-20", downloadedAt: 20 },
      ])
      expect((await history.getAggregate()).clearCutoffs.allBefore).toBe(10)

      await harness.freshRuntime().saveConfiguration(submitted)
      const recovered = await harness.readPair()
      expect(recovered.configuration).toEqual(submitted)
      expect(recovered.folder).toBe(harness.newFolder)
      expect(
        await new HistoryRepository().getDownloadedChapters()
      ).toMatchObject([{ chapterId: "chapter-20", downloadedAt: 20 }])
    }
  )

  it("captures committed defaults when a save response is lost before its cache publication", async () => {
    const harness = createHarness()
    const submitted = await harness.prepare()
    vi.stubGlobal("chrome", {
      storage: {
        local: harness.storage,
        session: { set: vi.fn(async () => undefined) },
      },
      action: {
        setBadgeText: vi.fn(async () => undefined),
        setBadgeBackgroundColor: vi.fn(async () => undefined),
      },
    })
    const settings = new SettingsRepository("warn")
    expect(
      (await settings.getSettings()).downloads.customDirectoryHandleId
    ).toBe("old-folder")
    let release!: () => void
    const pause = new Promise<void>((resolve) => {
      release = resolve
    })
    const commit = harness.storage.set.getMockImplementation()!
    harness.storage.set.mockImplementationOnce(async (values) => {
      await pause
      await commit(values)
      throw new Error("response lost")
    })
    const saving = harness
      .freshRuntime()
      .saveConfiguration(submitted)
      .catch((error) => error)
    await vi.waitFor(() => expect(harness.storage.set).toHaveBeenCalledOnce())
    const chapter = {
      id: "chapter",
      url: "https://mangadex.org/chapter/chapter",
      title: "Chapter",
      index: 0,
      status: "queued" as const,
      lastUpdated: 1,
    }
    const queue = new QueueRepository(
      new QueueProjectionService(),
      new HistoryRepository()
    )
    const creating = runDestinationAccessExclusive(async () => {
      const inputs = await loadStartDownloadSettingsInputs("mangadex", {
        settingsRepository: settings,
        siteOverridesService: { getAll: async () => ({}) },
        siteIntegrationSettingsService: { getForSite: async () => ({}) },
      })
      const task = buildStartDownloadTask({
        settingsInputs: inputs,
        taskId: "captured",
        now: 1,
        selectedChapters: [chapter],
        context: {
          sourceUrl: "https://mangadex.org/title/series",
          siteIntegrationId: "mangadex",
          mangaId: "series",
          seriesTitle: "Series",
          chapters: [chapter],
          volumes: [],
          lastUpdated: 1,
        },
      })
      await queue.enqueueDownloadTask(task)
      return task
    })
    release()
    const captured = await creating
    expect(await saving).toEqual(new Error("response lost"))
    expect(captured.settingsSnapshot.destination).toEqual({
      kind: "file-system-access",
      handleId: "new-folder",
    })
    expect(captured.chapters[0].requestedPath).toBe("New/Series/Chapter.cbz")
    expect(capabilityStorage.get("new-folder")).toBe(harness.newFolder)
  })

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
    const submitted = await harness.prepare()
    vi.mocked(collectUnusedDownloadRootHandles).mockRejectedValueOnce(
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
