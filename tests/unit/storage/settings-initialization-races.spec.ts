import { describe, expect, it, vi } from "vitest"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import {
  SETTINGS_STORAGE_KEY,
  SettingsRepository,
} from "@/src/storage/settings-repository"
import { SettingsSubscriber } from "@/src/storage/settings-subscriber"

describe("settings initialization ownership", () => {
  it.each(["external-document", "invalidation"] as const)(
    "observes %s during the initial defaults write",
    async (change) => {
      const next = structuredClone(DEFAULT_SETTINGS)
      next.notifications = false
      let release!: () => void
      const set = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            release = resolve
          })
      )
      const get = vi
        .fn()
        .mockResolvedValueOnce({})
        .mockResolvedValue({ [SETTINGS_STORAGE_KEY]: next })
      vi.stubGlobal("chrome", { storage: { local: { get, set } } })
      const repository = new SettingsRepository("warn")
      const loading = repository.getSettings()
      await vi.waitFor(() => expect(set).toHaveBeenCalledOnce())
      if (change === "external-document")
        repository.acceptExternalDocument(next)
      else repository.invalidateCache()
      release()
      await expect(loading).resolves.toEqual(next)
      expect(repository.getCachedSettings()).toEqual(next)
      expect(get).toHaveBeenCalledTimes(change === "external-document" ? 1 : 2)
    }
  )

  it("registers once and ignores changes to another area or document", () => {
    const listeners: Parameters<
      typeof chrome.storage.onChanged.addListener
    >[0][] = []
    const addListener = vi.fn((listener) => listeners.push(listener))
    vi.stubGlobal("chrome", { storage: { onChanged: { addListener } } })
    const repository = new SettingsRepository("warn")
    const subscriber = new SettingsSubscriber(repository)
    subscriber.register()
    subscriber.register()
    expect(addListener).toHaveBeenCalledOnce()
    listeners[0]!(
      { [SETTINGS_STORAGE_KEY]: { newValue: DEFAULT_SETTINGS } },
      "session"
    )
    listeners[0]!({ other: { newValue: DEFAULT_SETTINGS } }, "local")
    expect(repository.getCachedSettings()).toBeNull()
  })

  it("allows registration after a required storage capability becomes available", () => {
    vi.stubGlobal("chrome", {})
    const subscriber = new SettingsSubscriber(new SettingsRepository("warn"))
    expect(() => subscriber.register()).toThrow(Error)
    const addListener = vi.fn()
    vi.stubGlobal("chrome", { storage: { onChanged: { addListener } } })
    subscriber.register()
    expect(addListener).toHaveBeenCalledOnce()
  })
})
