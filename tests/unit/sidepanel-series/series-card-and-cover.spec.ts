// @vitest-environment happy-dom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SeriesContextCard } from "@/entrypoints/sidepanel/components/SeriesContextCard"
import { CoverPreview } from "@/entrypoints/sidepanel/components/CoverPreview"
import { series } from "./fixtures"

describe("series card and cover presentation", () => {
  let root: Root
  let container: HTMLDivElement
  const sendMessage = vi.fn()
  async function render(data = series()) {
    await act(async () =>
      root.render(createElement(SeriesContextCard, { data }))
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

  it("shows the author and counts without repeating the site integration", async () => {
    await render(
      series({ author: "Artist", chapterListNotice: "adult-consent-required" })
    )
    expect(container.querySelector("h1")?.textContent).toBe("Series One")
    expect(container.textContent).toContain("Artist")
    expect(container.textContent).not.toContain("MangaDex")
    expect(container.textContent).toContain("3 chapters")
    expect(container.textContent).toContain("1 volume")
  })

  it("makes the narrow header details reversible without changing selection", async () => {
    await render(series({ author: "A long author name" }))
    const details = container.querySelector<HTMLButtonElement>(
      ".manga-details-toggle"
    )!
    expect(details.getAttribute("aria-expanded")).toBe("false")
    await act(async () => details.click())
    expect(details.getAttribute("aria-expanded")).toBe("true")
    expect(
      container.querySelector(".manga-header")?.getAttribute("data-details")
    ).toBe("true")
    await act(async () => details.click())
    expect(details.getAttribute("aria-expanded")).toBe("false")
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
    expect(container.querySelector("img")).toBeNull()
    expect(container.querySelector(".cover-placeholder")).not.toBeNull()
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
