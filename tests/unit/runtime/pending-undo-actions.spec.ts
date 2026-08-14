import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  cancelPendingUndoExpiry,
  pendingUndoAlarmName,
  pendingUndoTokenFromAlarmName,
  schedulePendingUndoExpiry,
} from "@/src/runtime/pending-undo-actions"
import { resetQueueRepositoryTestEnvironment } from "../core/queue-repository-test-setup"

describe("pending Undo persistence helpers", () => {
  const createAlarm = vi.fn(async () => undefined)
  const clearAlarm = vi.fn(async () => true)

  beforeEach(() => {
    resetQueueRepositoryTestEnvironment()
    createAlarm.mockClear()
    clearAlarm.mockClear()
    Object.assign(globalThis.chrome, {
      alarms: {
        create: createAlarm,
        clear: clearAlarm,
      },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("uses an in-process five-second deadline plus a durable one-shot alarm", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const onExpired = vi.fn(async () => undefined)
    const action = {
      token: "undo-timer",
      expiresAt: 6_000,
    }

    await schedulePendingUndoExpiry(action, onExpired)

    expect(createAlarm).toHaveBeenCalledWith(
      pendingUndoAlarmName(action.token),
      { when: action.expiresAt }
    )
    await vi.advanceTimersByTimeAsync(4_999)
    expect(onExpired).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(onExpired).toHaveBeenCalledWith(action.token)

    await cancelPendingUndoExpiry(action.token)
    expect(clearAlarm).toHaveBeenCalledWith(pendingUndoAlarmName(action.token))
  })

  it("round-trips only pending Undo alarm names", () => {
    expect(pendingUndoTokenFromAlarmName("pending-undo:token-1")).toBe(
      "token-1"
    )
    expect(pendingUndoTokenFromAlarmName("pending-undo:")).toBeNull()
    expect(pendingUndoTokenFromAlarmName("offscreen-liveness")).toBeNull()
  })
})
