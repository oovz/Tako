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

it("labels explicit categories from their catalog or chapter metadata and retains unknown membership as standalone", () => {
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
