import type { UiLanguagePreference } from "@/src/shared/ui-language"
import type { MotionPreference } from "@/src/shared/motion-preference"
import { applyUiLanguagePreference } from "@/src/runtime/i18n"

const MOTION_ATTRIBUTE = "data-tako-motion"

export function applyMotionPreference(preference: MotionPreference): void {
  if (typeof document === "undefined") return

  if (preference === "system") {
    document.documentElement.removeAttribute(MOTION_ATTRIBUTE)
    return
  }

  document.documentElement.setAttribute(MOTION_ATTRIBUTE, "reduce")
}

export function toDocumentLanguageTag(locale: string): string {
  return locale.replace("_", "-")
}

export async function applyUiPreferences(preferences: {
  motionPreference: MotionPreference
  uiLanguage: UiLanguagePreference
}): Promise<void> {
  applyMotionPreference(preferences.motionPreference)
  await applyUiLanguagePreference(preferences.uiLanguage)
}
