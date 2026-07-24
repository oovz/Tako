export const SUPPORTED_LOCALES = ["en", "zh_CN", "zh_TW", "ja"] as const

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

export const UI_LANGUAGE_PREFERENCES = ["auto", ...SUPPORTED_LOCALES] as const

export type UiLanguagePreference = (typeof UI_LANGUAGE_PREFERENCES)[number]

export function isUiLanguagePreference(
  value: unknown
): value is UiLanguagePreference {
  return UI_LANGUAGE_PREFERENCES.some((candidate) => candidate === value)
}
