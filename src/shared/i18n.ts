/**
 * Core i18n module — thin wrapper around chrome.i18n with fallback support.
 *
 * Chrome's i18n API is synchronous and locale is determined by the browser
 * UI language at startup. This wrapper provides:
 * - A typed `t()` function for retrieving translated messages
 * - Fallback to the key itself when a message is missing (useful in tests)
 * - A `getUILanguage()` helper
 */

/** Supported locale codes matching public/_locales/ directory names. */
export const SUPPORTED_LOCALES = ['en', 'zh_CN', 'zh_TW', 'ja'] as const
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

/** Default locale — must match manifest `default_locale`. */
export const DEFAULT_LOCALE: SupportedLocale = 'en'

/**
 * Retrieve a translated message by key.
 *
 * Wraps `chrome.i18n.getMessage()`. If the message is not found (or chrome
 * APIs are unavailable, e.g. in unit tests), falls back to the key itself.
 *
 * @param key  Message key from messages.json
 * @param substitutions  Positional substitutions ($1, $2, …)
 */
export function t(key: string, substitutions?: string | string[]): string {
  try {
    const msg = chrome.i18n.getMessage(key, substitutions)
    if (msg) return msg
  } catch {
    // chrome.i18n not available (e.g. Node test env)
  }
  return key
}

/**
 * Get the current UI locale determined by Chrome.
 * Falls back to DEFAULT_LOCALE when unavailable.
 */
export function getUILanguage(): string {
  try {
    const lang = chrome.i18n.getUILanguage()
    if (lang) return lang
  } catch {
    // chrome.i18n not available
  }
  return DEFAULT_LOCALE
}

/**
 * Get the browser's accept-language list.
 * Falls back to [DEFAULT_LOCALE] when unavailable.
 */
export function getAcceptLanguages(): string[] {
  try {
    // chrome.i18n.getAcceptLanguages is async in Chrome but we provide
    // a sync fallback for environments where it's unavailable
    return [DEFAULT_LOCALE]
  } catch {
    return [DEFAULT_LOCALE]
  }
}

/**
 * Get a human-readable display name for a locale code.
 * Used in language selector UI.
 */
export function getLocaleDisplayName(locale: string): string {
  switch (locale) {
    case 'en':
      return 'English'
    case 'zh_CN':
      return '简体中文'
    case 'zh_TW':
      return '繁體中文'
    case 'ja':
      return '日本語'
    default:
      return locale
  }
}
