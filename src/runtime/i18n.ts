/**
 * Runtime-localizable UI messages.
 *
 * Chrome owns the locale used by manifest strings and chrome.i18n. Extension
 * pages that opt into a manual language load the same packaged message
 * catalogs and subscribe to this module for live updates.
 */

import {
  SUPPORTED_LOCALES,
  type SupportedLocale,
  type UiLanguagePreference,
} from "@/src/shared/ui-language"

export { SUPPORTED_LOCALES, type SupportedLocale }

export const DEFAULT_LOCALE: SupportedLocale = "en"

interface MessageEntry {
  message: string
  placeholders?: Record<string, { content: string }>
}

type MessageCatalog = Record<string, MessageEntry>

let activePreference: UiLanguagePreference = "auto"
let activeCatalog: MessageCatalog | null = null
let englishCatalog: MessageCatalog | null = null
let applicationGeneration = 0
let snapshotVersion = 0
const listeners = new Set<() => void>()
const catalogPromises = new Map<SupportedLocale, Promise<MessageCatalog>>()

function getBrowserUiLanguage(): string {
  try {
    const language = chrome.i18n.getUILanguage()
    if (language) return language
  } catch {
    // Chrome APIs are unavailable in non-extension environments.
  }
  return DEFAULT_LOCALE
}

function emitChange(): void {
  snapshotVersion += 1
  for (const listener of listeners) listener()
}

function getCatalogUrl(locale: SupportedLocale): string {
  const path = `_locales/${locale}/messages.json`
  try {
    return chrome.runtime.getURL(path)
  } catch {
    return `/${path}`
  }
}

async function loadCatalog(locale: SupportedLocale): Promise<MessageCatalog> {
  const existing = catalogPromises.get(locale)
  if (existing) return await existing

  const loading = (async () => {
    const response = await fetch(getCatalogUrl(locale))
    if (!response.ok) {
      throw new Error(`Unable to load the ${locale} message catalog`)
    }
    const value: unknown = await response.json()
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error(`Invalid ${locale} message catalog`)
    }
    return value as MessageCatalog
  })()
  catalogPromises.set(locale, loading)

  try {
    return await loading
  } catch (error) {
    catalogPromises.delete(locale)
    throw error
  }
}

function substituteMessage(
  entry: MessageEntry,
  substitutions?: string | string[]
): string {
  const values = substitutions
    ? Array.isArray(substitutions)
      ? substitutions
      : [substitutions]
    : []
  const escapedDollar = "\u0000TAKO_DOLLAR\u0000"
  let message = entry.message.replaceAll("$$", escapedDollar)

  for (const [name, placeholder] of Object.entries(entry.placeholders ?? {})) {
    const token = new RegExp(
      `\\$${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\$`,
      "gi"
    )
    message = message.replace(token, placeholder.content)
  }

  message = message.replace(/\$([1-9])/g, (_match, index: string) => {
    return values[Number(index) - 1] ?? ""
  })

  return message.replaceAll(escapedDollar, "$")
}

/** Retrieve a translated message from the active runtime locale. */
export function t(key: string, substitutions?: string | string[]): string {
  if (activePreference === "auto") {
    try {
      const message = chrome.i18n.getMessage(key, substitutions)
      if (message) return message
    } catch {
      // Chrome APIs are unavailable in non-extension environments.
    }
    return key
  }

  const entry = activeCatalog?.[key] ?? englishCatalog?.[key]
  return entry ? substituteMessage(entry, substitutions) : key
}

/** Get the locale currently used for runtime UI strings. */
export function getUILanguage(): string {
  return activePreference === "auto" ? getBrowserUiLanguage() : activePreference
}

/** Apply a persisted language preference after its packaged catalog is ready. */
export async function applyUiLanguagePreference(
  preference: UiLanguagePreference
): Promise<void> {
  const generation = ++applicationGeneration

  if (preference === "auto") {
    const changed = activePreference !== "auto" || activeCatalog !== null
    activePreference = "auto"
    activeCatalog = null
    englishCatalog = null
    if (changed) emitChange()
    return
  }

  const [selectedResult, englishResult] = await Promise.allSettled([
    loadCatalog(preference),
    loadCatalog(DEFAULT_LOCALE),
  ])
  if (generation !== applicationGeneration) return

  const nextCatalog =
    selectedResult.status === "fulfilled" ? selectedResult.value : null
  const nextEnglishCatalog =
    englishResult.status === "fulfilled" ? englishResult.value : null
  const changed =
    activePreference !== preference ||
    activeCatalog !== nextCatalog ||
    englishCatalog !== nextEnglishCatalog

  activePreference = preference
  activeCatalog = nextCatalog
  englishCatalog = nextEnglishCatalog
  if (changed) emitChange()
}

export function subscribeI18n(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getI18nSnapshot(): number {
  return snapshotVersion
}

/** Reset module state between isolated unit tests. */
export function __resetI18nForTests(): void {
  activePreference = "auto"
  activeCatalog = null
  englishCatalog = null
  applicationGeneration = 0
  snapshotVersion = 0
  listeners.clear()
  catalogPromises.clear()
}

export function getLocaleDisplayName(locale: string): string {
  switch (locale) {
    case "en":
      return "English"
    case "zh_CN":
      return "简体中文"
    case "zh_TW":
      return "繁體中文"
    case "ja":
      return "日本語"
    default:
      return locale
  }
}
