import {
  isOptionsRecord as isRecord,
  optionsValuesEqual as valuesEqual,
} from "./options-configuration-reducer-values"
import type { ExtensionSettings } from "@/src/domain/settings/types"
import type {
  SiteIntegrationEnablementMap,
  SiteIntegrationSettingsMap,
  SiteOverrideRecord,
  SiteOverridesMap,
} from "@/src/domain/site-integrations/storage-schemas"

export interface OptionsConfigurationSnapshot {
  settings: ExtensionSettings
  overrides: SiteOverridesMap
  enablement: SiteIntegrationEnablementMap
  integrationSettings: SiteIntegrationSettingsMap
}

export const OPTIONS_CONFIGURATION_STORAGE_KEYS = [
  "settings:global",
  "siteOverrides",
  "siteIntegrationEnablement",
  "siteIntegrationSettings",
] as const

export type OptionsConfigurationStorageKey =
  (typeof OPTIONS_CONFIGURATION_STORAGE_KEYS)[number]

type CustomSettingValue = SiteIntegrationSettingsMap[string][string]

export interface OptionsConfigurationState {
  saved: OptionsConfigurationSnapshot | null
  draft: OptionsConfigurationSnapshot | null
  hydration: {
    status: "loading" | "ready" | "error"
    error: unknown
  }
  externalChangeKeys: OptionsConfigurationStorageKey[]
  draftRevision: number
  draftDirty: boolean
}

export const initialOptionsConfigurationState: OptionsConfigurationState = {
  saved: null,
  draft: null,
  hydration: {
    status: "loading",
    error: null,
  },
  externalChangeKeys: [],
  draftRevision: 0,
  draftDirty: false,
}

interface MergeResult {
  present: boolean
  value?: unknown
}

export function optionsConfigurationSnapshotsEqual(
  left: OptionsConfigurationSnapshot,
  right: OptionsConfigurationSnapshot
): boolean {
  return valuesEqual(left, right)
}

function mergeNode(
  baselinePresent: boolean,
  baseline: unknown,
  draftPresent: boolean,
  draft: unknown,
  latestPresent: boolean,
  latest: unknown
): MergeResult {
  const locallyUnchanged =
    baselinePresent === draftPresent &&
    (!baselinePresent || valuesEqual(baseline, draft))

  if (locallyUnchanged) {
    return latestPresent ? { present: true, value: latest } : { present: false }
  }

  if (
    canMergeRecords(
      baselinePresent,
      baseline,
      draftPresent,
      draft,
      latestPresent,
      latest
    )
  ) {
    return {
      present: true,
      value: mergeRecords(baseline, draft, latest),
    }
  }

  return draftPresent ? { present: true, value: draft } : { present: false }
}

function canMergeRecords(
  baselinePresent: boolean,
  baseline: unknown,
  draftPresent: boolean,
  draft: unknown,
  latestPresent: boolean,
  latest: unknown
): draft is Record<string, unknown> {
  return (
    draftPresent &&
    isRecord(draft) &&
    (!baselinePresent || isRecord(baseline)) &&
    (!latestPresent || isRecord(latest))
  )
}

function mergeRecords(
  baseline: unknown,
  draft: Record<string, unknown>,
  latest: unknown
): Record<string, unknown> {
  const baselineRecord = isRecord(baseline) ? baseline : {}
  const latestRecord = isRecord(latest) ? latest : {}
  const keys = new Set([
    ...Object.keys(baselineRecord),
    ...Object.keys(draft),
    ...Object.keys(latestRecord),
  ])
  const merged: Record<string, unknown> = {}
  for (const key of keys) {
    const result = mergeNode(
      Object.hasOwn(baselineRecord, key),
      baselineRecord[key],
      Object.hasOwn(draft, key),
      draft[key],
      Object.hasOwn(latestRecord, key),
      latestRecord[key]
    )
    if (result.present) merged[key] = result.value
  }
  return merged
}

function mergeObject<T extends object>(baseline: T, draft: T, latest: T): T {
  return mergeNode(true, baseline, true, draft, true, latest).value as T
}

/**
 * Rebase the user's field-level draft changes onto the newest persisted state.
 * Unedited fields take the latest external value; directly conflicting fields
 * keep the user's draft value.
 */
export function mergeOptionsDraftOntoLatest(
  baseline: OptionsConfigurationSnapshot,
  draft: OptionsConfigurationSnapshot,
  latest: OptionsConfigurationSnapshot
): OptionsConfigurationSnapshot {
  return {
    settings: mergeObject(baseline.settings, draft.settings, latest.settings),
    overrides: mergeObject(
      baseline.overrides,
      draft.overrides,
      latest.overrides
    ),
    enablement: mergeObject(
      baseline.enablement,
      draft.enablement,
      latest.enablement
    ),
    integrationSettings: mergeObject(
      baseline.integrationSettings,
      draft.integrationSettings,
      latest.integrationSettings
    ),
  }
}

export function reconcileOptionsSave<T>(input: {
  submitted: T
  persisted?: T
  submittedRevision: number
  currentRevision: number
}): {
  saved: T
  clearTransientDraft: boolean
  hasUnsavedChanges: boolean
} {
  const draftUnchanged = input.currentRevision === input.submittedRevision
  return {
    saved: input.persisted ?? input.submitted,
    clearTransientDraft: draftUnchanged,
    hasUnsavedChanges: !draftUnchanged,
  }
}

export type OptionsConfigurationAction =
  | { type: "load-start" }
  | { type: "hydrate"; configuration: OptionsConfigurationSnapshot }
  | { type: "hydrate-error"; error: unknown }
  | { type: "edit-settings"; updates: Partial<ExtensionSettings> }
  | {
      type: "set-override"
      siteIntegrationId: string
      override: SiteOverrideRecord | null
    }
  | {
      type: "set-enablement"
      siteIntegrationId: string
      enabled: boolean
    }
  | {
      type: "set-integration-setting"
      siteIntegrationId: string
      settingId: string
      value: CustomSettingValue | undefined
    }
  | {
      type: "record-external-conflict"
      keys: readonly OptionsConfigurationStorageKey[]
    }
  | { type: "sync-external"; latest: OptionsConfigurationSnapshot }
  | { type: "replace-from-external"; latest: OptionsConfigurationSnapshot }
  | { type: "merge-latest-keeping-local"; latest: OptionsConfigurationSnapshot }
  | { type: "discard-to-saved" }
  | { type: "discard-to-latest"; latest: OptionsConfigurationSnapshot }
  | {
      type: "save-commit"
      submitted: OptionsConfigurationSnapshot
      submittedRevision: number
      persisted: OptionsConfigurationSnapshot
    }

function withDraftEdit(
  state: OptionsConfigurationState,
  draft: OptionsConfigurationSnapshot
): OptionsConfigurationState {
  return {
    ...state,
    draft,
    draftRevision: state.draftRevision + 1,
    draftDirty: true,
  }
}

function replaceConfiguration(
  state: OptionsConfigurationState,
  latest: OptionsConfigurationSnapshot,
  incrementRevision: boolean
): OptionsConfigurationState {
  return {
    ...state,
    saved: latest,
    draft: latest,
    hydration: { status: "ready", error: null },
    externalChangeKeys: [],
    draftRevision: state.draftRevision + (incrementRevision ? 1 : 0),
    draftDirty: false,
  }
}

type DraftAction = Extract<
  OptionsConfigurationAction,
  {
    type:
      | "edit-settings"
      | "set-override"
      | "set-enablement"
      | "set-integration-setting"
  }
>
type HydrationAction = Extract<
  OptionsConfigurationAction,
  { type: "load-start" | "hydrate" | "hydrate-error" }
>
type ReconciliationAction = Exclude<
  OptionsConfigurationAction,
  DraftAction | HydrationAction
>

function isDraftAction(
  action: OptionsConfigurationAction
): action is DraftAction {
  return (
    action.type === "edit-settings" ||
    action.type === "set-override" ||
    action.type === "set-enablement" ||
    action.type === "set-integration-setting"
  )
}

function isHydrationAction(
  action: OptionsConfigurationAction
): action is HydrationAction {
  return (
    action.type === "load-start" ||
    action.type === "hydrate" ||
    action.type === "hydrate-error"
  )
}

function editOverride(
  draft: OptionsConfigurationSnapshot,
  action: Extract<DraftAction, { type: "set-override" }>
): OptionsConfigurationSnapshot {
  const overrides = { ...draft.overrides }
  if (action.override === null || Object.keys(action.override).length === 0)
    delete overrides[action.siteIntegrationId]
  else overrides[action.siteIntegrationId] = { ...action.override }
  return { ...draft, overrides }
}

function editIntegrationSetting(
  draft: OptionsConfigurationSnapshot,
  action: Extract<DraftAction, { type: "set-integration-setting" }>
): OptionsConfigurationSnapshot {
  const integrationSettings = { ...draft.integrationSettings }
  const settings = { ...(integrationSettings[action.siteIntegrationId] ?? {}) }
  if (action.value !== undefined) settings[action.settingId] = action.value
  else delete settings[action.settingId]
  if (Object.keys(settings).length === 0)
    delete integrationSettings[action.siteIntegrationId]
  else integrationSettings[action.siteIntegrationId] = settings
  return { ...draft, integrationSettings }
}

function reduceDraft(
  state: OptionsConfigurationState,
  action: DraftAction
): OptionsConfigurationState {
  if (!state.draft) return state
  switch (action.type) {
    case "edit-settings":
      return withDraftEdit(state, {
        ...state.draft,
        settings: { ...state.draft.settings, ...action.updates },
      })
    case "set-override":
      return withDraftEdit(state, editOverride(state.draft, action))
    case "set-enablement":
      return withDraftEdit(state, {
        ...state.draft,
        enablement: {
          ...state.draft.enablement,
          [action.siteIntegrationId]: action.enabled,
        },
      })
    case "set-integration-setting":
      return withDraftEdit(state, editIntegrationSetting(state.draft, action))
  }
}

function reduceHydration(
  state: OptionsConfigurationState,
  action: HydrationAction
): OptionsConfigurationState {
  switch (action.type) {
    case "load-start":
      return { ...state, hydration: { status: "loading", error: null } }
    case "hydrate":
      return {
        ...state,
        saved: action.configuration,
        draft: action.configuration,
        hydration: { status: "ready", error: null },
        externalChangeKeys: [],
        draftDirty: false,
      }
    case "hydrate-error":
      return { ...state, hydration: { status: "error", error: action.error } }
  }
}

function keepLocalChanges(
  state: OptionsConfigurationState,
  latest: OptionsConfigurationSnapshot
): OptionsConfigurationState {
  if (!state.saved || !state.draft) return state
  const draft = mergeOptionsDraftOntoLatest(state.saved, state.draft, latest)
  return {
    ...state,
    saved: latest,
    draft,
    externalChangeKeys: [],
    draftRevision: state.draftRevision + 1,
    draftDirty: !optionsConfigurationSnapshotsEqual(draft, latest),
  }
}

function commitSave(
  state: OptionsConfigurationState,
  action: Extract<OptionsConfigurationAction, { type: "save-commit" }>
): OptionsConfigurationState {
  if (!state.draft) return state
  const reconciliation = reconcileOptionsSave({
    submitted: action.submitted,
    persisted: action.persisted,
    submittedRevision: action.submittedRevision,
    currentRevision: state.draftRevision,
  })
  return {
    ...state,
    saved: reconciliation.saved,
    draft: reconciliation.clearTransientDraft
      ? reconciliation.saved
      : state.draft,
    // Preserve conflicts recorded while the submitted snapshot was in flight.
    externalChangeKeys: state.externalChangeKeys,
    draftDirty: reconciliation.hasUnsavedChanges,
  }
}

function discardDraft(
  state: OptionsConfigurationState
): OptionsConfigurationState {
  if (!state.saved) return state
  return {
    ...state,
    draft: state.saved,
    externalChangeKeys: [],
    draftRevision: state.draftRevision + 1,
    draftDirty: false,
  }
}

function reduceReconciliation(
  state: OptionsConfigurationState,
  action: ReconciliationAction
): OptionsConfigurationState {
  switch (action.type) {
    case "record-external-conflict":
      if (action.keys.length === 0) return state
      return {
        ...state,
        externalChangeKeys: [
          ...new Set([...state.externalChangeKeys, ...action.keys]),
        ],
      }
    case "sync-external":
      return replaceConfiguration(state, action.latest, false)
    case "replace-from-external":
    case "discard-to-latest":
      return replaceConfiguration(state, action.latest, true)
    case "merge-latest-keeping-local":
      return keepLocalChanges(state, action.latest)
    case "discard-to-saved":
      return discardDraft(state)
    case "save-commit":
      return commitSave(state, action)
  }
}

export function optionsConfigurationReducer(
  state: OptionsConfigurationState,
  action: OptionsConfigurationAction
): OptionsConfigurationState {
  if (isDraftAction(action)) return reduceDraft(state, action)
  if (isHydrationAction(action)) return reduceHydration(state, action)
  return reduceReconciliation(state, action)
}
