// @vitest-environment happy-dom

import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useInlineSelectionState } from "@/entrypoints/sidepanel/hooks/useInlineSelectionState"

type Context = Parameters<typeof useInlineSelectionState>[0]
type ActivatedListener = (info: chrome.tabs.OnActivatedInfo) => void
type UpdatedListener = (id: number, info: chrome.tabs.OnUpdatedInfo) => void

describe("rendered inline selection state", () => {
  let root: Root
  let container: HTMLDivElement
  let selection: ReturnType<typeof useInlineSelectionState>
  const context: Context = { windowId: 1, tabId: 11, seriesRevision: 3 }
  const activated = new Set<ActivatedListener>()
  const updated = new Set<UpdatedListener>()

  function Selector({ owner }: { owner: Context }) {
    selection = useInlineSelectionState(owner)
    return createElement(
      "output",
      null,
      selection.isInlineSelectionOpen ? "open" : "closed"
    )
  }

  function render(owner = context) {
    act(() => root.render(createElement(Selector, { owner })))
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    vi.stubGlobal("chrome", {
      tabs: {
        onActivated: {
          addListener: (listener: ActivatedListener) => activated.add(listener),
          removeListener: (listener: ActivatedListener) =>
            activated.delete(listener),
        },
        onUpdated: {
          addListener: (listener: UpdatedListener) => updated.add(listener),
          removeListener: (listener: UpdatedListener) =>
            updated.delete(listener),
        },
      },
    })
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    render()
    act(() => {
      selection.setChapterSelectionsBySeries({ "mangadex:one": ["chapter-1"] })
      selection.setPresentationBySeries({
        "mangadex:one": { viewMode: "chapters", collapsedGroupIds: [] },
      })
      selection.setInlineSelectionOpen(true)
    })
    expect(container.textContent).toBe("open")
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    activated.clear()
    updated.clear()
    vi.unstubAllGlobals()
  })

  it("keeps selection open through unrelated browser activity and same-owner renders", () => {
    act(() => {
      activated.forEach((listener) => listener({ tabId: 22, windowId: 2 }))
      updated.forEach((listener) =>
        listener(12, { url: "https://example.com/redirect" })
      )
    })
    render({ ...context })
    expect(container.textContent).toBe("open")
    expect(selection.chapterSelectionsBySeries).toEqual({
      "mangadex:one": ["chapter-1"],
    })
  })

  it.each<Partial<Context>>([
    { windowId: 2 },
    { tabId: 12 },
    { seriesRevision: 4 },
    { seriesRevision: undefined },
  ])("closes when the owning context changes: %o", (change) => {
    render({ ...context, ...change })
    expect(container.textContent).toBe("closed")
    render(context)
    expect(container.textContent).toBe("closed")
    act(() => selection.setInlineSelectionOpen(true))
    expect(container.textContent).toBe("open")
    expect(selection.chapterSelectionsBySeries).toEqual({
      "mangadex:one": ["chapter-1"],
    })
    expect(selection.presentationBySeries).toEqual({
      "mangadex:one": { viewMode: "chapters", collapsedGroupIds: [] },
    })
  })

  it("closes explicitly and retains mounted-panel state when reopened", () => {
    act(() => selection.closeInlineSelection())
    expect(container.textContent).toBe("closed")
    act(() => selection.setInlineSelectionOpen(true))
    expect(container.textContent).toBe("open")
    expect(selection.chapterSelectionsBySeries).toEqual({
      "mangadex:one": ["chapter-1"],
    })
  })
})
