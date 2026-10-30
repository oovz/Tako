import { afterEach, describe, expect, it, vi } from "vitest"
import {
  __resetI18nForTests,
  applyUiLanguagePreference,
  getI18nSnapshot,
  getUILanguage,
  subscribeI18n,
  t,
} from "@/src/runtime/i18n"

afterEach(() => {
  __resetI18nForTests()
  vi.unstubAllGlobals()
})

describe("UI catalog request lifetime", () => {
  it("keeps the latest automatic preference when an older manual catalog finishes", async () => {
    let resolveCatalog!: (value: Response) => void
    const catalog = new Promise<Response>((resolve) => {
      resolveCatalog = resolve
    })
    vi.stubGlobal(
      "fetch",
      vi.fn(() => catalog)
    )
    const listener = vi.fn()
    subscribeI18n(listener)
    const applying = applyUiLanguagePreference("ja")
    await applyUiLanguagePreference("auto")
    resolveCatalog(
      new Response(JSON.stringify({ greeting: { message: "manual" } }))
    )
    await applying
    expect(getUILanguage()).toBe("en")
    expect(t("greeting")).toBe("greeting")
    expect(listener).not.toHaveBeenCalled()
  })

  it("uses the English fallback after a selected catalog fails and retries the failed load", async () => {
    let failSelected = true
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/ja/") && failSelected)
          return new Response("unavailable", { status: 503 })
        return new Response(
          JSON.stringify({
            greeting: {
              message: url.includes("/ja/") ? "Japanese" : "English",
            },
          })
        )
      })
    )
    await applyUiLanguagePreference("ja")
    expect(t("greeting")).toBe("English")
    const listener = vi.fn()
    subscribeI18n(listener)
    const fallbackSnapshot = getI18nSnapshot()
    failSelected = false
    await applyUiLanguagePreference("ja")
    expect(t("greeting")).toBe("Japanese")
    expect(listener).toHaveBeenCalledTimes(1)
    expect(getI18nSnapshot()).toBeGreaterThan(fallbackSnapshot)
    const recoveredSnapshot = getI18nSnapshot()

    await applyUiLanguagePreference("ja")
    expect(t("greeting")).toBe("Japanese")
    expect(listener).toHaveBeenCalledTimes(1)
    expect(getI18nSnapshot()).toBe(recoveredSnapshot)

    await applyUiLanguagePreference("auto")
    expect(t("greeting")).toBe("greeting")
  })
})
