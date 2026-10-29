import assert from "node:assert/strict"
import { describe, it, vi } from "vitest"
import {
  expandTemplate,
  getCurrentTimeValues,
  validateTemplate,
  type TemplateContext,
} from "@/src/shared/template-expander"
import {
  resolveDownloadDirectory,
  resolveFileName,
} from "@/src/shared/template-resolver"

const context: TemplateContext = {
  integrationName: "Example",
  publisher: "Publisher",
  seriesTitle: "Series",
  chapterTitle: "Chapter",
  chapterNumber: 3,
  volumeTitle: "Volume",
  volumeNumber: 2,
  currentYear: 2026,
  currentMonth: 10,
  currentDay: 28,
}

const outputContext = {
  ...context,
  chapterTitle: "Chapter",
  date: new Date(2026, 9, 28),
  format: "cbz",
}

describe("template macro expansion", () => {
  it("uses the local calendar with a one-based month for current date macros", () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date(2026, 0, 15, 12))
      assert.deepEqual(getCurrentTimeValues(), {
        currentYear: 2026,
        currentMonth: 1,
        currentDay: 15,
      })
    } finally {
      vi.useRealTimers()
    }
  })

  for (const title of ["Price $$5", "A $& B", "A $` B", "A $' B"]) {
    it(`preserves replacement characters in ${JSON.stringify(title)}`, () => {
      const template = "<SERIES_TITLE>/<SERIES_TITLE>"
      const preview = expandTemplate(template, {
        ...context,
        seriesTitle: title,
      })
      const directory = resolveDownloadDirectory(template, {
        ...outputContext,
        seriesTitle: title,
      })
      assert.equal(preview.success, true)
      assert.equal(preview.expanded, `${title}/${title}`)
      assert.equal(directory.resolvedPath, preview.expanded)
    })
  }

  for (const macro of [
    "CHAPTER_NUMBER_PAD4",
    "series_title",
    "constructor",
    "UNKNOWN_123",
  ]) {
    it(`rejects <${macro}> in preview validation and resolution`, () => {
      const template = `<${macro}>`
      const preview = expandTemplate(template, context)
      assert.equal(validateTemplate(template).valid, false)
      assert.equal(preview.success, false)
      assert.equal(preview.expanded, template)
      assert.deepEqual(preview.errors, [
        `Unknown macros in template: <${macro}>`,
      ])
      assert.equal(resolveFileName(template, outputContext).success, false)
    })
  }

  it("reports an unavailable integration name once as an optional macro", () => {
    const result = expandTemplate(
      "<INTEGRATION_NAME> - <INTEGRATION_NAME><SERIES_TITLE>",
      { ...context, integrationName: undefined }
    )
    assert.equal(result.success, true)
    assert.equal(result.expanded, " - Series")
    assert.deepEqual(result.errors, [])
    assert.deepEqual(result.warnings, [
      "Optional macros unavailable: <INTEGRATION_NAME>",
    ])
  })

  const values: Record<string, string> = {
    YYYY: "2026",
    MM: "10",
    DD: "28",
    PUBLISHER: "Publisher",
    INTEGRATION_NAME: "Example",
    SERIES_TITLE: "Series",
    CHAPTER_TITLE: "Chapter",
    VOLUME_TITLE: "Volume",
    CHAPTER_NUMBER: "3",
    CHAPTER_NUMBER_PAD2: "03",
    CHAPTER_NUMBER_PAD3: "003",
    VOLUME_NUMBER: "2",
    VOLUME_NUMBER_PAD2: "02",
  }
  for (const [macro, value] of Object.entries(values)) {
    it(`uses the same <${macro}> value in previews and saved names`, () => {
      const template = `<${macro}>`
      assert.equal(expandTemplate(template, context).expanded, value)
      assert.equal(resolveFileName(template, outputContext).resolvedName, value)
      assert.equal(
        resolveDownloadDirectory(template, outputContext).resolvedPath,
        value
      )
    })
  }

  it("retains zero and decimal chapter numbers", () => {
    for (const [number, expected] of [
      [0, "000"],
      [1.5, "1.5"],
    ] as const) {
      assert.equal(
        expandTemplate("<CHAPTER_NUMBER_PAD3>", {
          ...context,
          chapterNumber: number,
        }).expanded,
        expected
      )
      assert.equal(
        resolveFileName("<CHAPTER_NUMBER_PAD3>", {
          ...outputContext,
          chapterNumber: number,
        }).resolvedName,
        expected
      )
    }
  })

  it("retains errors for required values and empty interior components", () => {
    assert.deepEqual(
      expandTemplate("<SERIES_TITLE>", { ...context, seriesTitle: "" }).errors,
      ["Required macros unavailable: <SERIES_TITLE>"]
    )
    const result = expandTemplate("Root/<PUBLISHER>/Series", {
      ...context,
      publisher: undefined,
    })
    assert.equal(result.success, false)
    assert.equal(result.expanded, "Root/<PUBLISHER>/Series")
    assert.deepEqual(result.errors, [
      "Template results in empty path components",
    ])
  })
})
