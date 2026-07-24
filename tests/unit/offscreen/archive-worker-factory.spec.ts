import { afterEach, describe, expect, it, vi } from "vitest"

import createZipArchiveWorker from "@/entrypoints/offscreen/archive-worker-factory"

describe("createZipArchiveWorker", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("loads the WXT-bundled worker from the extension origin", () => {
    const worker = { terminate: vi.fn() }
    const WorkerMock = vi.fn(function MockWorker() {
      return worker
    })
    const getURL = vi.fn(() => "chrome-extension://test/zip-archive-worker.js")
    vi.stubGlobal("Worker", WorkerMock)
    vi.stubGlobal("chrome", { runtime: { getURL } })

    expect(createZipArchiveWorker()).toBe(worker)
    expect(getURL).toHaveBeenCalledWith("zip-archive-worker.js")
    expect(WorkerMock).toHaveBeenCalledWith(
      "chrome-extension://test/zip-archive-worker.js"
    )
  })
})
