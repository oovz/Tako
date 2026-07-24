import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  ensureLivenessAlarm,
  LIVENESS_ALARM_NAME,
} from "@/entrypoints/background/offscreen-lifecycle"

describe("offscreen liveness activity behavior", () => {
  const alarmsCreate = vi.fn(async () => {})
  const alarmsGet = vi.fn(async () => undefined)
  const alarmsClear = vi.fn(async () => true)

  beforeEach(() => {
    vi.clearAllMocks()

    vi.stubGlobal("chrome", {
      alarms: {
        get: alarmsGet,
        clear: alarmsClear,
        create: alarmsCreate,
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("creates the liveness alarm at 30-second interval", async () => {
    await ensureLivenessAlarm()

    expect(alarmsCreate).toHaveBeenCalledWith(LIVENESS_ALARM_NAME, {
      periodInMinutes: 0.5,
      persistAcrossSessions: true,
    })
  })
})
