// @vitest-environment happy-dom

import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { flushSync } from "react-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ActivityTab } from "@/entrypoints/options/tabs/ActivityTab"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"

type StorageListener = Parameters<
  typeof chrome.storage.onChanged.addListener
>[0]

describe("Activity task reads", () => {
  let root: Root
  let container: HTMLDivElement
  const sendMessage = vi.fn()
  const listeners = new Set<StorageListener>()
  const addListener = vi.fn((listener: StorageListener) =>
    listeners.add(listener)
  )
  const empty = {
    success: true,
    data: { tasks: [], queueStorageBytes: 0 },
  }
  const known = {
    success: true,
    data: {
      ...empty.data,
      tasks: [
        {
          id: "known",
          siteIntegrationId: "mangadex",
          mangaId: "series",
          seriesTitle: "Known series",
          chapters: [],
          status: "queued",
          created: 1,
          settingsSnapshot: createTaskSettingsSnapshot(
            DEFAULT_SETTINGS,
            "mangadex"
          ),
        },
      ],
    },
  }

  async function mount() {
    await act(async () =>
      root.render(
        createElement(ActivityTab, {
          onClearChapterHistory: async () => true,
        })
      )
    )
  }

  async function retry() {
    const button = Array.from(container.querySelectorAll("button")).find(
      (item) => item.textContent === "Retry"
    )
    expect(button).toBeDefined()
    await act(async () => button!.click())
  }

  async function change() {
    await act(async () => {
      listeners.forEach((listener) => listener({ downloadQueue: {} }, "local"))
    })
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    vi.stubGlobal("chrome", {
      ...chrome,
      runtime: { sendMessage, getURL: (path: string) => path },
      storage: {
        onChanged: {
          addListener,
          removeListener: (listener: StorageListener) =>
            listeners.delete(listener),
        },
      },
    })
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    listeners.clear()
    vi.resetAllMocks()
    vi.unstubAllGlobals()
  })

  it("reports an initial transport failure and recovers to a successfully empty view", async () => {
    sendMessage.mockRejectedValue(new Error("Sensitive transport details"))
    await mount()
    expect(container.textContent).toContain(
      "Queue and task history could not be loaded."
    )
    expect(container.textContent).not.toContain("No downloads yet")
    expect(container.textContent).not.toContain("Sensitive transport details")
    sendMessage.mockResolvedValue(empty)
    await retry()
    expect(container.textContent).toContain("No downloads yet")
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it.each(["transport", "malformed", "rejection"])(
    "retains known tasks after a %s failure",
    async (failure) => {
      sendMessage.mockResolvedValue(known)
      await mount()
      expect(container.textContent).toContain("Known series")
      if (failure === "transport")
        sendMessage.mockRejectedValue(new Error("Unavailable"))
      else if (failure === "malformed")
        sendMessage.mockResolvedValue({ success: true, data: {} })
      else
        sendMessage.mockResolvedValue({
          success: false,
          error: "Private failure",
        })
      await change()
      expect(container.textContent).toContain(
        "Queue and task history may be out of date."
      )
      expect(container.textContent).toContain("Known series")
      sendMessage.mockResolvedValue(empty)
      await retry()
      expect(container.textContent).toContain("No downloads yet")
      expect(container.querySelector('[role="alert"]')).toBeNull()
    }
  )

  it("recovers a failed storage subscription", async () => {
    addListener.mockImplementationOnce(() => {
      throw new Error("Subscription unavailable")
    })
    sendMessage.mockResolvedValue(empty)
    await mount()
    expect(container.textContent).toContain(
      "Queue and task history could not be loaded."
    )
    await retry()
    expect(container.textContent).toContain("No downloads yet")
    sendMessage.mockResolvedValue(known)
    await change()
    expect(container.textContent).toContain("Known series")
  })

  it("keeps known tasks available throughout a pending refresh and its failure", async () => {
    sendMessage.mockResolvedValue(known)
    await mount()
    const pending = Promise.withResolvers<unknown>()
    sendMessage.mockReturnValueOnce(pending.promise)
    await change()
    expect(container.textContent).toContain("Known series")
    await act(async () => pending.reject(new Error("Refresh unavailable")))
    expect(container.textContent).toContain("Known series")
    expect(container.querySelector('[role="alert"]')).not.toBeNull()
  })

  it("cancels queued subscription startup when the Activity view closes immediately", async () => {
    sendMessage.mockResolvedValue(known)
    act(() => {
      flushSync(() =>
        root.render(
          createElement(ActivityTab, {
            onClearChapterHistory: async () => true,
          })
        )
      )
      root.unmount()
    })
    await act(async () => {})
    expect(addListener).not.toHaveBeenCalled()
    expect(sendMessage).not.toHaveBeenCalled()
    root = createRoot(container)
    await mount()
    expect(container.textContent).toContain("Known series")
    expect(listeners.size).toBeGreaterThan(0)
  })

  it.each(["success", "failure"])(
    "ignores an older request's delayed %s",
    async (outcome) => {
      sendMessage.mockResolvedValue(known)
      await mount()
      const older = Promise.withResolvers<unknown>()
      sendMessage.mockReturnValueOnce(older.promise)
      await change()
      sendMessage.mockResolvedValue(empty)
      await change()
      await act(async () => {
        if (outcome === "success") older.resolve(known)
        else older.reject(new Error("Old failure"))
      })
      expect(container.textContent).toContain("No downloads yet")
      expect(container.textContent).not.toContain("Known series")
      expect(container.querySelector('[role="alert"]')).toBeNull()
    }
  )
})
