// @vitest-environment happy-dom
import { act, createElement, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SeriesInlineSelection } from "@/entrypoints/sidepanel/components/SeriesInlineSelection"
import type { ChapterSelectionsBySeries } from "@/entrypoints/sidepanel/hooks/useChapterSelections"
import type { InlineSelectionPresentationBySeries } from "@/entrypoints/sidepanel/types"
import type { SidepanelSeriesContextData } from "@/entrypoints/sidepanel/hooks/useSidepanelSeriesContext"
import { chapter, series } from "./fixtures"

describe("mounted series selection", () => {
  let root: Root
  let container: HTMLDivElement
  let selections: ChapterSelectionsBySeries
  let presentation: InlineSelectionPresentationBySeries
  const onAfterStart = vi.fn()
  const sendMessage = vi.fn()
  const session: Record<string, unknown> = {}

  function Selection({ data }: { data: SidepanelSeriesContextData }) {
    const [selected, setSelected] = useState<ChapterSelectionsBySeries>({
      "mangadex#one": ["locked"],
      "mangadex#other": ["other-chapter"],
    })
    const [views, setViews] = useState<InlineSelectionPresentationBySeries>({})
    selections = selected
    presentation = views
    return createElement(SeriesInlineSelection, {
      data,
      chapterSelectionsBySeries: selected,
      setChapterSelectionsBySeries: setSelected,
      presentationBySeries: views,
      setPresentationBySeries: setViews,
      onAfterStart,
    })
  }

  async function render(data = series()) {
    await act(async () => root.render(createElement(Selection, { data })))
  }

  function checkbox(label: string): HTMLButtonElement {
    const control = container.querySelector<HTMLButtonElement>(
      `[role="checkbox"][aria-label="${label}"]`
    )
    if (!control) throw new Error(`Missing checkbox: ${label}`)
    return control
  }

  function button(label: string): HTMLButtonElement {
    const control = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent?.includes(label)
    )
    if (!control) throw new Error(`Missing button: ${label}`)
    return control
  }

  async function click(control: HTMLElement) {
    await act(async () => control.click())
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    vi.stubGlobal("chrome", {
      ...chrome,
      runtime: { sendMessage },
      storage: {
        session: {
          get: async () => ({ ...session }),
          set: async (value: Record<string, unknown>) =>
            Object.assign(session, value),
          remove: async (key: string) => {
            delete session[key]
          },
        },
      },
    })
    sendMessage.mockResolvedValue({ success: true, taskId: "new-task" })
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    for (const key of Object.keys(session)) delete session[key]
  })

  it("keeps locked chapters unselected and separates volume disclosure from selection", async () => {
    await render()
    expect(checkbox("Chapter locked").disabled).toBe(true)
    expect(checkbox("Chapter locked").getAttribute("aria-checked")).toBe(
      "false"
    )
    const disclosure =
      container.querySelector<HTMLButtonElement>("[aria-expanded]")!
    const volumeCheckbox = checkbox("Select all 2 chapters in volume Volume 1")
    expect(volumeCheckbox.getAttribute("aria-checked")).toBe("false")
    await click(volumeCheckbox)
    expect(disclosure.getAttribute("aria-expanded")).toBe("true")
    expect(selections["mangadex#one"]).toEqual(["one"])
    expect(volumeCheckbox.getAttribute("aria-checked")).toBe("true")
    expect(checkbox("Chapter locked").getAttribute("aria-checked")).toBe(
      "false"
    )
    checkbox("Chapter one").focus()
    expect(document.activeElement).toBe(checkbox("Chapter one"))
    await act(async () =>
      checkbox("Chapter one").dispatchEvent(
        new KeyboardEvent("keydown", { key: " ", bubbles: true })
      )
    )
    expect(disclosure.getAttribute("aria-expanded")).toBe("true")
    await click(checkbox("Chapter one"))
    expect(selections["mangadex#one"]).toBeUndefined()
    expect(volumeCheckbox.getAttribute("aria-checked")).toBe("false")
    await click(disclosure)
    expect(container.querySelector('[aria-label="Chapter one"]')).toBeNull()
    expect(presentation["mangadex#one"].collapsedGroupIds).toEqual(["volume-1"])
    expect(selections["mangadex#other"]).toEqual(["other-chapter"])
  })

  it("retains series view and collapse choices across context switches", async () => {
    await render()
    await click(container.querySelector<HTMLButtonElement>("[aria-expanded]")!)
    await click(button("All chapters"))
    expect(checkbox("Chapter one")).toBeTruthy()
    await click(button("All chapters"))
    expect(presentation["mangadex#one"].viewMode).toBe("chapters")
    await render(series({ seriesId: "other" }))
    expect(presentation["mangadex#other"]).toBeUndefined()
    await render()
    expect(button("All chapters").getAttribute("aria-checked")).toBe("true")
    await click(button("Volumes"))
    expect(container.querySelector('[aria-label="Chapter one"]')).toBeNull()
    expect(presentation["mangadex#one"].collapsedGroupIds).toEqual(["volume-1"])
  })

  it("preserves selections after enqueue failure and clears only the accepted series on success", async () => {
    await render()
    await click(container.querySelector<HTMLButtonElement>("#select-all-ctx")!)
    expect(selections["mangadex#one"]).toEqual(["one", "extra"])
    sendMessage.mockResolvedValueOnce({
      success: false,
      error: "Rejected",
      code: "stale_series_context",
    })
    await click(button("Download (2)"))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(container.querySelector('[role="alert"]')).not.toBeNull()
    expect(selections["mangadex#one"]).toEqual(["one", "extra"])
    expect(onAfterStart).not.toHaveBeenCalled()
    await click(button("Download (2)"))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(sendMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "START_DOWNLOAD",
        payload: {
          sourceWindowId: 3,
          sourceTabId: 7,
          sourceUrl: "https://mangadex.org/title/one",
          siteIntegrationId: "mangadex",
          seriesId: "one",
          seriesRevision: 2,
          selectedChapterIds: ["one", "extra"],
        },
      })
    )
    expect(selections["mangadex#one"]).toBeUndefined()
    expect(selections["mangadex#other"]).toEqual(["other-chapter"])
    expect(onAfterStart).toHaveBeenCalledOnce()
  })

  it("enqueues only the selected unlocked chapter from a partial selection", async () => {
    await render()
    await click(checkbox("Chapter one"))
    expect(selections["mangadex#one"]).toEqual(["one"])
    expect(checkbox("Chapter extra").getAttribute("aria-checked")).toBe("false")
    expect(
      container.querySelector("#select-all-ctx")?.getAttribute("aria-checked")
    ).toBe("false")
    expect(checkbox("Chapter locked").disabled).toBe(true)
    expect(checkbox("Chapter locked").getAttribute("aria-checked")).toBe(
      "false"
    )

    const pending = Promise.withResolvers<unknown>()
    sendMessage.mockReturnValueOnce(pending.promise)
    await click(button("Download (1)"))
    await vi.waitFor(() =>
      expect(sendMessage).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          type: "START_DOWNLOAD",
          payload: expect.objectContaining({ selectedChapterIds: ["one"] }),
        })
      )
    )
    expect(selections["mangadex#one"]).toEqual(["one"])
    await act(async () =>
      pending.resolve({ success: true, taskId: "new-task" })
    )
    expect(selections["mangadex#one"]).toBeUndefined()
    expect(selections["mangadex#other"]).toEqual(["other-chapter"])
    expect(onAfterStart).toHaveBeenCalledOnce()
  })

  it("toggles a chapter through its title without changing another chapter", async () => {
    await render()
    const title = Array.from(container.querySelectorAll("span")).find(
      (element) => element.textContent === "Chapter one"
    )!
    await click(title)
    expect(selections["mangadex#one"]).toEqual(["one"])
    expect(checkbox("Chapter one").getAttribute("aria-checked")).toBe("true")
    expect(checkbox("Chapter extra").getAttribute("aria-checked")).toBe("false")
    await click(title)
    expect(selections["mangadex#one"]).toBeUndefined()
    expect(checkbox("Chapter one").getAttribute("aria-checked")).toBe("false")
  })

  it("reopens a single-chapter volume and reflects its selection in the volume checkbox", async () => {
    const data = series()
    const onlyChapter = chapter("one", { volumeId: "single" })
    await render(
      series({
        mangaState: {
          ...data.mangaState!,
          chapters: [onlyChapter],
          volumes: [{ id: "single", title: "Single chapter" }],
        },
        items: [
          {
            groupId: "single",
            title: "Single chapter",
            collapsed: false,
            chapters: [onlyChapter],
          },
        ],
      })
    )
    const disclosure =
      container.querySelector<HTMLButtonElement>("[aria-expanded]")!
    const selectVolume = checkbox(
      "Select all 1 chapters in volume Single chapter"
    )
    expect(disclosure.getAttribute("aria-expanded")).toBe("true")
    expect(checkbox("Chapter one").disabled).toBe(false)
    expect(selectVolume.getAttribute("aria-checked")).toBe("false")
    await click(disclosure)
    expect(disclosure.getAttribute("aria-expanded")).toBe("false")
    expect(container.querySelector('[aria-label="Chapter one"]')).toBeNull()
    await click(disclosure)
    expect(disclosure.getAttribute("aria-expanded")).toBe("true")
    await click(checkbox("Chapter one"))
    expect(selections["mangadex#one"]).toEqual(["one"])
    expect(selectVolume.getAttribute("aria-checked")).toBe("true")
    await click(selectVolume)
    expect(selections["mangadex#one"]).toBeUndefined()
    expect(checkbox("Chapter one").getAttribute("aria-checked")).toBe("false")
  })

  it("leaves global and volume selection unchecked when there are no chapters", async () => {
    const data = series()
    await render(
      series({
        mangaState: {
          ...data.mangaState!,
          chapters: [],
          volumes: [{ id: "empty", title: "Empty volume" }],
        },
        items: [
          {
            groupId: "empty",
            title: "Empty volume",
            collapsed: false,
            chapters: [],
          },
        ],
      })
    )
    const selectAll =
      container.querySelector<HTMLButtonElement>("#select-all-ctx")!
    const selectVolume = checkbox(
      "Select all 0 chapters in volume Empty volume"
    )
    for (const control of [selectAll, selectVolume]) {
      expect(control.disabled).toBe(true)
      expect(control.getAttribute("aria-checked")).toBe("false")
      await click(control)
    }
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it("enqueues ordinary first and last choices without selecting the middle chapter and accepts a one-character ID", async () => {
    const chapters = [chapter("1"), chapter("middle"), chapter("last")]
    const data = series()
    await render(
      series({
        items: chapters.map((item) => ({ ...item, isStandalone: true })),
        mangaState: { ...data.mangaState!, chapters },
      })
    )
    await click(checkbox("Chapter 1"))
    await click(checkbox("Chapter last"))
    expect(selections["mangadex#one"]).toEqual(["1", "last"])
    expect(checkbox("Chapter middle").getAttribute("aria-checked")).toBe(
      "false"
    )
    expect(
      container.querySelector("#select-all-ctx")?.getAttribute("aria-checked")
    ).toBe("false")
    await click(button("Download (2)"))
    await vi.waitFor(() => expect(onAfterStart).toHaveBeenCalledOnce())
    expect(sendMessage).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        type: "START_DOWNLOAD",
        payload: {
          sourceWindowId: 3,
          sourceTabId: 7,
          sourceUrl: "https://mangadex.org/title/one",
          siteIntegrationId: "mangadex",
          seriesId: "one",
          seriesRevision: 2,
          selectedChapterIds: ["1", "last"],
        },
      })
    )
    expect(selections["mangadex#one"]).toBeUndefined()
    expect(selections["mangadex#other"]).toEqual(["other-chapter"])
  })

  it("unchecks a selected standalone chapter that becomes locked before submitting another choice", async () => {
    await render()
    await click(checkbox("Chapter extra"))
    expect(checkbox("Chapter extra").getAttribute("aria-checked")).toBe("true")
    const refreshed = series()
    await render(
      series({
        seriesRevision: 3,
        items: [
          refreshed.items[0],
          { ...chapter("extra", { locked: true }), isStandalone: true },
        ],
        mangaState: {
          ...refreshed.mangaState!,
          chapters: [
            chapter("one"),
            chapter("locked", { locked: true }),
            chapter("extra", { locked: true }),
          ],
        },
      })
    )
    expect(checkbox("Chapter extra").disabled).toBe(true)
    expect(checkbox("Chapter extra").getAttribute("aria-checked")).toBe("false")
    await click(checkbox("Chapter one"))
    expect(selections["mangadex#one"]).toEqual(["one"])
    await click(button("Download (1)"))
    await vi.waitFor(() => expect(onAfterStart).toHaveBeenCalledOnce())
    expect(sendMessage).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        type: "START_DOWNLOAD",
        payload: expect.objectContaining({
          seriesRevision: 3,
          selectedChapterIds: ["one"],
        }),
      })
    )
  })

  it("keeps controls disabled during an enqueue and displays loading before the list is ready", async () => {
    await render(series({ isChaptersLoading: true }))
    expect(
      container.querySelector('[role="status"]')?.getAttribute("aria-busy")
    ).toBe("true")
    expect(container.querySelector('[role="checkbox"]')).toBeNull()
    await render()
    await click(container.querySelector<HTMLButtonElement>("#select-all-ctx")!)
    const pending = Promise.withResolvers<unknown>()
    sendMessage.mockReturnValueOnce(pending.promise)
    await click(button("Download (2)"))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(
      Array.from(
        container.querySelectorAll<HTMLButtonElement>('[role="checkbox"]')
      ).every((control) => control.disabled)
    ).toBe(true)
    await act(async () =>
      pending.resolve({ success: false, error: "Rejected" })
    )
    expect(checkbox("Chapter one").disabled).toBe(false)
    await render(series({ blockingMessage: "unsupported" }))
    expect(container.textContent).toBe("")
  })
})
