import type { SiteIntegrationEnablementMap } from "@/src/storage/site-integration-enablement-service"
import type { SiteIntegrationSettingsMap } from "@/src/storage/site-integration-settings-service"
import type { ExtensionSettings } from "@/src/storage/settings-types"
import type { SiteOverridesMap } from "@/src/storage/site-overrides-service"

export interface OptionsConfigurationSnapshot {
  settings: ExtensionSettings
  overrides: SiteOverridesMap
  enablement: SiteIntegrationEnablementMap
  integrationSettings: SiteIntegrationSettingsMap
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((entry, index) => valuesEqual(entry, right[index]))
    )
  }
  if (!isRecord(left) || !isRecord(right)) return false

  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) => Object.hasOwn(right, key) && valuesEqual(left[key], right[key])
    )
  )
}

interface MergeResult {
  present: boolean
  value?: unknown
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
    draftPresent &&
    isRecord(draft) &&
    (!baselinePresent || isRecord(baseline)) &&
    (!latestPresent || isRecord(latest))
  ) {
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

    return { present: true, value: merged }
  }

  return draftPresent ? { present: true, value: draft } : { present: false }
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
