import { describe, expect, it } from "vitest"

import { runDispatchPersistenceExclusive } from "@/src/runtime/dispatch-persistence-gate"

describe("dispatch persistence gate", () => {
  it("releases the next operation after a rejected owner", async () => {
    const events: string[] = []

    await expect(
      runDispatchPersistenceExclusive(async () => {
        events.push("first")
        throw new Error("first operation failed")
      })
    ).rejects.toThrow("first operation failed")

    await expect(
      runDispatchPersistenceExclusive(async () => {
        events.push("second")
        return "recovered"
      })
    ).resolves.toBe("recovered")
    expect(events).toEqual(["first", "second"])
  })

  it("runs operations one at a time in request order", async () => {
    const events: string[] = []
    let releaseFirst!: () => void
    let signalFirstStarted!: () => void
    const firstBarrier = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const firstStarted = new Promise<void>((resolve) => {
      signalFirstStarted = resolve
    })

    const first = runDispatchPersistenceExclusive(async () => {
      events.push("first:start")
      signalFirstStarted()
      await firstBarrier
      events.push("first:end")
    })
    const second = runDispatchPersistenceExclusive(async () => {
      events.push("second:start")
    })

    await firstStarted
    expect(events).toEqual(["first:start"])
    releaseFirst()
    await Promise.all([first, second])
    expect(events).toEqual(["first:start", "first:end", "second:start"])
  })
})
