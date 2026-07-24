import { describe, expect, it, vi } from "vitest"

import {
  isDownloadTaskRunnerActive,
  runDownloadTaskSingleFlight,
} from "@/entrypoints/background/download-task-runner-registry"

describe("download task runner registry", () => {
  it("coalesces concurrent runners for the same task", async () => {
    let finish!: () => void
    const operation = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )

    const first = runDownloadTaskSingleFlight("task-1", operation)
    const duplicate = runDownloadTaskSingleFlight("task-1", operation)
    expect(isDownloadTaskRunnerActive("task-1")).toBe(true)
    finish()
    await Promise.all([first, duplicate])

    expect(operation).toHaveBeenCalledTimes(1)
    expect(isDownloadTaskRunnerActive("task-1")).toBe(false)
  })
})
