import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react', () => ({
  useMemo: <T>(factory: () => T, _deps?: unknown[]): T => factory(),
}))

import { useI18n } from '@/src/ui/shared/hooks/useI18n'

describe('useI18n', () => {
  const originalChrome = (globalThis as { chrome?: unknown }).chrome

  afterEach(() => {
    ;(globalThis as { chrome?: unknown }).chrome = originalChrome
    vi.restoreAllMocks()
  })

  it('returns a stable t function and locale from chrome.i18n', () => {
    const getMessage = vi.fn((key: string) => `translated:${key}`)
    const getUILanguage = vi.fn(() => 'en')
    ;(globalThis as { chrome?: unknown }).chrome = {
      i18n: { getMessage, getUILanguage },
    }

    const result = useI18n()

    expect(result.locale).toBe('en')
    expect(result.t('test_key')).toBe('translated:test_key')
    expect(getMessage).toHaveBeenCalledWith('test_key', undefined)
  })

  it('t function passes substitutions to chrome.i18n.getMessage', () => {
    const getMessage = vi.fn((_key: string, subs?: string | string[]) => `msg:${Array.isArray(subs) ? subs.join(',') : subs}`)
    ;(globalThis as { chrome?: unknown }).chrome = {
      i18n: { getMessage, getUILanguage: vi.fn(() => 'en') },
    }

    const result = useI18n()

    result.t('greeting', 'World')
    expect(getMessage).toHaveBeenCalledWith('greeting', 'World')

    result.t('greeting', ['Alice', 'Bob'])
    expect(getMessage).toHaveBeenCalledWith('greeting', ['Alice', 'Bob'])
  })

  it('locale reflects chrome.i18n.getUILanguage', () => {
    ;(globalThis as { chrome?: unknown }).chrome = {
      i18n: {
        getMessage: vi.fn(),
        getUILanguage: vi.fn(() => 'zh_CN'),
      },
    }

    const result = useI18n()
    expect(result.locale).toBe('zh_CN')
  })

  it('t is the same function reference across calls (stable identity)', () => {
    ;(globalThis as { chrome?: unknown }).chrome = {
      i18n: {
        getMessage: vi.fn((key: string) => key),
        getUILanguage: vi.fn(() => 'en'),
      },
    }

    const result1 = useI18n()
    const result2 = useI18n()

    expect(result1.t).toBe(result2.t)
  })
})
