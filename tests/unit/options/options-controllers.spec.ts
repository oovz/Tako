import { describe, expect, it, vi } from "vitest"

import { OptionsConfigurationClient } from "@/entrypoints/options/controllers/options-configuration-client"
import { OptionsExternalChangeController } from "@/entrypoints/options/controllers/options-external-change-controller"
import { OptionsFsaController } from "@/entrypoints/options/controllers/options-fsa-controller"
import { OptionsHistoryController } from "@/entrypoints/options/controllers/options-history-controller"
import { OptionsHostPermissionController } from "@/entrypoints/options/controllers/options-host-permission-controller"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import type { OptionsConfigurationData } from "@/src/runtime/runtime-message-contracts"

vi.mock("@/src/storage/fs-access", () => ({
  clearDownloadRootHandle: vi.fn(),
  loadDownloadRootHandle: vi.fn(),
  saveDownloadRootHandle: vi.fn(),
  verifyPermission: vi.fn(),
}))

vi.mock("@/src/site-integrations/host-permission-service", () => ({
  reconcileBroadHttpsPermissionEnablement: vi.fn(),
  removeBroadHttpsPermissionIfUnused: vi.fn(),
  requestIntegrationHostPermission: vi.fn(),
  integrationRequiresBroadHttpsPermission: vi.fn(),
}))

function configurationData(): OptionsConfigurationData {
  return {
    configuration: {
      settings: structuredClone(DEFAULT_SETTINGS),
      overrides: {},
      enablement: {},
      integrationSettings: {},
    },
    historyStats: { totalChapters: 0, totalSeries: 0 },
    historySeries: [],
  }
}

describe("Options configuration and history controllers", () => {
  it("uses typed query and save envelopes and returns strict response data", async () => {
    const sender = vi
      .fn()
      .mockResolvedValueOnce({ success: true, data: configurationData() })
      .mockResolvedValueOnce({
        success: true,
        data: configurationData().configuration,
      })
    const client = new OptionsConfigurationClient(sender as never)
    const loaded = await client.load()
    const saved = await client.save(loaded.configuration)

    expect(loaded).toEqual(configurationData())
    expect(saved).toEqual(loaded.configuration)
    expect(sender).toHaveBeenNthCalledWith(1, {
      target: "background",
      type: "GET_OPTIONS_CONFIGURATION",
    })
    expect(sender).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        target: "background",
        type: "SAVE_OPTIONS_CONFIGURATION",
        payload: { configuration: loaded.configuration },
      })
    )
  })

  it("clears history before refreshing the authoritative projection", async () => {
    const refreshed = configurationData()
    refreshed.historyStats.totalChapters = 2
    const load = vi.fn().mockResolvedValue(refreshed)
    const clear = vi.fn().mockResolvedValue(undefined)
    const controller = new OptionsHistoryController({ load }, clear)

    await expect(controller.clear({ scope: "all" })).resolves.toBe(refreshed)
    expect(clear).toHaveBeenCalledWith({ scope: "all" })
    expect(load).toHaveBeenCalledTimes(1)
    expect(clear.mock.invocationCallOrder[0]).toBeLessThan(
      load.mock.invocationCallOrder[0]
    )
  })
})

describe("Options external-change controller", () => {
  function storageChanges(
    data: OptionsConfigurationData,
    overrides: Partial<
      Record<keyof OptionsConfigurationData["configuration"], unknown>
    > = {}
  ): Record<string, chrome.storage.StorageChange> {
    const configuration = data.configuration
    return {
      "settings:global": {
        newValue: overrides.settings ?? configuration.settings,
      },
      siteOverrides: {
        newValue: overrides.overrides ?? configuration.overrides,
      },
      siteIntegrationEnablement: {
        newValue: overrides.enablement ?? configuration.enablement,
      },
      siteIntegrationSettings: {
        newValue:
          overrides.integrationSettings ?? configuration.integrationSettings,
      },
    }
  }

  it("drops an older projection when a newer storage generation wins", async () => {
    let listener:
      | ((
          changes: Record<string, chrome.storage.StorageChange>,
          areaName: chrome.storage.AreaName
        ) => void)
      | undefined
    const addListener = vi.fn((next) => {
      listener = next
    })
    const removeListener = vi.fn()
    ;(globalThis as Record<string, unknown>).chrome = {
      storage: { onChanged: { addListener, removeListener } },
    }

    const loads: Array<(value: OptionsConfigurationData) => void> = []
    const load = vi.fn(
      () =>
        new Promise<OptionsConfigurationData>((resolve) => {
          loads.push(resolve)
        })
    )
    const onSync = vi.fn()
    const controller = new OptionsExternalChangeController({ load })
    const cleanup = controller.subscribe({
      isSaving: () => false,
      isDirty: () => false,
      hasUnsavedChanges: () => false,
      draftRevision: () => 0,
      onConflict: vi.fn(),
      onSync,
      onError: vi.fn(),
    })

    listener?.({ "settings:global": {} }, "local")
    listener?.({ siteOverrides: {} }, "local")
    loads[0]?.(configurationData())
    await Promise.resolve()
    expect(onSync).not.toHaveBeenCalled()

    const latest = configurationData()
    latest.historyStats.totalSeries = 3
    loads[1]?.(latest)
    await Promise.resolve()
    expect(onSync).toHaveBeenCalledWith(latest)
    expect(controller.revision).toBe(2)

    cleanup()
    expect(removeListener).toHaveBeenCalledTimes(1)
  })

  it("fences initial hydration against a newer external load and local draft", async () => {
    let listener:
      | ((
          changes: Record<string, chrome.storage.StorageChange>,
          areaName: chrome.storage.AreaName
        ) => void)
      | undefined
    const addListener = vi.fn((next) => {
      listener = next
    })
    const removeListener = vi.fn()
    ;(globalThis as Record<string, unknown>).chrome = {
      storage: { onChanged: { addListener, removeListener } },
    }

    const loads: Array<(value: OptionsConfigurationData) => void> = []
    const load = vi.fn(
      () =>
        new Promise<OptionsConfigurationData>((resolve) => {
          loads.push(resolve)
        })
    )
    const onSync = vi.fn()
    const controller = new OptionsExternalChangeController({ load })
    const cleanup = controller.subscribe({
      isSaving: () => false,
      isDirty: () => false,
      hasUnsavedChanges: () => false,
      draftRevision: () => 0,
      onConflict: vi.fn(),
      onSync,
      onError: vi.fn(),
    })

    const initial = controller.loadInitial()
    listener?.({ "settings:global": {} }, "local")
    const external = configurationData()
    external.historyStats.totalSeries = 7
    loads[1]?.(external)
    await Promise.resolve()
    loads[0]?.(configurationData())

    await expect(initial).resolves.toBeNull()
    expect(onSync).toHaveBeenCalledWith(external)

    const localDraft = controller.loadInitial(() => false)
    loads[2]?.(configurationData())
    await expect(localDraft).resolves.toBeNull()

    cleanup()
  })

  it("retains storage changes that arrive while saving as conflicts", () => {
    let listener:
      | ((
          changes: Record<string, chrome.storage.StorageChange>,
          areaName: chrome.storage.AreaName
        ) => void)
      | undefined
    const addListener = vi.fn((next) => {
      listener = next
    })
    const removeListener = vi.fn()
    ;(globalThis as Record<string, unknown>).chrome = {
      storage: { onChanged: { addListener, removeListener } },
    }

    const onConflict = vi.fn()
    const load = vi.fn()
    let saving = true
    const controller = new OptionsExternalChangeController({ load })
    const cleanup = controller.subscribe({
      isSaving: () => saving,
      isDirty: () => false,
      hasUnsavedChanges: () => false,
      draftRevision: () => 1,
      onConflict,
      onSync: vi.fn(),
      onError: vi.fn(),
    })

    listener?.({ siteOverrides: {} }, "local")

    expect(onConflict).toHaveBeenCalledWith(["siteOverrides"])
    expect(load).not.toHaveBeenCalled()
    expect(controller.revision).toBe(1)
    saving = false
    cleanup()
  })

  it("suppresses the exact save event delivered before the save response", () => {
    let listener:
      | ((
          changes: Record<string, chrome.storage.StorageChange>,
          areaName: chrome.storage.AreaName
        ) => void)
      | undefined
    const addListener = vi.fn((next) => {
      listener = next
    })
    const removeListener = vi.fn()
    ;(globalThis as Record<string, unknown>).chrome = {
      storage: { onChanged: { addListener, removeListener } },
    }

    const data = configurationData()
    const onConflict = vi.fn()
    const onSync = vi.fn()
    let saving = true
    const controller = new OptionsExternalChangeController({
      load: vi.fn(),
    })
    const cleanup = controller.subscribe({
      isSaving: () => saving,
      isDirty: () => false,
      hasUnsavedChanges: () => false,
      draftRevision: () => 1,
      onConflict,
      onSync,
      onError: vi.fn(),
    })

    const saveToken = controller.beginSave(data.configuration)
    listener?.(storageChanges(data), "local")

    expect(onConflict).not.toHaveBeenCalled()
    expect(onSync).not.toHaveBeenCalled()
    expect(controller.revision).toBe(0)
    saving = false
    controller.completeSave(saveToken, true)
    cleanup()
  })

  it("keeps a differing concurrent write as a conflict during save", () => {
    let listener:
      | ((
          changes: Record<string, chrome.storage.StorageChange>,
          areaName: chrome.storage.AreaName
        ) => void)
      | undefined
    const addListener = vi.fn((next) => {
      listener = next
    })
    const removeListener = vi.fn()
    ;(globalThis as Record<string, unknown>).chrome = {
      storage: { onChanged: { addListener, removeListener } },
    }

    const data = configurationData()
    const onConflict = vi.fn()
    let saving = true
    const controller = new OptionsExternalChangeController({
      load: vi.fn(),
    })
    const cleanup = controller.subscribe({
      isSaving: () => saving,
      isDirty: () => false,
      hasUnsavedChanges: () => false,
      draftRevision: () => 1,
      onConflict,
      onSync: vi.fn(),
      onError: vi.fn(),
    })

    const saveToken = controller.beginSave(data.configuration)
    const differentSettings = structuredClone(data.configuration.settings)
    differentSettings.notifications = !differentSettings.notifications
    listener?.(
      {
        "settings:global": { newValue: differentSettings },
      },
      "local"
    )

    expect(onConflict).toHaveBeenCalledWith(["settings:global"])
    expect(controller.revision).toBe(1)
    saving = false
    controller.completeSave(saveToken, true)
    cleanup()
  })

  it("matches delayed writes by token so back-to-back saves do not conflict", async () => {
    let listener:
      | ((
          changes: Record<string, chrome.storage.StorageChange>,
          areaName: chrome.storage.AreaName
        ) => void)
      | undefined
    const addListener = vi.fn((next) => {
      listener = next
    })
    const removeListener = vi.fn()
    ;(globalThis as Record<string, unknown>).chrome = {
      storage: { onChanged: { addListener, removeListener } },
    }

    const first = configurationData()
    const second = configurationData()
    second.configuration.settings.notifications = false
    const onConflict = vi.fn()
    const onSync = vi.fn()
    const controller = new OptionsExternalChangeController({
      load: vi.fn().mockResolvedValue(second),
    })
    const cleanup = controller.subscribe({
      isSaving: () => false,
      isDirty: () => false,
      hasUnsavedChanges: () => false,
      draftRevision: () => 1,
      onConflict,
      onSync,
      onError: vi.fn(),
    })

    const firstToken = controller.beginSave(first.configuration)
    controller.completeSave(firstToken, true)
    const secondToken = controller.beginSave(second.configuration)
    controller.completeSave(secondToken, true)

    listener?.(storageChanges(first), "local")
    listener?.(storageChanges(second), "local")

    expect(onConflict).not.toHaveBeenCalled()
    expect(onSync).not.toHaveBeenCalled()
    cleanup()
  })

  it("removes only a failed save marker while retaining later successful writes", () => {
    let listener:
      | ((
          changes: Record<string, chrome.storage.StorageChange>,
          areaName: chrome.storage.AreaName
        ) => void)
      | undefined
    const addListener = vi.fn((next) => {
      listener = next
    })
    const removeListener = vi.fn()
    ;(globalThis as Record<string, unknown>).chrome = {
      storage: { onChanged: { addListener, removeListener } },
    }

    const first = configurationData()
    const second = configurationData()
    second.configuration.settings.notifications = false
    const onConflict = vi.fn()
    const controller = new OptionsExternalChangeController({
      load: vi.fn(),
    })
    const cleanup = controller.subscribe({
      isSaving: () => false,
      isDirty: () => false,
      hasUnsavedChanges: () => false,
      draftRevision: () => 1,
      onConflict,
      onSync: vi.fn(),
      onError: vi.fn(),
    })

    const firstToken = controller.beginSave(first.configuration)
    controller.completeSave(firstToken, false)
    const secondToken = controller.beginSave(second.configuration)
    controller.completeSave(secondToken, true)

    listener?.(storageChanges(second), "local")
    expect(onConflict).not.toHaveBeenCalled()
    cleanup()
  })

  it("retires successful no-op saves without leaving an own-write marker", async () => {
    let listener:
      | ((
          changes: Record<string, chrome.storage.StorageChange>,
          areaName: chrome.storage.AreaName
        ) => void)
      | undefined
    const addListener = vi.fn((next) => {
      listener = next
    })
    const removeListener = vi.fn()
    ;(globalThis as Record<string, unknown>).chrome = {
      storage: { onChanged: { addListener, removeListener } },
    }

    const data = configurationData()
    const load = vi.fn().mockResolvedValue(data)
    const onSync = vi.fn()
    const controller = new OptionsExternalChangeController({ load })
    const cleanup = controller.subscribe({
      isSaving: () => false,
      isDirty: () => false,
      hasUnsavedChanges: () => false,
      draftRevision: () => 1,
      onConflict: vi.fn(),
      onSync,
      onError: vi.fn(),
    })

    const token = controller.beginSave(data.configuration, {
      expectStorageChange: false,
    })
    controller.completeSave(token, true)
    listener?.(storageChanges(data), "local")
    await Promise.resolve()

    expect(load).toHaveBeenCalledTimes(1)
    expect(onSync).toHaveBeenCalledWith(data)
    cleanup()
  })
})

describe("Options host-permission and FSA controllers", () => {
  it("keeps load-time reconciliation in the background and propagates gesture effects", async () => {
    const {
      removeBroadHttpsPermissionIfUnused,
      requestIntegrationHostPermission,
      integrationRequiresBroadHttpsPermission,
    } = await import("@/src/site-integrations/host-permission-service")
    vi.mocked(integrationRequiresBroadHttpsPermission).mockReturnValueOnce(true)
    vi.mocked(requestIntegrationHostPermission).mockResolvedValueOnce(true)

    const controller = new OptionsHostPermissionController()
    await expect(controller.reconcileOnLoad()).resolves.toBeUndefined()
    await expect(controller.requestForEnablement("mangadex")).resolves.toBe(
      true
    )
    await expect(controller.removeUnused({})).resolves.toBeUndefined()
    expect(removeBroadHttpsPermissionIfUnused).toHaveBeenCalledWith({})
  })

  it("classifies picker support, cancellation, denial, and granted handles", async () => {
    const { loadDownloadRootHandle, saveDownloadRootHandle, verifyPermission } =
      await import("@/src/storage/fs-access")
    const handle = { name: "downloads" } as unknown as FileSystemDirectoryHandle
    vi.mocked(verifyPermission).mockResolvedValue(true)
    vi.mocked(loadDownloadRootHandle).mockResolvedValue(handle as never)
    const picker = vi.fn().mockResolvedValue(handle)
    Object.assign(globalThis, { window: { showDirectoryPicker: picker } })

    const controller = new OptionsFsaController()
    await expect(controller.requestFromUser()).resolves.toEqual({
      status: "granted",
      handle,
    })
    await expect(controller.grantSavedAccess()).resolves.toEqual({
      status: "granted",
      handle,
    })
    await controller.save(handle as never)
    expect(saveDownloadRootHandle).toHaveBeenCalledWith(handle)
  })

  it("serializes mutations and skips a stale rollback after a newer repair", async () => {
    const { saveDownloadRootHandle, clearDownloadRootHandle } =
      await import("@/src/storage/fs-access")
    const oldHandle = { name: "old" } as unknown as FileSystemDirectoryHandle
    const repairedHandle = {
      name: "repaired",
    } as unknown as FileSystemDirectoryHandle
    vi.mocked(saveDownloadRootHandle).mockClear()
    vi.mocked(clearDownloadRootHandle).mockClear()
    let releaseOlderSave!: () => void
    const olderSaveGate = new Promise<void>((resolve) => {
      releaseOlderSave = resolve
    })
    vi.mocked(saveDownloadRootHandle)
      .mockImplementationOnce(async () => {
        await olderSaveGate
      })
      .mockResolvedValue(undefined)
    vi.mocked(clearDownloadRootHandle).mockResolvedValue(undefined)

    const controller = new OptionsFsaController()
    const olderSave = controller.save(oldHandle as never)
    await Promise.resolve()
    const oldRevision = controller.revision
    const newerRepair = controller.save(repairedHandle as never)

    await expect(
      controller.restore(oldHandle as never, oldRevision)
    ).resolves.toBe(false)
    releaseOlderSave()
    await olderSave
    await newerRepair
    expect(saveDownloadRootHandle).toHaveBeenCalledTimes(2)
    expect(saveDownloadRootHandle).toHaveBeenNthCalledWith(2, repairedHandle)
    expect(clearDownloadRootHandle).not.toHaveBeenCalled()
  })
})
