import { describe, expect, it } from "vitest"
import { captureRequestedOutputPath } from "@/src/runtime/task-output-path"

const task = {
  created: 0,
  siteIntegrationId: "test",
  seriesTitle: "Series",
  settingsSnapshot: {
    archiveFormat: "cbz" as const,
    pathTemplate: "Library/<SERIES_TITLE>",
    fileNameTemplate: "<CHAPTER_TITLE>",
  },
}
const chapter = { title: "Chapter 1" }

describe("captured task output paths", () => {
  it("resolves archive paths and loose output directories from captured templates", () => {
    expect(captureRequestedOutputPath(task, chapter)).toBe(
      "Library/Series/Chapter 1.cbz"
    )
    expect(
      captureRequestedOutputPath(
        {
          ...task,
          settingsSnapshot: { ...task.settingsSnapshot, archiveFormat: "none" },
        },
        chapter
      )
    ).toBe("Library/Series/Chapter 1")
  })

  it("fails when a captured directory or filename template cannot resolve", () => {
    expect(() =>
      captureRequestedOutputPath(
        {
          ...task,
          settingsSnapshot: { ...task.settingsSnapshot, pathTemplate: "" },
        },
        chapter
      )
    ).toThrow(Error)
    expect(() =>
      captureRequestedOutputPath(
        {
          ...task,
          settingsSnapshot: { ...task.settingsSnapshot, fileNameTemplate: "" },
        },
        chapter
      )
    ).toThrow(Error)
  })
})
