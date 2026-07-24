/**
 * React hook for internationalization.
 *
 * Returns a stable `t` function and the current UI locale.
 * The translation function is stable, while the external-store subscription
 * repaints consumers after a manual locale finishes loading.
 */

import { useMemo, useSyncExternalStore } from "react"

import {
  t as tFn,
  getUILanguage,
  getI18nSnapshot,
  subscribeI18n,
} from "@/src/runtime/i18n"

export interface UseI18nResult {
  /** Translate a message key. See src/runtime/i18n.ts for details. */
  t: (key: string, substitutions?: string | string[]) => string
  /** Current UI locale code (e.g. 'en', 'zh_CN', 'ja'). */
  locale: string
}

export function useI18n(): UseI18nResult {
  useSyncExternalStore(subscribeI18n, getI18nSnapshot, getI18nSnapshot)
  const locale = getUILanguage()

  return useMemo(
    () => ({
      t: tFn,
      locale,
    }),
    [locale]
  )
}
