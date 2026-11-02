// @vitest-environment happy-dom
import { act, createElement, createRef } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Collapsible } from "@/components/ui/collapsible"
import { SeriesContextCard } from "@/entrypoints/sidepanel/components/SeriesContextCard"
import { CoverPreview } from "@/entrypoints/sidepanel/components/CoverPreview"
import { TAB_NOT_SUPPORTED_MSG } from "@/entrypoints/sidepanel/messages"
import { series } from "./fixtures"

describe("series card and cover presentation", () => {
  let root: Root
  let container: HTMLDivElement
  const sendMessage = vi.fn()
  const onOpenChange = vi.fn()
  const triggerRef = createRef<HTMLButtonElement>()

  async function render(data = series(), open = false) {
    await act(async () =>
      root.render(
        createElement(
          Collapsible,
          { open, onOpenChange },
          createElement(SeriesContextCard, {
            data,
            isExpanded: open,
            triggerRef,
          })
        )
      )
    )
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    vi.stubGlobal("chrome", {
      ...chrome,
      runtime: {
        getURL: (path: string) => `chrome-extension://test/${path}`,
        sendMessage,
      },
    })
    sendMessage.mockResolvedValue({ success: false, error: "Unavailable" })
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    window.dispatchEvent(new Event("pagehide"))
    vi.restoreAllMocks()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it("shows loading before stale failure or series data and gives retry its own action", async () => {
    const retry = vi.fn()
    await render(series({ isLoading: true, retrySeriesContext: retry }))
    expect(container.querySelector("h2")).toBeNull()
    expect(container.querySelector("button")).toBeNull()
    await render(series({ retrySeriesContext: retry }))
    const action = container.querySelector("button")!
    expect(action.disabled).toBe(false)
    expect(action.hasAttribute("aria-expanded")).toBe(false)
    expect(action.hasAttribute("aria-controls")).toBe(false)
    await act(async () => action.click())
    expect(retry).toHaveBeenCalledOnce()
    expect(onOpenChange).not.toHaveBeenCalled()
    await render(series({ blockingMessage: TAB_NOT_SUPPORTED_MSG }))
    expect(container.querySelector("button")?.disabled).toBe(true)
    await render(series({ mangaTitle: "" }))
    expect(container.querySelector("h2")).not.toBeNull()
    expect(container.querySelector("button")).toBeNull()
  })

  it("renders series counts and closes an expanded selector while chapters reload", async () => {
    await render(
      series({ author: "Artist", chapterListNotice: "adult-consent-required" })
    )
    expect(container.querySelector("h2")?.textContent).toBe("Series One")
    expect(container.textContent).toContain("Artist · MangaDex")
    expect(container.textContent).toContain("3 Chapters")
    expect(container.textContent).toContain("1 Volumes")
    expect(triggerRef.current).toBe(container.querySelector("button"))
    triggerRef.current!.focus()
    expect(document.activeElement).toBe(triggerRef.current)
    await act(async () => triggerRef.current!.click())
    expect(onOpenChange).toHaveBeenLastCalledWith(true)
    await render(series({ items: [], isChaptersLoading: true }), true)
    expect(triggerRef.current!.disabled).toBe(false)
    expect(triggerRef.current!.getAttribute("aria-expanded")).toBe("true")
    await act(async () => triggerRef.current!.click())
    expect(onOpenChange).toHaveBeenLastCalledWith(false)
    await render(series({ items: [] }))
    expect(triggerRef.current!.disabled).toBe(true)
    await render(series({ isChaptersLoading: true }))
    expect(triggerRef.current!.disabled).toBe(true)
    await render(series({ tabId: undefined }))
    expect(triggerRef.current!.disabled).toBe(true)
  })

  it.each([
    "siteId",
    "coverUrl",
    "seriesId",
    "tabId",
    "windowId",
    "seriesRevision",
  ] as const)(
    "requests no cover without the full authorization identity: %s",
    async (missing) => {
      const complete = series({
        coverUrl: "https://uploads.mangadex.org/cover.jpg",
      })
      await render({
        ...complete,
        [missing]: undefined,
      })
      expect(sendMessage).not.toHaveBeenCalled()
      expect(
        container
          .querySelector("[data-preview-state]")
          ?.getAttribute("data-preview-state")
      ).toBe("fallback")
      await render(complete)
      expect(sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "GET_COVER_PREVIEW",
          payload: expect.objectContaining({
            source: {
              kind: "series",
              tabId: 7,
              windowId: 3,
              seriesId: "one",
              seriesRevision: 2,
            },
          }),
        })
      )
    }
  )

  it("shows a pending cover, recovers from an image failure, and accepts a fresh preview URL", async () => {
    const response = Promise.withResolvers<unknown>()
    sendMessage.mockReturnValueOnce(response.promise)
    vi.spyOn(URL, "createObjectURL")
      .mockReturnValueOnce("blob:one")
      .mockReturnValueOnce("blob:two")
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {})
    vi.stubGlobal(
      "Image",
      class {
        src = ""
        naturalWidth = 20
        naturalHeight = 30
        async decode() {}
        removeAttribute() {}
      }
    )
    const identity = {
      integrationId: "mangadex",
      coverUrl: "https://uploads.mangadex.org/one.jpg",
      source: { kind: "task" as const, taskId: "one" },
    }
    const preview = (request = identity) =>
      createElement(CoverPreview, { identity: request, alt: "Cover" })
    await act(async () => root.render(preview()))
    expect(container.firstElementChild?.getAttribute("aria-busy")).toBe("true")
    await act(async () =>
      response.resolve({
        success: true,
        integrationId: identity.integrationId,
        coverUrl: identity.coverUrl,
        base64: btoa("image"),
        mimeType: "image/jpeg",
      })
    )
    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:one")
    await act(async () =>
      container.querySelector("img")!.dispatchEvent(new Event("error"))
    )
    expect(
      container.firstElementChild?.getAttribute("data-preview-state")
    ).toBe("fallback")
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "chrome-extension://test/icon/128.png"
    )
    await act(async () =>
      container.querySelector("img")!.dispatchEvent(new Event("error"))
    )
    sendMessage.mockResolvedValueOnce({
      success: true,
      integrationId: identity.integrationId,
      coverUrl: "https://uploads.mangadex.org/two.jpg",
      base64: btoa("image"),
      mimeType: "image/jpeg",
    })
    await act(async () =>
      root.render(
        preview({
          ...identity,
          coverUrl: "https://uploads.mangadex.org/two.jpg",
        })
      )
    )
    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:two")
    expect(
      container.firstElementChild?.getAttribute("data-preview-state")
    ).toBe("ready")
  })
})
