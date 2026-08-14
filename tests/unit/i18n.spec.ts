import { describe, it, expect, afterEach, vi } from "vitest"

import {
  t,
  getUILanguage,
  getLocaleDisplayName,
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  applyUiLanguagePreference,
  getI18nSnapshot,
  subscribeI18n,
  __resetI18nForTests,
} from "@/src/runtime/i18n"

describe("i18n infrastructure", () => {
  const originalChrome = globalThis.chrome

  afterEach(() => {
    if (typeof __resetI18nForTests === "function") {
      __resetI18nForTests()
    }
    vi.unstubAllGlobals()
    // Restore the global chrome mock from setup.ts
    ;(globalThis as Record<string, unknown>).chrome = originalChrome
  })

  describe("t() function", () => {
    it("returns the message for a known key", () => {
      expect(t("common_cancel")).toBe("Cancel")
    })

    it("returns the key as fallback when message is not found", () => {
      expect(t("nonexistent_key")).toBe("nonexistent_key")
    })

    it("returns the key as fallback when chrome.i18n is not available", () => {
      vi.stubGlobal("chrome", undefined)
      expect(t("common_cancel")).toBe("common_cancel")
    })

    it("passes substitutions to chrome.i18n.getMessage", () => {
      expect(t("options_chaptersCount", ["5", "10"])).toBe("5/10 chapters")
    })

    it("handles single string substitution", () => {
      expect(t("sidepanel_chaptersCount", "42")).toBe("42 Chapters")
    })
  })

  describe("SUPPORTED_LOCALES", () => {
    it("declares exactly the four fully supported locales", () => {
      expect(new Set(SUPPORTED_LOCALES)).toEqual(
        new Set(["en", "ja", "zh_CN", "zh_TW"])
      )
    })
  })

  describe("DEFAULT_LOCALE", () => {
    it('is "en"', () => {
      expect(DEFAULT_LOCALE).toBe("en")
    })
  })

  describe("getUILanguage()", () => {
    it("returns the UI language from chrome.i18n", () => {
      expect(getUILanguage()).toBe("en")
    })

    it("returns DEFAULT_LOCALE when chrome.i18n is not available", () => {
      vi.stubGlobal("chrome", undefined)
      expect(getUILanguage()).toBe(DEFAULT_LOCALE)
    })
  })

  describe("getLocaleDisplayName()", () => {
    it("returns display name for en", () => {
      expect(getLocaleDisplayName("en")).toBe("English")
    })

    it("returns display name for zh_CN", () => {
      expect(getLocaleDisplayName("zh_CN")).toBe("简体中文")
    })

    it("returns display name for zh_TW", () => {
      expect(getLocaleDisplayName("zh_TW")).toBe("繁體中文")
    })

    it("returns display name for ja", () => {
      expect(getLocaleDisplayName("ja")).toBe("日本語")
    })

    it("returns the code itself for unknown locales", () => {
      expect(getLocaleDisplayName("fr")).toBe("fr")
    })
  })

  describe("manual UI language", () => {
    it("uses the selected packaged catalog with English fallback and placeholders", async () => {
      const catalogs = {
        ja: {
          greeting: {
            message: "こんにちは、$NAME$",
            placeholders: { name: { content: "$1" } },
          },
        },
        en: {
          greeting: {
            message: "Hello, $NAME$",
            placeholders: { name: { content: "$1" } },
          },
          englishOnly: { message: "English fallback" },
        },
      } as const
      const fetchMock = vi.fn(async (url: string) => {
        const locale = url.includes("/ja/") ? "ja" : "en"
        return {
          ok: true,
          json: async () => catalogs[locale],
        }
      })
      vi.stubGlobal("fetch", fetchMock)
      ;(globalThis as Record<string, unknown>).chrome = {
        i18n: {
          getMessage: vi.fn((key: string) => `browser:${key}`),
          getUILanguage: vi.fn(() => "en-US"),
        },
        runtime: {
          getURL: (path: string) => `chrome-extension://test/${path}`,
        },
      }

      await applyUiLanguagePreference("ja")

      expect(t("greeting", "Hao")).toBe("こんにちは、Hao")
      expect(t("englishOnly")).toBe("English fallback")
      expect(t("missing")).toBe("missing")
      expect(getUILanguage()).toBe("ja")
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it("notifies subscribers after a selected locale is ready", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({ ok: true, json: async () => ({}) }))
      )
      ;(globalThis as Record<string, unknown>).chrome = {
        i18n: {
          getMessage: vi.fn(),
          getUILanguage: vi.fn(() => "en"),
        },
        runtime: {
          getURL: (path: string) => `chrome-extension://test/${path}`,
        },
      }
      const listener = vi.fn()
      const unsubscribe = subscribeI18n(listener)

      await applyUiLanguagePreference("zh_CN")

      expect(listener).toHaveBeenCalledTimes(1)
      expect(getI18nSnapshot()).toBeGreaterThan(0)
      unsubscribe()
    })
  })
})
