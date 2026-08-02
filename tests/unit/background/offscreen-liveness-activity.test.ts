import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  ensureLivenessAlarm,
  LIVENESS_ALARM_NAME,
  setLivenessAlarmArmed,
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

  it("creates a persistent one-shot liveness alarm", async () => {
    await ensureLivenessAlarm()

    expect(alarmsCreate).toHaveBeenCalledWith(LIVENESS_ALARM_NAME, {
      delayInMinutes: 0.5,
      persistAcrossSessions: true,
    })
  })

  it("clears the liveness alarm while durable work is idle", async () => {
    await setLivenessAlarmArmed(false)

    expect(alarmsClear).toHaveBeenCalledWith(LIVENESS_ALARM_NAME)
    expect(alarmsCreate).not.toHaveBeenCalled()
  })
})
