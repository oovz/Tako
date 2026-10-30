import { describe, expect, it } from "vitest"
import { normalizeHistoryView } from "@/entrypoints/sidepanel/hooks/useQueueView"
import {
  getSelectionsForSeries,
  setSelectionsForSeries,
} from "@/entrypoints/sidepanel/hooks/useChapterSelections"

describe("side panel stored views", () => {
  it("shows the five most recently completed terminal tasks and places undated history last", () => {
    const tasks = Array.from({ length: 7 }, (_, index) => ({
      id: String(index),
      seriesKey: "mangadex#series",
      seriesTitle: "Series",
      siteIntegration: "mangadex",
      destination: { kind: "downloads-api" },
      status: "completed",
      chapters: { total: 1, completed: 1, unsuccessful: 0 },
      timestamps: {
        created: index,
        ...(index > 0 ? { completed: index * 10 } : {}),
      },
    }))
    expect(normalizeHistoryView(tasks).map((task) => task.id)).toEqual([
      "6",
      "5",
      "4",
      "3",
      "2",
    ])
    expect(
      normalizeHistoryView([tasks[0], tasks[1]]).map((task) => task.id)
    ).toEqual(["1", "0"])
  })

  it("replaces a same-sized selection, preserves another series, and clears only the requested series", () => {
    const initial = {
      "mangadex#first": ["one", "two"],
      "mangadex#second": ["other"],
    }
    const repeated = setSelectionsForSeries(initial, "mangadex#first", [
      "one",
      "two",
      "one",
    ])
    expect(getSelectionsForSeries(repeated, "mangadex#first")).toEqual([
      "one",
      "two",
    ])
    const replaced = setSelectionsForSeries(repeated, "mangadex#first", [
      "one",
      "three",
    ])
    expect(getSelectionsForSeries(replaced, "mangadex#first")).toEqual([
      "one",
      "three",
    ])
    expect(getSelectionsForSeries(replaced, "mangadex#second")).toEqual([
      "other",
    ])
    const cleared = setSelectionsForSeries(replaced, "mangadex#first", [])
    expect(getSelectionsForSeries(cleared, "mangadex#first")).toEqual([])
    expect(getSelectionsForSeries(cleared, "mangadex#second")).toEqual([
      "other",
    ])
  })
})
