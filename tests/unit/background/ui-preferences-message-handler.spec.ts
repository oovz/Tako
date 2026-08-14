import { beforeEach, describe, expect, it, vi } from "vitest"

import { createBackgroundSettingsUiMessageHandlers } from "@/entrypoints/background/background-settings-ui-message-handlers"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import { SettingsRepository } from "@/src/storage/settings-repository"

describe("UI preferences message handler", () => {
  let settingsRepository: SettingsRepository
  beforeEach(() => {
    vi.restoreAllMocks()
    settingsRepository = new SettingsRepository("warn")
  })

  it("returns only the exact preference projection from authoritative settings", async () => {
    vi.spyOn(settingsRepository, "getSettings").mockResolvedValue({
      ...structuredClone(DEFAULT_SETTINGS),
      motionPreference: "reduce",
      uiLanguage: "ja",
      notifications: false,
    })
    const handlers = createBackgroundSettingsUiMessageHandlers({
      settingsRepository,
    } as never)

    await expect(
      handlers.GET_UI_PREFERENCES({} as never, {} as never)
    ).resolves.toEqual({
      success: true,
      data: { motionPreference: "reduce", uiLanguage: "ja" },
    })
  })
})
