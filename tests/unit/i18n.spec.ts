import { describe, it, expect, afterEach, vi } from 'vitest'

import { t, getUILanguage, getAcceptLanguages, getLocaleDisplayName, SUPPORTED_LOCALES, DEFAULT_LOCALE } from '@/src/shared/i18n'

describe('i18n infrastructure', () => {
  const originalChrome = globalThis.chrome

  afterEach(() => {
    // Restore the global chrome mock from setup.ts
    ;(globalThis as Record<string, unknown>).chrome = originalChrome
  })

  describe('t() function', () => {
    it('returns the message for a known key', () => {
      expect(t('common_cancel')).toBe('Cancel')
    })

    it('returns the key as fallback when message is not found', () => {
      expect(t('nonexistent_key')).toBe('nonexistent_key')
    })

    it('returns the key as fallback when chrome.i18n is not available', () => {
      vi.stubGlobal('chrome', undefined)
      expect(t('common_cancel')).toBe('common_cancel')
    })

    it('passes substitutions to chrome.i18n.getMessage', () => {
      expect(t('options_chaptersCount', ['5', '10'])).toBe('5/10 chapters')
    })

    it('handles single string substitution', () => {
      expect(t('sidepanel_chaptersCount', '42')).toBe('42 Chapters')
    })
  })

  describe('SUPPORTED_LOCALES', () => {
    it('includes en, zh_CN, zh_TW, ja', () => {
      expect(SUPPORTED_LOCALES).toContain('en')
      expect(SUPPORTED_LOCALES).toContain('zh_CN')
      expect(SUPPORTED_LOCALES).toContain('zh_TW')
      expect(SUPPORTED_LOCALES).toContain('ja')
    })
  })

  describe('DEFAULT_LOCALE', () => {
    it('is "en"', () => {
      expect(DEFAULT_LOCALE).toBe('en')
    })
  })

  describe('getUILanguage()', () => {
    it('returns the UI language from chrome.i18n', () => {
      expect(getUILanguage()).toBe('en')
    })

    it('returns DEFAULT_LOCALE when chrome.i18n is not available', () => {
      vi.stubGlobal('chrome', undefined)
      expect(getUILanguage()).toBe(DEFAULT_LOCALE)
    })
  })

  describe('getAcceptLanguages()', () => {
    it('returns [DEFAULT_LOCALE] as fallback (sync wrapper)', () => {
      expect(getAcceptLanguages()).toEqual([DEFAULT_LOCALE])
    })
  })

  describe('getLocaleDisplayName()', () => {
    it('returns display name for en', () => {
      expect(getLocaleDisplayName('en')).toBe('English')
    })

    it('returns display name for zh_CN', () => {
      expect(getLocaleDisplayName('zh_CN')).toBe('简体中文')
    })

    it('returns display name for zh_TW', () => {
      expect(getLocaleDisplayName('zh_TW')).toBe('繁體中文')
    })

    it('returns display name for ja', () => {
      expect(getLocaleDisplayName('ja')).toBe('日本語')
    })

    it('returns the code itself for unknown locales', () => {
      expect(getLocaleDisplayName('fr')).toBe('fr')
    })
  })
})

describe('i18n key coverage', () => {
  const LOCALES = ['en', 'zh_CN', 'zh_TW', 'ja'] as const

  for (const locale of LOCALES) {
    it(`has valid JSON for ${locale}`, async () => {
      const fs = await import('node:fs')
      const path = await import('node:path')
      const filePath = path.resolve(__dirname, `../../public/_locales/${locale}/messages.json`)
      const content = fs.readFileSync(filePath, 'utf-8')
      expect(() => JSON.parse(content)).not.toThrow()
    })
  }

  it('all locales have the same set of keys', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const keysByLocale: Record<string, Set<string>> = {}

    for (const locale of LOCALES) {
      const filePath = path.resolve(__dirname, `../../public/_locales/${locale}/messages.json`)
      const content = fs.readFileSync(filePath, 'utf-8')
      const parsed = JSON.parse(content)
      keysByLocale[locale] = new Set(Object.keys(parsed))
    }

    const enKeys = keysByLocale['en']
    for (const locale of LOCALES) {
      if (locale === 'en') continue
      const localeKeys = keysByLocale[locale]
      const missing = [...enKeys].filter((k) => !localeKeys.has(k))
      const extra = [...localeKeys].filter((k) => !enKeys.has(k))
      expect(missing).toEqual([])
      expect(extra).toEqual([])
    }
  })

  it('all messages have a "message" field', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')

    for (const locale of LOCALES) {
      const filePath = path.resolve(__dirname, `../../public/_locales/${locale}/messages.json`)
      const content = fs.readFileSync(filePath, 'utf-8')
      const parsed = JSON.parse(content) as Record<string, { message: string }>

      for (const [key, value] of Object.entries(parsed)) {
        expect(value.message, `Key "${key}" in ${locale} must have a "message" field`).toBeDefined()
        expect(typeof value.message, `Key "${key}" in ${locale} message must be a string`).toBe('string')
        expect(value.message.length, `Key "${key}" in ${locale} message must not be empty`).toBeGreaterThan(0)
      }
    }
  })
})
