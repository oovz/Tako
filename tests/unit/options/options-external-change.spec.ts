import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ExternalSettingsConflictBanner } from "@/entrypoints/options/components/ExternalSettingsConflictBanner"
import {
  mergeOptionsDraftOntoLatest,
  type OptionsConfigurationSnapshot,
} from "@/entrypoints/options/state/options-configuration-reducer"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import { OptionsConfigurationClient } from "@/entrypoints/options/controllers/options-configuration-client"
import type { RuntimeMessage } from "@/src/runtime/runtime-message-contracts"

afterEach(() => vi.unstubAllGlobals())

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
    latest.enablement.readmanga = false

    const merged = mergeOptionsDraftOntoLatest(baseline, draft, latest)

    expect(merged.settings.downloads.pathTemplate).toBe("Local/<SERIES_TITLE>")
    expect(merged.settings.motionPreference).toBe("reduce")
    expect(merged.enablement.readmanga).toBe(false)
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

  it("saves a rebase with local language selections and deletions alongside external unedited fields", async () => {
    const baseline = createSnapshot()
    baseline.integrationSettings = {
      mangadex: { chapterLanguageFilter: [] },
    }
    baseline.overrides = {
      "pixiv-comic": { outputFormat: "zip" },
      mangadex: { pathTemplate: "Base", retries: { image: 2 } },
    }
    const draft = structuredClone(baseline)
    draft.integrationSettings.mangadex.chapterLanguageFilter = ["en"]
    draft.overrides.mangadex.pathTemplate = "Local/<SERIES_TITLE>"
    delete draft.overrides["pixiv-comic"]
    const latest = structuredClone(baseline)
    latest.integrationSettings.mangadex.chapterLanguageFilter = ["ja"]
    latest.settings.notifications = !baseline.settings.notifications
    latest.overrides["pixiv-comic"] = { outputFormat: "cbz" }
    latest.overrides.mangadex.imagePolicy = { concurrency: 4 }

    const merged = mergeOptionsDraftOntoLatest(baseline, draft, latest)
    expect(merged.integrationSettings.mangadex.chapterLanguageFilter).toEqual([
      "en",
    ])
    expect(merged.overrides).toStrictEqual({
      mangadex: {
        pathTemplate: "Local/<SERIES_TITLE>",
        retries: { image: 2 },
        imagePolicy: { concurrency: 4 },
      },
    })
    expect(merged.settings.notifications).toBe(latest.settings.notifications)

    const sendMessage = vi.fn(async (message: RuntimeMessage) => {
      if (message.type !== "SAVE_OPTIONS_CONFIGURATION")
        throw new Error(`Unexpected message ${message.type}`)
      return { success: true, data: message.payload.configuration }
    })
    vi.stubGlobal("chrome", { runtime: { sendMessage } })

    await expect(
      new OptionsConfigurationClient().save(merged)
    ).resolves.toEqual(merged)
    expect(sendMessage).toHaveBeenCalledOnce()
    expect(sendMessage.mock.calls[0][0]).toMatchObject({
      type: "SAVE_OPTIONS_CONFIGURATION",
      payload: { configuration: merged },
    })
  })
})
