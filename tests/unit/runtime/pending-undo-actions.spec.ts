import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  cancelPendingUndoExpiry,
  normalizePendingUndoActions,
  pendingUndoAlarmName,
  pendingUndoTokenFromAlarmName,
  schedulePendingUndoExpiry,
} from "@/src/runtime/pending-undo-actions"
import type { PendingUndoAction } from "@/src/types/queue-state"
import {
  makeDownloadTask,
  resetCentralizedStateTestEnvironment,
} from "../core/centralized-state-test-setup"

describe("pending Undo persistence helpers", () => {
  const createAlarm = vi.fn(async () => undefined)
  const clearAlarm = vi.fn(async () => true)

  beforeEach(() => {
    resetCentralizedStateTestEnvironment()
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

  it("normalizes only complete persisted actions and task snapshots", () => {
    const action: PendingUndoAction = {
      token: "undo-1",
      type: "cancel_queued",
      taskSnapshot: makeDownloadTask({ id: "task-1" }),
      previousQueuePosition: 2,
      createdAt: 1_000,
      expiresAt: 6_000,
    }

    expect(
      normalizePendingUndoActions([
        action,
        { ...action, token: "" },
        { ...action, type: "unknown" },
        { ...action, previousQueuePosition: -1 },
        { ...action, expiresAt: 999 },
        { ...action, taskSnapshot: null },
      ])
    ).toEqual([
      expect.objectContaining({
        token: "undo-1",
        type: "cancel_queued",
        previousQueuePosition: 2,
        taskSnapshot: expect.objectContaining({ id: "task-1" }),
      }),
    ])
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
