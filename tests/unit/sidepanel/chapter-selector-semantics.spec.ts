import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { ChapterSelector } from "@/entrypoints/sidepanel/components/ChapterSelector"

vi.mock("@/src/runtime/i18n", () => ({ t: (key: string) => key }))

const callbacks = {
  onToggleGroup: vi.fn(),
  onToggleChapter: vi.fn(),
  onVolumeSelectAll: vi.fn(),
}

describe("ChapterSelector semantics", () => {
  it("uses the checkbox as the only keyboard control for a chapter row", () => {
    const markup = renderToStaticMarkup(
      createElement(ChapterSelector, {
        items: [
          {
            id: "chapter-1",
            title: "Chapter 1",
            url: "https://example.com/1",
            index: 1,
            selected: false,
            status: "queued",
            isStandalone: true,
          },
        ],
        viewMode: "chapters",
        expandedGroups: new Set<string>(),
        isEnqueuing: false,
        ...callbacks,
      })
    )

    expect(markup).not.toContain('role="button"')
    expect(markup.match(/role="checkbox"/g)).toHaveLength(1)
    expect(markup).not.toContain('tabindex="0"')
  })

  it("renders the volume disclosure and select-all checkbox as sibling controls", () => {
    const markup = renderToStaticMarkup(
      createElement(ChapterSelector, {
        items: [
          {
            groupId: "volume-1",
            title: "Volume 1",
            collapsed: true,
            chapters: [
              {
                id: "chapter-1",
                title: "Chapter 1",
                url: "https://example.com/1",
                index: 1,
                selected: false,
                status: "queued",
              },
            ],
          },
        ],
        viewMode: "volumes",
        expandedGroups: new Set<string>(),
        isEnqueuing: false,
        ...callbacks,
      })
    )

    expect(markup.match(/<button/g)).toHaveLength(2)
    expect(markup).not.toContain('role="button"')
    expect(markup).toContain('aria-expanded="false"')
  })

  it("renders an accessible marker for a previously downloaded chapter", () => {
    const markup = renderToStaticMarkup(
      createElement(ChapterSelector, {
        items: [
          {
            id: "chapter-1",
            title: "Chapter 1",
            url: "https://example.com/1",
            index: 1,
            selected: false,
            downloaded: true,
            status: "queued",
            isStandalone: true,
          },
        ],
        viewMode: "chapters",
        expandedGroups: new Set<string>(),
        isEnqueuing: false,
        ...callbacks,
      })
    )

    expect(markup).toContain("data-downloaded-marker")
    expect(markup).toContain("status_completed")
    expect(markup.match(/role="checkbox"/g)).toHaveLength(1)
  })

  it("keeps virtualization enabled when a large volume is collapsed or expanded", () => {
    const chapters = Array.from({ length: 48 }, (_, index) => ({
      id: `chapter-${index + 1}`,
      title: `Chapter ${index + 1}`,
      url: `https://example.com/${index + 1}`,
      index: index + 1,
      selected: false,
      status: "queued" as const,
    }))
    const items = [
      {
        groupId: "volume-1",
        title: "Volume 1",
        collapsed: true,
        chapters,
      },
    ]
    const render = (expandedGroups: Set<string>) =>
      renderToStaticMarkup(
        createElement(ChapterSelector, {
          items,
          viewMode: "volumes",
          expandedGroups,
          isEnqueuing: false,
          ...callbacks,
        })
      )

    expect(render(new Set<string>())).toContain('data-virtualized="true"')
    expect(render(new Set<string>(["volume-1"]))).toContain(
      'data-virtualized="true"'
    )
  })
})
