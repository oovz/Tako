import { readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { loadUiPreferences } from "@/src/ui/shared/ui-preferences-client"

describe("UI preferences query boundary", () => {
  const runtimeSendMessage = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal("chrome", {
      runtime: { sendMessage: runtimeSendMessage },
    } as unknown as typeof chrome)
  })

  it("loads the exact typed preference projection", async () => {
    runtimeSendMessage.mockResolvedValue({
      success: true,
      data: { motionPreference: "reduce", uiLanguage: "ja" },
    })

    await expect(loadUiPreferences()).resolves.toEqual({
      motionPreference: "reduce",
      uiLanguage: "ja",
    })
    expect(runtimeSendMessage).toHaveBeenCalledWith({
      target: "background",
      type: "GET_UI_PREFERENCES",
    })
  })

  it("propagates explicit query failures", async () => {
    runtimeSendMessage.mockResolvedValue({
      success: false,
      error: "unavailable",
    })
    await expect(loadUiPreferences()).rejects.toThrow("unavailable")
  })

  it("uses local storage changes only as a refetch signal", () => {
    const hookSource = readFileSync(
      join(
        process.cwd(),
        "src",
        "ui",
        "shared",
        "hooks",
        "useUiPreferences.ts"
      ),
      "utf8"
    )
    const clientSource = readFileSync(
      join(process.cwd(), "src", "ui", "shared", "ui-preferences-client.ts"),
      "utf8"
    )
    expect(hookSource).toContain("chrome.storage.onChanged.addListener")
    expect(clientSource).toContain('type: "GET_UI_PREFERENCES"')
    expect(hookSource).not.toContain("chrome.storage.local.get")
    expect(hookSource).not.toContain("useChromeStorageValue")
    expect(hookSource).not.toContain("settings-repository")
  })
})
