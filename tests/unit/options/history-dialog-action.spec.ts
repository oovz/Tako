import { describe, expect, it, vi } from "vitest"

import { runConfirmedHistoryAction } from "@/entrypoints/options/hooks/history-dialog-action"

describe("history dialog actions", () => {
  it("keeps the dialog state intact when clearing fails", async () => {
    const onSuccess = vi.fn()
    const succeeded = await runConfirmedHistoryAction(
      async () => false,
      onSuccess
    )

    expect(succeeded).toBe(false)
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it("runs dialog cleanup only after a successful clear", async () => {
    const onSuccess = vi.fn()
    const succeeded = await runConfirmedHistoryAction(
      async () => true,
      onSuccess
    )

    expect(succeeded).toBe(true)
    expect(onSuccess).toHaveBeenCalledTimes(1)
  })
})
