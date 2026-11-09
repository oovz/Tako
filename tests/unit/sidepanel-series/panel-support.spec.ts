// @vitest-environment happy-dom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ErrorBanner } from "@/entrypoints/sidepanel/components/ErrorBanner"
import { SidePanelHeader } from "@/entrypoints/sidepanel/components/SidePanelHeader"
import { RecentDownloads } from "@/entrypoints/sidepanel/components/RecentDownloads"
import type { DownloadedChapterRecord } from "@/src/domain/history/types"
import type { PersistentError } from "@/src/runtime/persistent-error-schema"

describe("panel support views", () => {
  let root: Root
  let container: HTMLDivElement
  let errors: PersistentError[]
  const listeners = new Set<
    Parameters<typeof chrome.storage.onChanged.addListener>[0]
  >()
  const sendMessage = vi.fn()

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    vi.stubGlobal("chrome", {
      ...chrome,
      runtime: {
        getURL: (path: string) => `chrome-extension://test/${path}`,
        sendMessage,
      },
      storage: {
        session: {
          get: async () => ({ initFailed: true, error: "secret-diagnostic" }),
        },
        onChanged: {
          addListener: (
            listener: Parameters<typeof chrome.storage.onChanged.addListener>[0]
          ) => listeners.add(listener),
          removeListener: (
            listener: Parameters<typeof chrome.storage.onChanged.addListener>[0]
          ) => listeners.delete(listener),
        },
      },
    })
    errors = [
      {
        code: "provider_changed",
        severity: "warning",
        message: "secret-diagnostic",
        ts: 1,
      },
      {
        code: "RECOVERY_FAILED",
        severity: "error",
        message: "secret-diagnostic",
        ts: 2,
      },
      {
        code: "FSA_HANDLE_INVALID",
        severity: "warning",
        message: "secret-diagnostic",
        ts: 3,
      },
    ]
    sendMessage.mockImplementation(async (request: { type: string }) =>
      request.type === "GET_PERSISTENT_ERRORS"
        ? { success: true, data: errors }
        : { success: true }
    )
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    listeners.clear()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it("dismisses the selected sanitized error and leaves folder failures to the folder banner", async () => {
    await act(async () => root.render(createElement(ErrorBanner)))
    expect(container.textContent).not.toContain("secret-diagnostic")
    expect(container.textContent).toContain("Warning")
    expect(container.querySelectorAll("button")).toHaveLength(2)
    await act(async () =>
      container.querySelector<HTMLButtonElement>("button")!.click()
    )
    expect(sendMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "ACKNOWLEDGE_ERROR",
        payload: { code: "provider_changed" },
      })
    )
    errors = []
    await act(async () =>
      listeners.forEach((listener) =>
        listener({ persistent_errors: {} }, "local")
      )
    )
    expect(container.querySelectorAll("button")).toHaveLength(0)
    expect(container.textContent).toContain("initialization failed")
    expect(listeners.size).toBe(2)
  })

  it("opens settings from its accessible header action and represents pending and bounded counts", async () => {
    const onOpenSettings = vi.fn()
    const view = (hasOptionsActionItems: boolean, activeCount: number | null) =>
      createElement(
        TooltipProvider,
        null,
        createElement(SidePanelHeader, {
          activeCount,
          queuedCount: 100,
          hasOptionsActionItems,
          onOpenSettings,
        })
      )
    await act(async () => root.render(view(false, null)))
    expect(container.textContent).toContain("—")
    expect(container.textContent).toContain("99+")
    await act(async () =>
      container.querySelector<HTMLButtonElement>("button")!.click()
    )
    expect(onOpenSettings).toHaveBeenCalledOnce()
    await act(async () => root.render(view(true, 1)))
    expect(
      container.querySelector("button")?.getAttribute("aria-label")
    ).toContain("Action item")
    await act(async () => root.render(view(false, -1)))
    expect(container.textContent).toContain("0")
  })

  it("keeps loading and read failures distinct from an empty recent history and offers retry", async () => {
    const retry = vi.fn()
    const render = async (status: "loading" | "error" | "ready") =>
      act(async () =>
        root.render(
          createElement(RecentDownloads, {
            chapters: [],
            status,
            onRetry: retry,
            onViewHistory: vi.fn(),
          })
        )
      )
    await render("loading")
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(container.textContent).not.toContain("No saved chapters")
    await render("error")
    expect(container.querySelector('[role="alert"]')).not.toBeNull()
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[role="alert"] button')!
        .click()
    )
    expect(retry).toHaveBeenCalledOnce()
    await render("ready")
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(container.textContent).toContain("No saved chapters yet.")
  })

  it("shows twenty recent chapters with their source and keeps full history available when empty", () => {
    const chapters: DownloadedChapterRecord[] = Array.from(
      { length: 21 },
      (_, index) => ({
        siteIntegrationId: "mangadex",
        seriesId: "series",
        chapterId: String(index),
        seriesTitle: "Series " + index,
        title: "Chapter " + index,
        url: "https://mangadex.org/chapter/" + index,
        downloadedAt: index + 1,
        saveConfirmedAt: index + 1,
        outputDestination: "downloads-api",
        format: "cbz",
      })
    )
    const render = (items = chapters) =>
      renderToStaticMarkup(
        createElement(RecentDownloads, {
          chapters: items,
          onViewHistory: vi.fn(),
        })
      )
    const document = window.document.implementation.createHTMLDocument()
    document.body.innerHTML = render()
    expect(document.querySelectorAll(".recent-row")).toHaveLength(20)
    expect(document.querySelector(".recent-copy strong")?.textContent).toBe(
      "Series 20"
    )
    expect(document.body.textContent).toContain("MangaDex")
    expect(document.querySelector("time")?.getAttribute("datetime")).toBe(
      new Date(21).toISOString()
    )
    expect(render([])).toContain("View history in Options")
  })
})
