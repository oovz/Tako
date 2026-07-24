import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

const locales = ["en", "ja", "zh_CN", "zh_TW"] as const
const requiredKeys = [
  "settings_customFolderRequired",
  "settings_customFolderPermissionDenied",
  "settings_validateCustomFolderFailed",
  "settings_invalidDownloadMode",
  "settings_customFolderClearedFallback",
  "settings_customFolderPermissionLostFallback",
  "settings_unknownError",
  "background_settingsSyncFailed",
] as const

describe("settings lifecycle localization", () => {
  it.each(locales)("defines every lifecycle message in %s", async (locale) => {
    const catalog = JSON.parse(
      await readFile(
        new URL(
          `../../../public/_locales/${locale}/messages.json`,
          import.meta.url
        ),
        "utf8"
      )
    ) as Record<string, { message?: string }>

    for (const key of requiredKeys) {
      expect(catalog[key]?.message, key).toBeTruthy()
    }
  })

  it("does not hard-code options lifecycle toast copy", async () => {
    const source = await readFile(
      new URL(
        "../../../entrypoints/options/hooks/useOptionsPageState.ts",
        import.meta.url
      ),
      "utf8"
    )

    expect(source).not.toContain("toast.error('Failed to load settings')")
    expect(source).not.toContain("toast.success('Settings saved successfully')")
    expect(source).not.toContain("toast.info('Changes discarded')")
  })
})
