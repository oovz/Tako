import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import * as uiPreferences from "@/src/ui/shared/ui-preferences"

describe("UI preferences", () => {
  const attributes = new Map<string, string>()

  beforeEach(() => {
    attributes.clear()
    vi.stubGlobal("document", {
      documentElement: {
        getAttribute: (name: string) => attributes.get(name) ?? null,
        hasAttribute: (name: string) => attributes.has(name),
        removeAttribute: (name: string) => attributes.delete(name),
        setAttribute: (name: string, value: string) =>
          attributes.set(name, value),
        toggleAttribute: (name: string, force: boolean) => {
          if (force) attributes.set(name, "")
          else attributes.delete(name)
        },
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("applies system and reduced motion modes to the root", () => {
    const applyMotionPreference = Reflect.get(
      uiPreferences,
      "applyMotionPreference"
    ) as undefined | ((preference: "system" | "reduce") => void)
    expect(applyMotionPreference).toBeTypeOf("function")

    applyMotionPreference?.("reduce")
    expect(document.documentElement.getAttribute("data-tako-motion")).toBe(
      "reduce"
    )

    applyMotionPreference?.("system")
    expect(document.documentElement.hasAttribute("data-tako-motion")).toBe(
      false
    )
  })

  it("converts packaged locale names to valid document language tags", () => {
    expect(uiPreferences.toDocumentLanguageTag("en")).toBe("en")
    expect(uiPreferences.toDocumentLanguageTag("ja")).toBe("ja")
    expect(uiPreferences.toDocumentLanguageTag("zh_CN")).toBe("zh-CN")
    expect(uiPreferences.toDocumentLanguageTag("zh_TW")).toBe("zh-TW")
  })
})
