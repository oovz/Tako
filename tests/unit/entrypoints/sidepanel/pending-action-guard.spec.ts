import { describe, expect, it } from "vitest"

import { createPendingActionGuard } from "@/entrypoints/sidepanel/hooks/pending-action-guard"

describe("createPendingActionGuard", () => {
  it("rejects a repeated action synchronously until the first action finishes", () => {
    const guard = createPendingActionGuard()

    expect(guard.tryBegin("retry:task-1")).toBe(true)
    expect(guard.tryBegin("retry:task-1")).toBe(false)

    guard.finish("retry:task-1")

    expect(guard.tryBegin("retry:task-1")).toBe(true)
  })

  it("tracks different tasks and action types independently", () => {
    const guard = createPendingActionGuard()

    expect(guard.tryBegin("restart:task-1")).toBe(true)
    expect(guard.tryBegin("remove:task-1")).toBe(true)
    expect(guard.tryBegin("restart:task-2")).toBe(true)
    expect(guard.tryBegin("move-to-top:task-1")).toBe(true)
    expect(guard.tryBegin("move-to-top:task-1")).toBe(false)
  })
})
