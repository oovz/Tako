/**
 * React hook for internationalization.
 *
 * Returns a stable `t` function and the current UI locale.
 * Chrome's i18n is synchronous and locale is fixed at startup, so this
 * hook does not trigger re-renders on locale change — it simply provides
 * a convenient accessor for use in React components.
 */

import { useMemo } from 'react'

import { t as tFn, getUILanguage } from '@/src/shared/i18n'

export interface UseI18nResult {
  /** Translate a message key. See src/shared/i18n.ts for details. */
  t: (key: string, substitutions?: string | string[]) => string
  /** Current UI locale code (e.g. 'en', 'zh_CN', 'ja'). */
  locale: string
}

export function useI18n(): UseI18nResult {
  const locale = useMemo(() => getUILanguage(), [])

  return useMemo(
    () => ({
      t: tFn,
      locale,
    }),
    [locale],
  )
}
