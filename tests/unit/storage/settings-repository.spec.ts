import { beforeEach, describe, expect, it, vi } from "vitest"

import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import { SettingsDocumentError } from "@/src/domain/settings/schema"
import type { ExtensionSettings } from "@/src/domain/settings/types"
import { SettingsSubscriber } from "@/src/storage/settings-subscriber"
import {
  SETTINGS_STORAGE_KEY,
  SettingsRepository,
} from "@/src/storage/settings-repository"

function cloneSettings(): ExtensionSettings {
  return structuredClone(DEFAULT_SETTINGS)
}

describe("SettingsRepository", () => {
  let storage: Record<string, unknown>
  let get: ReturnType<typeof vi.fn>
  let set: ReturnType<typeof vi.fn>
  let listeners: Array<
    (
      changes: Record<string, chrome.storage.StorageChange>,
      area: chrome.storage.AreaName
    ) => void
  >

  beforeEach(() => {
    storage = {}
    listeners = []
    get = vi.fn(async (keys: string[]) => {
      const result: Record<string, unknown> = {}
      for (const key of keys) if (key in storage) result[key] = storage[key]
      return result
    })
    set = vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(storage, items)
    })
    vi.stubGlobal("chrome", {
      storage: {
        local: { get, set },
        onChanged: {
          addListener: vi.fn((listener) => listeners.push(listener)),
        },
      },
    })
  })

  it("writes exact defaults only when the current key is absent", async () => {
    const repository = new SettingsRepository("warn")
    const result = await repository.getSettings()
    expect(result).toEqual(storage[SETTINGS_STORAGE_KEY])
    expect(set).toHaveBeenCalledTimes(1)
    expect(set).toHaveBeenCalledWith({
      [SETTINGS_STORAGE_KEY]: result,
    })
  })

  it("rejects a present malformed document without replacing it", async () => {
    storage[SETTINGS_STORAGE_KEY] = { notifications: true }
    const repository = new SettingsRepository("warn")
    await expect(repository.getSettings()).rejects.toBeInstanceOf(
      SettingsDocumentError
    )
    expect(set).not.toHaveBeenCalled()
  })

  it("rejects a present document without the current filename template", async () => {
    const settings = cloneSettings()
    delete (settings.downloads as Partial<typeof settings.downloads>)
      .fileNameTemplate
    storage[SETTINGS_STORAGE_KEY] = settings
    const repository = new SettingsRepository("warn")

    await expect(repository.getSettings()).rejects.toBeInstanceOf(
      SettingsDocumentError
    )
    expect(set).not.toHaveBeenCalled()
  })

  it("publishes a clone only after a durable replacement succeeds", async () => {
    const repository = new SettingsRepository("warn")
    await repository.replaceSettings(cloneSettings())
    const next = cloneSettings()
    next.notifications = false
    set.mockRejectedValueOnce(new Error("write failed"))
    await expect(repository.replaceSettings(next)).rejects.toThrow(
      "write failed"
    )
    expect(await repository.getSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it("serializes cold default initialization before a concurrent replacement", async () => {
    let releaseGet!: () => void
    get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseGet = () => resolve({})
        })
    )
    const repository = new SettingsRepository("warn")
    const loading = repository.getSettings()
    const next = cloneSettings()
    next.notifications = false
    const replacing = repository.replaceSettings(next)
    await Promise.resolve()
    releaseGet()
    await loading
    await replacing
    expect(storage[SETTINGS_STORAGE_KEY]).toEqual(next)
    expect(await repository.getSettings()).toEqual(next)
  })

  it("updates cache and side effects for valid external changes, invalidating malformed ones", async () => {
    const repository = new SettingsRepository("warn")
    const subscriber = new SettingsSubscriber(repository)
    subscriber.register()
    const next = cloneSettings()
    next.notifications = false
    listeners[0]!(
      {
        [SETTINGS_STORAGE_KEY]: { oldValue: undefined, newValue: next },
      },
      "local"
    )
    expect(await repository.getSettings()).toEqual(next)
    storage[SETTINGS_STORAGE_KEY] = { invalid: true }
    listeners[0]!(
      {
        [SETTINGS_STORAGE_KEY]: { oldValue: next, newValue: { invalid: true } },
      },
      "local"
    )
    await expect(repository.getSettings()).rejects.toBeInstanceOf(
      SettingsDocumentError
    )
  })

  it("does not republish an in-flight read after accepting an external document", async () => {
    const stale = cloneSettings()
    let releaseRead!: () => void
    get.mockImplementationOnce(
      () =>
        new Promise<Record<string, unknown>>((resolve) => {
          releaseRead = () => resolve({ [SETTINGS_STORAGE_KEY]: stale })
        })
    )
    const repository = new SettingsRepository("warn")
    const loading = repository.getSettings()
    await vi.waitFor(() => expect(get).toHaveBeenCalledOnce())

    const next = cloneSettings()
    next.notifications = false
    repository.acceptExternalDocument(next)
    releaseRead()

    await expect(loading).resolves.toEqual(next)
    expect(repository.getCachedSettings()).toEqual(next)
  })

  it("does not republish an in-flight read after cache invalidation", async () => {
    const stale = cloneSettings()
    const next = cloneSettings()
    next.notifications = false
    storage[SETTINGS_STORAGE_KEY] = next

    let releaseRead!: () => void
    get.mockImplementationOnce(
      () =>
        new Promise<Record<string, unknown>>((resolve) => {
          releaseRead = () => resolve({ [SETTINGS_STORAGE_KEY]: stale })
        })
    )
    const repository = new SettingsRepository("warn")
    const loading = repository.getSettings()
    await vi.waitFor(() => expect(get).toHaveBeenCalledOnce())

    repository.invalidateCache()
    releaseRead()

    await expect(loading).resolves.toEqual(next)
    expect(repository.getCachedSettings()).toEqual(next)
  })
})
