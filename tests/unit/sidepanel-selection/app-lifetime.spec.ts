// @vitest-environment happy-dom

import { webcrypto } from "node:crypto"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SidePanelApp } from "@/entrypoints/sidepanel/SidePanelApp"
import { t } from "@/src/runtime/i18n"
import { SESSION_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import type { QueueTaskSummary } from "@/src/domain/queue/state"
import {
  calculatePhaseWeightedChapterFraction,
  calculateTimeWeightedTaskFraction,
  getInitialProgressPhaseCosts,
} from "@/src/runtime/progress-calculator"

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
  const readSession = vi.fn()
  const progressListeners = new Set<(message: unknown) => void>()

  function sessionData(keys: string | string[]) {
    return Object.fromEntries(
      (Array.isArray(keys) ? keys : [keys])
        .filter((key) => Object.hasOwn(stored, key))
        .map((key) => [key, stored[key]])
    )
  }

  function queueTask(
    id: string,
    status: "downloading" | "queued"
  ): QueueTaskSummary {
    return {
      id,
      seriesKey: `mangadex#${id}`,
      seriesTitle: `Series ${id}`,
      siteIntegration: "mangadex",
      destination: { kind: "downloads-api" },
      status,
      chapters: { total: 2, completed: 0, unsuccessful: 0 },
      timestamps: { created: 1 },
    }
  }

  function headerCount(key: "common_active" | "common_queued") {
    const label = Array.from(container.querySelectorAll("header span")).find(
      (span) => span.textContent === t(key)
    )!
    return Number(label.parentElement!.textContent!.replace(t(key), "").trim())
  }

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
  function tab(view: "queue" | "manga" | "recent") {
    return container.querySelector<HTMLButtonElement>("#panel-tab-" + view)!
  }
  function panel(view: string) {
    return container.querySelector<HTMLElement>("#panel-view-" + view)!
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    vi.stubGlobal("crypto", webcrypto)
    stored.activeTabContextByWindow = projection(3)
    stored.queueView = []
    stored.historyView = []
    stored[SESSION_STORAGE_KEYS.activeTaskProgress] = null
    stored[SESSION_STORAGE_KEYS.activeTaskProgressGeneration] = "panel-worker"
    stored[SESSION_STORAGE_KEYS.activeTaskProgressRevision] = 0
    readSession.mockImplementation(async (keys: string | string[]) =>
      sessionData(keys)
    )
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
          onMessage: {
            addListener: (listener: (message: unknown) => void) =>
              progressListeners.add(listener),
            removeListener: (listener: (message: unknown) => void) =>
              progressListeners.delete(listener),
          },
          onDisconnect: emptyEvent,
          disconnect: vi.fn(),
        }),
      },
      storage: {
        session: {
          get: readSession,
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
    progressListeners.clear()
    Object.keys(stored).forEach((key) => delete stored[key])
    vi.resetAllMocks()
    vi.unstubAllGlobals()
  })

  async function mount() {
    await act(async () => root.render(createElement(SidePanelApp)))
    await act(async () => {
      await Promise.resolve()
    })
    expect(tab("queue")).not.toBeNull()
  }

  it("renders the queue landmark before browser hydration", () => {
    const html = renderToStaticMarkup(createElement(SidePanelApp))
    expect(html).toContain('id="sidepanel-main"')
    expect(html).toContain('href="#sidepanel-main"')
  })

  it("starts on Queue, keeps Manga second, and retains selection across tabs", async () => {
    await mount()
    expect(
      [...container.querySelectorAll('[role="tab"]')].map(
        (item) => item.textContent
      )
    ).toEqual(["Queue", "Manga", "Recent"])
    expect(tab("queue").getAttribute("aria-selected")).toBe("true")
    act(() => tab("manga").click())
    act(() =>
      container.querySelector<HTMLButtonElement>("#select-all-ctx")!.click()
    )
    act(() => tab("recent").click())
    expect(panel("manga").hidden).toBe(true)
    act(() => tab("manga").click())
    expect(
      container.querySelector("#select-all-ctx")?.getAttribute("aria-checked")
    ).toBe("true")
    expect(container.textContent).not.toContain("Search")
  })

  it.each(["Manga", "Settings"])(
    "returns to Queue when Manga disappears with focus on %s",
    async (focusedControl) => {
      stored.activeTabContextByWindow = {
        1: {
          windowId: 1,
          activeTabId: 11,
          revision: 5,
          timestamp: 1,
          context: null,
        },
      }
      await mount()
      expect(tab("manga")).toBeNull()
      stored.activeTabContextByWindow = projection(4)
      await act(async () =>
        listeners.forEach((listener) =>
          listener({ activeTabContextByWindow: {} }, "session")
        )
      )
      expect(tab("manga")).not.toBeNull()
      expect(tab("queue").getAttribute("aria-selected")).toBe("true")
      const settings = container.querySelector<HTMLButtonElement>(
        ".panel-status button"
      )!
      const focused = focusedControl === "Manga" ? tab("manga") : settings
      act(() => {
        tab("manga").click()
        focused.focus()
      })
      stored.activeTabContextByWindow = {
        1: {
          windowId: 1,
          activeTabId: 11,
          revision: 5,
          timestamp: 1,
          context: null,
        },
      }
      await act(async () =>
        listeners.forEach((listener) =>
          listener({ activeTabContextByWindow: {} }, "session")
        )
      )
      expect(tab("manga")).toBeNull()
      expect(tab("queue").getAttribute("aria-selected")).toBe("true")
      expect(document.activeElement).toBe(
        focusedControl === "Manga" ? tab("queue") : settings
      )
    }
  )

  it("returns to Queue after an accepted enqueue and clears only the submitted selection", async () => {
    await mount()
    document.documentElement.dataset.takoMotion = "reduce"
    act(() => tab("manga").click())
    act(() =>
      container.querySelector<HTMLButtonElement>("#select-all-ctx")!.click()
    )
    await act(async () =>
      container.querySelector<HTMLButtonElement>(".panel-primary")!.click()
    )
    await vi.waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "START_DOWNLOAD",
          payload: expect.objectContaining({ selectedChapterIds: ["one"] }),
        })
      )
    )
    await vi.waitFor(() =>
      expect(tab("queue").getAttribute("aria-selected")).toBe("true")
    )
    expect(tab("queue").getAttribute("aria-selected")).toBe("true")
    expect(document.activeElement).toBe(tab("queue"))
    act(() => tab("manga").click())
    expect(
      container.querySelector("#select-all-ctx")?.getAttribute("aria-checked")
    ).toBe("false")
  })

  it("keeps unread counts unavailable and retains real counts after a stale queue read", async () => {
    stored.queueView = [
      queueTask("active", "downloading"),
      queueTask("next", "queued"),
      queueTask("later", "queued"),
    ]
    const pending = Promise.withResolvers<Record<string, unknown>>()
    readSession.mockImplementation((keys: string | string[]) =>
      Array.isArray(keys) && keys.includes(SESSION_STORAGE_KEYS.queueView)
        ? pending.promise
        : Promise.resolve(sessionData(keys))
    )
    await mount()
    expect(Number.isNaN(headerCount("common_active"))).toBe(true)
    expect(Number.isNaN(headerCount("common_queued"))).toBe(true)
    const queueRegion = container.querySelector(
      "[data-sidepanel-queue-region]"
    )!
    const queuePanel = container.querySelector("#panel-view-queue")!
    expect(queueRegion.querySelector('[aria-busy="true"]')).not.toBeNull()
    await act(async () => pending.reject(new Error("Projection unavailable")))
    expect(Number.isNaN(headerCount("common_active"))).toBe(true)
    expect(Number.isNaN(headerCount("common_queued"))).toBe(true)
    expect(queuePanel.querySelector('[role="alert"]')).not.toBeNull()
    readSession.mockImplementation(async (keys: string | string[]) =>
      sessionData(keys)
    )
    await act(async () =>
      queuePanel
        .querySelector<HTMLButtonElement>(".queue-panel-notice button")!
        .click()
    )
    expect(headerCount("common_active")).toBe(1)
    expect(headerCount("common_queued")).toBe(2)
    expect(
      Array.from(queueRegion.querySelectorAll("h3")).map(
        (heading) => heading.textContent
      )
    ).toEqual(["Series active", "Series next", "Series later"])
    expect(queueRegion.querySelector('[aria-busy="true"]')).toBeNull()
    readSession.mockImplementation(async (keys: string | string[]) => {
      if (Array.isArray(keys) && keys.includes(SESSION_STORAGE_KEYS.queueView))
        throw new Error("Refresh unavailable")
      return sessionData(keys)
    })
    await act(async () =>
      listeners.forEach((listener) =>
        listener({ [SESSION_STORAGE_KEYS.queueView]: {} }, "session")
      )
    )
    expect(queuePanel.querySelector('[role="alert"]')).not.toBeNull()
    expect(headerCount("common_active")).toBe(1)
    expect(headerCount("common_queued")).toBe(2)
    expect(queueRegion.querySelectorAll("h3")).toHaveLength(3)
  })

  it("shows validated live progress only beneath its active task", async () => {
    stored.queueView = [
      queueTask("active", "downloading"),
      queueTask("next", "queued"),
    ]
    await mount()
    const queueRegion = container.querySelector(
      "[data-sidepanel-queue-region]"
    )!
    expect(queueRegion.querySelector('[role="status"]')).toBeNull()
    const costs = getInitialProgressPhaseCosts({
      integrationId: "mangadex",
      archiveFormat: "cbz",
      destination: "downloads-api",
    })
    const chapter = {
      chapterId: "one",
      imagesProcessed: 1,
      totalImages: 2,
      stage: "downloading" as const,
      phaseFraction: 0.5,
      updatedAt: 1,
    }
    const snapshot = {
      generation: "panel-worker",
      revision: 1,
      updatedAt: 1,
      taskId: "active",
      status: "downloading",
      stage: chapter.stage,
      phaseFraction: chapter.phaseFraction,
      imagesProcessed: chapter.imagesProcessed,
      totalImages: chapter.totalImages,
      activeChapterCount: 1,
      activeChapters: [chapter],
      outputCommitted: false,
      overallFraction: calculateTimeWeightedTaskFraction({
        totalChapters: 2,
        settledChapters: 0,
        activeChapterFractions: [
          calculatePhaseWeightedChapterFraction({
            costs,
            stage: chapter.stage,
            phaseFraction: chapter.phaseFraction,
          }),
        ],
        destinationCommitted: false,
      }),
    }
    expect(progressListeners.size).toBe(1)
    await act(async () =>
      progressListeners.forEach((listener) =>
        listener({
          type: "ACTIVE_TASK_PROGRESS",
          generation: snapshot.generation,
          revision: snapshot.revision,
          progress: snapshot,
        })
      )
    )
    const active = queueRegion.querySelector('[data-queue-task-id="active"]')!
    const queued = queueRegion.querySelector('[data-queue-task-id="next"]')!
    expect(active.querySelector(".task-chapter-status")).not.toBeNull()
    expect(active.querySelector("progress")).not.toBeNull()
    expect(queued.querySelector('[role="status"]')).toBeNull()
    expect(queued.querySelector('[role="progressbar"]')).toBeNull()
  })
})
