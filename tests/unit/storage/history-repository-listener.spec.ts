import { describe, expect, it, vi } from "vitest"

import { createHistoryRepositoryChangeListener } from "@/src/storage/history-repository-listener"

describe("history repository storage listener", () => {
  it("invalidates only for local history aggregate changes", () => {
    const repository = { invalidateCache: vi.fn() }
    const listener = createHistoryRepositoryChangeListener(repository as never)

    listener({ unrelated: { newValue: true } }, "local")
    listener({ downloadedChapters: { newValue: [] } }, "session")
    expect(repository.invalidateCache).not.toHaveBeenCalled()

    listener({ seriesDownloadHistory: { newValue: {} } }, "local")
    expect(repository.invalidateCache).toHaveBeenCalledOnce()
  })
})
