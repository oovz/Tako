import { useChromeStorageValue } from "@/src/ui/shared/hooks/useChromeStorageValue"
import { SETTINGS_STORAGE_KEY } from "@/src/storage/settings-service"
import {
  isUiLanguagePreference,
  type UiLanguagePreference,
} from "@/src/shared/ui-language"
import { isRecord } from "@/src/shared/type-guards"
import {
  isMotionPreference,
  type MotionPreference,
} from "@/src/shared/motion-preference"

export interface UiPreferences {
  motionPreference: MotionPreference
  uiLanguage: UiLanguagePreference
}

export const DEFAULT_UI_PREFERENCES: UiPreferences = Object.freeze({
  motionPreference: "system",
  uiLanguage: "auto",
})

export function parseUiPreferencesDocument(value: unknown): UiPreferences {
  if (!isRecord(value)) return DEFAULT_UI_PREFERENCES

  return {
    motionPreference: isMotionPreference(value.motionPreference)
      ? value.motionPreference
      : "system",
    uiLanguage: isUiLanguagePreference(value.uiLanguage)
      ? value.uiLanguage
      : "auto",
  }
}

export function useUiPreferences() {
  return useChromeStorageValue<UiPreferences>({
    areaName: "local",
    key: SETTINGS_STORAGE_KEY,
    initialValue: DEFAULT_UI_PREFERENCES,
    parse: parseUiPreferencesDocument,
  })
}
