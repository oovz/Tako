import { describe, expect, it, vi } from "vitest"

import { runTaskSideEffectExclusive } from "@/entrypoints/background/download-task-side-effect-gate"

describe("download task side-effect gate", () => {
  it("serializes cancellation against native output handoff for one task", async () => {
    let finishHandoff!: () => void
    const events: string[] = []
    const handoff = runTaskSideEffectExclusive("task-1", async () => {
      events.push("handoff-start")
      await new Promise<void>((resolve) => {
        finishHandoff = resolve
      })
      events.push("handoff-finish")
    })
    await vi.waitFor(() => expect(events).toEqual(["handoff-start"]))

    const cancel = runTaskSideEffectExclusive("task-1", async () => {
      events.push("cancel")
    })
    await Promise.resolve()
    expect(events).toEqual(["handoff-start"])

    finishHandoff()
    await Promise.all([handoff, cancel])
    expect(events).toEqual(["handoff-start", "handoff-finish", "cancel"])
  })
})
