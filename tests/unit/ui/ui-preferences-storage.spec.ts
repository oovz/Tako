import { describe, expect, it } from "vitest"

import { parseUiPreferencesDocument } from "@/src/ui/shared/hooks/useUiPreferences"

describe("persisted UI preferences", () => {
  it("defaults the removed full-motion preference to system", () => {
    expect(
      parseUiPreferencesDocument({
        motionPreference: "full",
        uiLanguage: "zh_TW",
      })
    ).toEqual({ motionPreference: "system", uiLanguage: "zh_TW" })
  })

  it("defaults malformed or missing preferences independently", () => {
    expect(
      parseUiPreferencesDocument({
        alwaysReduceMotion: true,
        motionPreference: "invalid",
        uiLanguage: "fr",
      })
    ).toEqual({ motionPreference: "system", uiLanguage: "auto" })
    expect(parseUiPreferencesDocument(null)).toEqual({
      motionPreference: "system",
      uiLanguage: "auto",
    })
  })
})
