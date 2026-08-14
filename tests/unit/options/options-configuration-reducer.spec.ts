import { describe, expect, it } from "vitest"

import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import {
  initialOptionsConfigurationState,
  optionsConfigurationReducer,
  optionsConfigurationSnapshotsEqual,
  type OptionsConfigurationSnapshot,
  type OptionsConfigurationState,
} from "@/entrypoints/options/state/options-configuration-reducer"

function createSnapshot(
  overrides: Partial<OptionsConfigurationSnapshot> = {}
): OptionsConfigurationSnapshot {
  return {
    settings: structuredClone(DEFAULT_SETTINGS),
    overrides: {},
    enablement: {},
    integrationSettings: {},
    ...overrides,
  }
}

function hydratedState(
  snapshot: OptionsConfigurationSnapshot = createSnapshot()
): OptionsConfigurationState {
  return optionsConfigurationReducer(initialOptionsConfigurationState, {
    type: "hydrate",
    configuration: snapshot,
  })
}

describe("options configuration reducer", () => {
  it("hydrates configuration and records load failures without ambient effects", () => {
    const snapshot = createSnapshot()
    const hydrated = hydratedState(snapshot)

    expect(hydrated).toMatchObject({
      saved: snapshot,
      draft: snapshot,
      hydration: { status: "ready", error: null },
      externalChangeKeys: [],
      draftRevision: 0,
      draftDirty: false,
    })

    const error = new Error("load failed")
    const failed = optionsConfigurationReducer(
      initialOptionsConfigurationState,
      { type: "hydrate-error", error }
    )
    expect(failed.hydration).toEqual({ status: "error", error })
    expect(
      optionsConfigurationReducer(failed, { type: "load-start" }).hydration
    ).toEqual({ status: "loading", error: null })
  })

  it("applies settings edits as immutable draft revisions", () => {
    const state = hydratedState()
    const next = optionsConfigurationReducer(state, {
      type: "edit-settings",
      updates: { motionPreference: "reduce" },
    })

    expect(next.draft?.settings.motionPreference).toBe("reduce")
    expect(state.draft?.settings.motionPreference).not.toBe("reduce")
    expect(next.saved).toEqual(state.saved)
    expect(next.draftRevision).toBe(1)
    expect(next.draftDirty).toBe(true)
  })

  it("sets and removes overrides, including empty records", () => {
    const state = hydratedState()
    const set = optionsConfigurationReducer(state, {
      type: "set-override",
      siteIntegrationId: "mangadex",
      override: { pathTemplate: "Local/<SERIES_TITLE>" },
    })
    expect(set.draft?.overrides).toEqual({
      mangadex: { pathTemplate: "Local/<SERIES_TITLE>" },
    })

    const deleted = optionsConfigurationReducer(set, {
      type: "set-override",
      siteIntegrationId: "mangadex",
      override: {},
    })
    expect(deleted.draft?.overrides).toEqual({})
    expect(deleted.draftRevision).toBe(2)
    expect(deleted.draftDirty).toBe(true)
  })

  it("edits enablement and removes an empty integration settings provider", () => {
    const state = hydratedState()
    const enabled = optionsConfigurationReducer(state, {
      type: "set-enablement",
      siteIntegrationId: "mangadex",
      enabled: false,
    })
    expect(enabled.draft?.enablement).toEqual({ mangadex: false })

    const setting = optionsConfigurationReducer(enabled, {
      type: "set-integration-setting",
      siteIntegrationId: "mangadex",
      settingId: "imageQuality",
      enabled: true,
      value: "data-saver",
    })
    expect(setting.draft?.integrationSettings).toEqual({
      mangadex: { imageQuality: "data-saver" },
    })

    const deleted = optionsConfigurationReducer(setting, {
      type: "set-integration-setting",
      siteIntegrationId: "mangadex",
      settingId: "imageQuality",
      enabled: false,
      value: "ignored",
    })
    expect(deleted.draft?.integrationSettings).toEqual({})
    expect(deleted.draftRevision).toBe(3)
    expect(deleted.draftDirty).toBe(true)
  })

  it("records deduplicated external conflicts without changing the draft revision", () => {
    const state = hydratedState()
    const first = optionsConfigurationReducer(state, {
      type: "record-external-conflict",
      keys: ["siteOverrides", "settings:global"],
    })
    const second = optionsConfigurationReducer(first, {
      type: "record-external-conflict",
      keys: ["siteOverrides", "siteIntegrationSettings"],
    })

    expect(second.externalChangeKeys).toEqual([
      "siteOverrides",
      "settings:global",
      "siteIntegrationSettings",
    ])
    expect(second.draftRevision).toBe(0)
    expect(second.draftDirty).toBe(false)
  })

  it("accepts an external replacement without retaining local draft state", () => {
    const state = optionsConfigurationReducer(hydratedState(), {
      type: "edit-settings",
      updates: { motionPreference: "reduce" },
    })
    const latest = createSnapshot({
      settings: { ...structuredClone(DEFAULT_SETTINGS), notifications: false },
    })
    const replaced = optionsConfigurationReducer(state, {
      type: "replace-from-external",
      latest,
    })

    expect(replaced.saved).toBe(latest)
    expect(replaced.draft).toBe(latest)
    expect(replaced.externalChangeKeys).toEqual([])
    expect(replaced.draftRevision).toBe(2)
    expect(replaced.draftDirty).toBe(false)
  })

  it("merges latest values while keeping local field edits", () => {
    const baseline = createSnapshot({
      settings: {
        ...structuredClone(DEFAULT_SETTINGS),
        downloads: {
          ...structuredClone(DEFAULT_SETTINGS.downloads),
          pathTemplate: "Base",
        },
      },
      integrationSettings: {
        mangadex: { imageQuality: "data-saver", retained: true },
      },
    })
    const state = hydratedState(baseline)
    const local = optionsConfigurationReducer(state, {
      type: "edit-settings",
      updates: {
        downloads: {
          ...structuredClone(baseline.settings.downloads),
          pathTemplate: "Local",
        },
      },
    })
    const localWithDelete = optionsConfigurationReducer(local, {
      type: "set-integration-setting",
      siteIntegrationId: "mangadex",
      settingId: "imageQuality",
      enabled: false,
      value: "ignored",
    })
    const latest = createSnapshot({
      settings: {
        ...structuredClone(baseline.settings),
        downloads: {
          ...structuredClone(baseline.settings.downloads),
          pathTemplate: "External",
        },
        motionPreference: "reduce",
      },
      integrationSettings: {
        mangadex: {
          imageQuality: "external",
          retained: true,
          chapterLanguageFilter: ["en"],
        },
      },
    })
    const merged = optionsConfigurationReducer(localWithDelete, {
      type: "merge-latest-keeping-local",
      latest,
    })

    expect(merged.saved).toBe(latest)
    expect(merged.draft?.settings.downloads.pathTemplate).toBe("Local")
    expect(merged.draft?.settings.motionPreference).toBe("reduce")
    expect(merged.draft?.integrationSettings).toEqual({
      mangadex: { retained: true, chapterLanguageFilter: ["en"] },
    })
    expect(merged.draftRevision).toBe(3)
    expect(merged.draftDirty).toBe(true)
  })

  it("discards to saved or latest baselines with exact revision and dirty state", () => {
    const state = optionsConfigurationReducer(hydratedState(), {
      type: "edit-settings",
      updates: { notifications: false },
    })
    const discarded = optionsConfigurationReducer(state, {
      type: "discard-to-saved",
    })
    expect(discarded.draft).toBe(discarded.saved)
    expect(discarded.draftRevision).toBe(2)
    expect(discarded.draftDirty).toBe(false)

    const latest = createSnapshot({
      settings: { ...structuredClone(DEFAULT_SETTINGS), notifications: false },
    })
    const discardedLatest = optionsConfigurationReducer(discarded, {
      type: "discard-to-latest",
      latest,
    })
    expect(discardedLatest.saved).toBe(latest)
    expect(discardedLatest.draft).toBe(latest)
    expect(discardedLatest.draftRevision).toBe(3)
    expect(discardedLatest.draftDirty).toBe(false)
  })

  it("commits persisted state while preserving edits made during save", () => {
    const initial = hydratedState()
    const submitted = optionsConfigurationReducer(initial, {
      type: "edit-settings",
      updates: { notifications: false },
    })
    const persisted = createSnapshot({
      settings: { ...structuredClone(DEFAULT_SETTINGS), notifications: false },
    })

    const committed = optionsConfigurationReducer(submitted, {
      type: "save-commit",
      submitted: {
        settings: submitted.draft!.settings,
        overrides: submitted.draft!.overrides,
        enablement: submitted.draft!.enablement,
        integrationSettings: submitted.draft!.integrationSettings,
      },
      submittedRevision: 1,
      persisted,
    })
    expect(committed.saved).toBe(persisted)
    expect(committed.draft).toBe(persisted)
    expect(committed.draftRevision).toBe(1)
    expect(committed.draftDirty).toBe(false)

    const concurrentEdit = optionsConfigurationReducer(submitted, {
      type: "edit-settings",
      updates: { motionPreference: "reduce" },
    })
    const concurrentCommit = optionsConfigurationReducer(concurrentEdit, {
      type: "save-commit",
      submitted: {
        settings: submitted.draft!.settings,
        overrides: submitted.draft!.overrides,
        enablement: submitted.draft!.enablement,
        integrationSettings: submitted.draft!.integrationSettings,
      },
      submittedRevision: 1,
      persisted,
    })
    expect(concurrentCommit.saved).toBe(persisted)
    expect(concurrentCommit.draft).not.toBe(persisted)
    expect(concurrentCommit.draft?.settings.notifications).toBe(false)
    expect(concurrentCommit.draft?.settings.motionPreference).toBe("reduce")
    expect(concurrentCommit.draftRevision).toBe(2)
    expect(concurrentCommit.draftDirty).toBe(true)
  })

  it("retains an external conflict recorded while the save was in flight", () => {
    const submitted = optionsConfigurationReducer(hydratedState(), {
      type: "edit-settings",
      updates: { notifications: false },
    })
    const conflicted = optionsConfigurationReducer(submitted, {
      type: "record-external-conflict",
      keys: ["settings:global"],
    })
    const committed = optionsConfigurationReducer(conflicted, {
      type: "save-commit",
      submitted: submitted.draft!,
      submittedRevision: submitted.draftRevision,
      persisted: submitted.draft!,
    })

    expect(committed.externalChangeKeys).toEqual(["settings:global"])
  })

  it("compares snapshots structurally rather than by object identity", () => {
    expect(
      optionsConfigurationSnapshotsEqual(createSnapshot(), createSnapshot())
    ).toBe(true)
  })
})
