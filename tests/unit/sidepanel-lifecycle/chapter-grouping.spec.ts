import { expect, it } from "vitest"
import { groupChapters } from "@/entrypoints/sidepanel/hooks/sidepanelSeriesContextHelpers"
import type { ChapterState } from "@/src/types/tab-state"

function chapter(id: string, fields: Partial<ChapterState> = {}): ChapterState {
  return {
    id,
    url: `https://example.com/chapter/${id}`,
    title: id,
    index: 1,
    status: "queued",
    lastUpdated: 1,
    ...fields,
  }
}

it("uses catalog labels and leaves unknown categories ungrouped", () => {
  const result = groupChapters(
    [
      chapter("catalog", { volumeId: "catalog", volumeLabel: "Chapter label" }),
      chapter("chapter", { volumeId: "chapter", volumeLabel: "Extras" }),
      chapter("numbered", { volumeId: "numbered", volumeNumber: 4 }),
      chapter("untitled", { volumeId: "untitled" }),
      chapter("unknown", { volumeId: "missing" }),
    ],
    [
      { id: "catalog", label: "Catalog label" },
      { id: "chapter" },
      { id: "numbered" },
      { id: "untitled" },
    ]
  )
  expect(result.map((item) => item.title)).toEqual([
    "Catalog label",
    "Extras",
    "Volume 4",
    "Volume",
    "unknown",
  ])
  expect(result[4]).toMatchObject({ id: "unknown", isStandalone: true })
})

it("returns no rows for an empty chapter list", () => {
  expect(groupChapters([])).toEqual([])
})

it("starts volume groups collapsed and preserves expanded groups", () => {
  const chapters = [
    chapter("first", { volumeNumber: 1 }),
    chapter("second", { volumeNumber: 1 }),
    chapter("third", { volumeNumber: 2 }),
  ]
  const initial = groupChapters(chapters)
  expect(initial).toHaveLength(2)
  expect(initial).toMatchObject([
    { collapsed: true, chapters: [{ id: "first" }, { id: "second" }] },
    { collapsed: true, chapters: [{ id: "third" }] },
  ])

  const expanded = initial.map((row) =>
    "chapters" in row ? { ...row, collapsed: false } : row
  )
  expect(groupChapters(chapters, expanded)).toMatchObject([
    { collapsed: false },
    { collapsed: false },
  ])
})
