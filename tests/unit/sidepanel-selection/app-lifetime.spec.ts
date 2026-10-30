// @vitest-environment happy-dom

import { webcrypto } from "node:crypto"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SidePanelApp } from "@/entrypoints/sidepanel/SidePanelApp"
import { t } from "@/src/runtime/i18n"
import { SESSION_STORAGE_KEYS } from "@/src/runtime/storage-keys"

type StorageListener = Parameters<
  typeof chrome.storage.onChanged.addListener
>[0]
const sourceUrl = "https://mangadex.org/title/series"
const mangaState = {
  sourceUrl,
  siteIntegrationId: "mangadex",
  mangaId: "series",
  seriesTitle: "A series",
  chapters: [
    {
      id: "one",
      url: "https://mangadex.org/chapter/one",
      title: "One",
      index: 1,
      status: "queued",
      lastUpdated: 1,
    },
  ],
  volumes: [],
  lastUpdated: 1,
}

describe("real side panel composition", () => {
  let root: Root
  let container: HTMLDivElement
  const stored: Record<string, unknown> = {}
  const listeners = new Set<StorageListener>()
  const emptyEvent = { addListener: vi.fn(), removeListener: vi.fn() }
  const sendMessage = vi.fn()

  function projection(revision: number) {
    return {
      1: {
        windowId: 1,
        activeTabId: 11,
        revision,
        timestamp: 1,
        context: mangaState,
      },
    }
  }
  function trigger() {
    return container.querySelector<HTMLButtonElement>(
      'button[aria-controls="inline-selection-panel"]'
    )!
  }
  function region() {
    return container.querySelector<HTMLElement>(
      "[data-sidepanel-selection-region]"
    )!
  }
  function finishTransition(
    propertyName = "flex-grow",
    target: Element = region()
  ) {
    const event = new Event("transitionend", { bubbles: true })
    Object.defineProperty(event, "propertyName", { value: propertyName })
    act(() => target.dispatchEvent(event))
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    vi.stubGlobal("crypto", webcrypto)
    stored.activeTabContextByWindow = projection(3)
    stored.queueView = []
    stored.historyView = []
    sendMessage.mockImplementation(async (message: { type: string }) => {
      switch (message.type) {
        case "GET_UI_PREFERENCES":
          return {
            success: true,
            data: { motionPreference: "system", uiLanguage: "auto" },
          }
        case "GET_PERSISTENT_ERRORS":
          return { success: true, data: [] }
        case "GET_SIDEPANEL_DOWNLOAD_STATE":
          return { success: true, data: { downloadedChapters: [] } }
        case "START_DOWNLOAD":
          return { success: true, taskId: "accepted" }
        default:
          return { success: true }
      }
    })
    vi.stubGlobal("chrome", {
      ...chrome,
      windows: { getCurrent: async () => ({ id: 1 }) },
      tabs: {
        query: async () => [
          { id: 11, windowId: 1, active: true, url: sourceUrl },
        ],
        onActivated: emptyEvent,
        onUpdated: emptyEvent,
      },
      runtime: {
        sendMessage,
        getURL: (path: string) => `chrome-extension://test/${path}`,
        connect: () => ({
          onMessage: emptyEvent,
          onDisconnect: emptyEvent,
          disconnect: vi.fn(),
        }),
      },
      storage: {
        session: {
          get: async (keys: string | string[]) =>
            Object.fromEntries(
              (Array.isArray(keys) ? keys : [keys])
                .filter((key) => Object.hasOwn(stored, key))
                .map((key) => [key, stored[key]])
            ),
          set: async (value: Record<string, unknown>) =>
            Object.assign(stored, value),
          remove: async (key: string) => {
            delete stored[key]
          },
        },
        onChanged: {
          addListener: (listener: StorageListener) => listeners.add(listener),
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
    delete document.documentElement.dataset.takoMotion
    listeners.clear()
    Object.keys(stored).forEach((key) => delete stored[key])
    vi.resetAllMocks()
    vi.unstubAllGlobals()
  })

  async function mount() {
    await act(async () => root.render(createElement(SidePanelApp)))
    await act(async () => {
      await Promise.resolve()
    })
    expect(trigger()).not.toBeNull()
  }

  it("renders the queue landmark before browser hydration", () => {
    const html = renderToStaticMarkup(createElement(SidePanelApp))
    expect(html).toContain('id="sidepanel-main"')
    expect(html).toContain('href="#sidepanel-main"')
  })

  it("keeps the selector until its own closing layout transition, and ignores stale and bubbled transitions", async () => {
    await mount()
    act(() => trigger().click())
    expect(region().dataset.state).toBe("open")
    expect(container.querySelector("#select-all-ctx")).not.toBeNull()
    act(() => trigger().click())
    expect(region().dataset.state).toBe("closed")
    finishTransition("opacity")
    finishTransition("flex-grow", region().firstElementChild!)
    expect(container.querySelector("#select-all-ctx")).not.toBeNull()
    act(() => trigger().click())
    finishTransition()
    expect(region().dataset.state).toBe("open")
    expect(container.querySelector("#select-all-ctx")).not.toBeNull()
    act(() => trigger().click())
    finishTransition()
    expect(container.querySelector("#select-all-ctx")).toBeNull()
  })

  it("closes on a new series revision and retains the series selection after reopening", async () => {
    await mount()
    act(() => trigger().click())
    act(() =>
      container.querySelector<HTMLButtonElement>("#select-all-ctx")!.click()
    )
    stored.activeTabContextByWindow = projection(4)
    await act(async () =>
      listeners.forEach((listener) =>
        listener(
          { [SESSION_STORAGE_KEYS.activeTabContextByWindow]: {} },
          "session"
        )
      )
    )
    expect(region().dataset.state).toBe("closed")
    finishTransition()
    act(() => trigger().click())
    expect(
      container.querySelector("#select-all-ctx")?.getAttribute("data-state")
    ).toBe("checked")
  })

  it("collapses immediately with reduced motion and restores trigger focus after enqueue", async () => {
    await mount()
    document.documentElement.dataset.takoMotion = "reduce"
    act(() => trigger().click())
    act(() =>
      container.querySelector<HTMLButtonElement>("#select-all-ctx")!.click()
    )
    const start = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) =>
      button.textContent?.includes(t("sidepanel_downloadCount", ["1"]))
    )
    expect(start).toBeDefined()
    await act(async () => start!.click())
    await vi.waitFor(() =>
      expect(
        sendMessage.mock.calls.some(
          ([message]) => message.type === "START_DOWNLOAD"
        )
      ).toBe(true)
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(region().dataset.state).toBe("closed")
    expect(container.querySelector("#select-all-ctx")).toBeNull()
    expect(document.activeElement).toBe(trigger())
  })
})
