import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { ExternalSettingsConflictBanner } from "@/entrypoints/options/components/ExternalSettingsConflictBanner"
import {
  mergeOptionsDraftOntoLatest,
  type OptionsConfigurationSnapshot,
} from "@/entrypoints/options/state/options-configuration-reducer"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"

function createSnapshot(): OptionsConfigurationSnapshot {
  return {
    settings: structuredClone(DEFAULT_SETTINGS),
    overrides: {},
    enablement: {},
    integrationSettings: {},
  }
}

describe("Options external-change reconciliation", () => {
  it("surfaces explicit reload and keep-mine choices", () => {
    const html = renderToStaticMarkup(
      React.createElement(ExternalSettingsConflictBanner, {
        isResolving: false,
        onReload: () => undefined,
        onKeepMine: () => undefined,
      })
    )

    expect(html).toContain("Settings changed elsewhere")
    expect(html).toContain("Reload settings")
    expect(html).toContain("Keep my changes")
  })

  it("keeps local edits while accepting unrelated external updates", () => {
    const baseline = createSnapshot()
    const draft = structuredClone(baseline)
    const latest = structuredClone(baseline)

    draft.settings.downloads.pathTemplate = "Local/<SERIES_TITLE>"
    latest.settings.motionPreference = "reduce"
    latest.enablement.manhuagui = false

    const merged = mergeOptionsDraftOntoLatest(baseline, draft, latest)

    expect(merged.settings.downloads.pathTemplate).toBe("Local/<SERIES_TITLE>")
    expect(merged.settings.motionPreference).toBe("reduce")
    expect(merged.enablement.manhuagui).toBe(false)
  })

  it("keeps the local value when both sides edit the same field", () => {
    const baseline = createSnapshot()
    const draft = structuredClone(baseline)
    const latest = structuredClone(baseline)

    draft.settings.downloads.pathTemplate = "Local"
    latest.settings.downloads.pathTemplate = "External"

    expect(
      mergeOptionsDraftOntoLatest(baseline, draft, latest).settings.downloads
        .pathTemplate
    ).toBe("Local")
  })

  it("preserves local deletions and merges disjoint map entries", () => {
    const baseline = createSnapshot()
    baseline.integrationSettings = {
      mangadex: { imageQuality: "data-saver", retained: true },
    }
    const draft = structuredClone(baseline)
    const latest = structuredClone(baseline)

    delete draft.integrationSettings.mangadex.imageQuality
    latest.integrationSettings.mangadex.chapterLanguageFilter = ["en"]
    latest.integrationSettings["pixiv-comic"] = { futureSetting: "value" }

    const merged = mergeOptionsDraftOntoLatest(baseline, draft, latest)

    expect(merged.integrationSettings).toEqual({
      mangadex: {
        retained: true,
        chapterLanguageFilter: ["en"],
      },
      "pixiv-comic": { futureSetting: "value" },
    })
  })
})
