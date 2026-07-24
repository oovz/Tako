import { describe, expect, it } from "vitest"

import { reconcileOptionsSave } from "@/entrypoints/options/hooks/options-save-reconciliation"

describe("options save reconciliation", () => {
  it("commits submitted baselines without clearing edits made during the save", () => {
    const submitted = {
      settings: { archiveFormat: "cbz" },
      overrides: { site: { delayMs: 100 } },
      folder: "old-folder",
    }

    expect(
      reconcileOptionsSave({
        submitted,
        persisted: submitted,
        submittedRevision: 4,
        currentRevision: 5,
      })
    ).toEqual({
      saved: submitted,
      clearTransientDraft: false,
      hasUnsavedChanges: true,
    })
  })

  it("clears transient draft state when nothing changed during the save", () => {
    const submitted = { settings: { archiveFormat: "zip" } }

    expect(
      reconcileOptionsSave({
        submitted,
        persisted: submitted,
        submittedRevision: 7,
        currentRevision: 7,
      })
    ).toEqual({
      saved: submitted,
      clearTransientDraft: true,
      hasUnsavedChanges: false,
    })
  })

  it("uses the authoritative normalized persistence result as the saved baseline", () => {
    type SavedSettings = {
      retries: number
      customDirectoryHandleId: string | null
    }
    const submitted: SavedSettings = {
      retries: 99,
      customDirectoryHandleId: null,
    }
    const persisted: SavedSettings = {
      retries: 10,
      customDirectoryHandleId: "download-root",
    }

    expect(
      reconcileOptionsSave({
        submitted,
        persisted,
        submittedRevision: 2,
        currentRevision: 2,
      })
    ).toEqual({
      saved: persisted,
      clearTransientDraft: true,
      hasUnsavedChanges: false,
    })
  })
})
