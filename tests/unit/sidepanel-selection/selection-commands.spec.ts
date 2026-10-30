// @vitest-environment happy-dom

import { act, createElement, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useSelection } from "@/entrypoints/sidepanel/hooks/useSelection"
import type {
  SidePanelChapter,
  VolumeOrChapter,
} from "@/entrypoints/sidepanel/types"

function chapter(id: string, locked = false): SidePanelChapter {
  return {
    id,
    title: id,
    index: 1,
    url: `https://example.com/${id}`,
    status: "queued",
    selected: false,
    locked,
  }
}

describe("mounted chapter selection commands", () => {
  let root: Root
  let container: HTMLDivElement
  let commands: ReturnType<typeof useSelection>
  let selected: string[]
  let collapsed: Set<string>
  const chapters = [
    chapter("one"),
    chapter("locked", true),
    chapter("three"),
    chapter("four"),
  ]

  function View({
    downloading = false,
    tabId = 0,
  }: {
    downloading?: boolean
    tabId?: number | null
  }) {
    const [ids, setIds] = useState<string[]>([])
    const [groups, setGroups] = useState(new Set<string>())
    selected = ids
    collapsed = groups
    const items: VolumeOrChapter[] = [
      {
        groupId: "volume",
        title: "Volume",
        collapsed: false,
        chapters: chapters
          .slice(0, 3)
          .map((ch) => ({ ...ch, selected: ids.includes(ch.id) })),
      },
      { ...chapters[3], isStandalone: true, selected: ids.includes("four") },
    ]
    commands = useSelection({
      items,
      setSelectedChapterIds: setIds,
      setCollapsedGroups: setGroups,
      tabId: tabId ?? undefined,
      isDownloading: downloading,
    })
    return createElement("output", null, ids.join(","))
  }

  function render(props: Parameters<typeof View>[0] = {}) {
    act(() => root.render(createElement(View, props)))
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    render()
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it("selects and deselects anchored ranges across groups while excluding locked chapters", () => {
    act(() => commands.handleChapterSelect("one", true))
    act(() => commands.handleChapterSelect("four", true, true))
    expect(selected).toEqual(["one", "three", "four"])
    act(() => commands.handleChapterSelect("three", false, true))
    expect(selected).toEqual(["four"])
    act(() => commands.handleChapterSelect("locked", true))
    act(() => commands.handleChapterSelect("missing", true))
    expect(container.textContent).toBe("four")
  })

  it("toggles a volume independently, honors explicit select-all, and treats indeterminate as toggle", () => {
    act(() => commands.handleChapterSelect("four", true))
    act(() => commands.handleVolumeSelectAll("volume"))
    expect(selected).toEqual(["four", "one", "three"])
    act(() => commands.handleVolumeSelectAll("volume"))
    expect(selected).toEqual(["four"])
    act(() => commands.handleSelectAll(true))
    expect(selected).toEqual(["four", "one", "three"])
    act(() => commands.handleSelectAll("indeterminate"))
    expect(selected).toEqual([])
    act(() => commands.handleVolumeSelectAll("missing"))
    expect(selected).toEqual([])
    act(() => commands.handleVolumeToggle("volume"))
    expect([...collapsed]).toEqual(["volume"])
    act(() => commands.handleVolumeToggle("volume"))
    expect([...collapsed]).toEqual([])
  })

  it.each([{ downloading: true }, { tabId: null }])(
    "keeps selection and presentation while commands are unavailable: %o",
    (props) => {
      render(props)
      act(() => {
        commands.handleChapterSelect("one", true)
        commands.handleSelectAll(true)
        commands.handleVolumeSelectAll("volume")
        commands.handleVolumeToggle("volume")
      })
      expect(selected).toEqual([])
      expect([...collapsed]).toEqual([])
    }
  )
})
