import { describe, expect, it, vi } from "vitest"

import {
  finalizePendingOutput,
  reconcilePreparedOutput,
} from "@/entrypoints/background/native-output-finalizer"
import type { CentralizedStateManager } from "@/src/runtime/centralized-state"
import {
  createPendingDownloadsStoreStub,
  createPendingOutputRecord,
} from "./pending-output-test-helpers"

function stateManager() {
  const updateDownloadTask = vi.fn(async () => undefined)
  return {
    manager: { updateDownloadTask } as unknown as CentralizedStateManager,
    updateDownloadTask,
  }
}

describe("native output finalization", () => {
  it("commits success only after Chrome reports complete", async () => {
    const record = createPendingOutputRecord({ downloadId: 101 })
    const pendingOutputs = createPendingDownloadsStoreStub([record])
    const requestBlobRevocation = vi.fn(async () => undefined)
    const onOutputSettled = vi.fn(async () => undefined)
    const { manager, updateDownloadTask } = stateManager()

    await expect(
      finalizePendingOutput(
        {
          stateManager: manager,
          pendingOutputs,
          requestBlobRevocation,
          onOutputSettled,
        },
        { downloadId: 101, state: "complete" }
      )
    ).resolves.toMatchObject({ state: "complete" })

    expect(updateDownloadTask).toHaveBeenCalledWith("task-1", {
      lastSuccessfulDownloadId: 101,
    })
    expect(requestBlobRevocation).toHaveBeenCalledTimes(1)
    expect(requestBlobRevocation).toHaveBeenCalledWith({
      jobId: "job-1",
      attempt: 1,
      outputId: "job-1:archive:0",
      blobUrl: "blob:output-1",
    })
    expect(pendingOutputs.markBlobRevoked).toHaveBeenCalledWith(
      "job-1:archive:0"
    )
    expect(onOutputSettled).toHaveBeenCalledTimes(1)
  })

  it("keeps an interruption terminal when a late complete event arrives", async () => {
    const record = createPendingOutputRecord({
      downloadId: 102,
      state: "interrupted",
      error: "network failed",
      terminalAt: 2_000,
    })
    const pendingOutputs = createPendingDownloadsStoreStub([record])
    const requestBlobRevocation = vi.fn(async () => undefined)
    const { manager, updateDownloadTask } = stateManager()

    await expect(
      finalizePendingOutput(
        {
          stateManager: manager,
          pendingOutputs,
          requestBlobRevocation,
        },
        { downloadId: 102, state: "complete" }
      )
    ).resolves.toMatchObject({
      state: "interrupted",
      error: "network failed",
    })
    expect(updateDownloadTask).not.toHaveBeenCalled()
    expect(requestBlobRevocation).toHaveBeenCalledTimes(1)
  })

  it("updates late output accounting without erasing cancellation audit text", async () => {
    const record = createPendingOutputRecord({ downloadId: 103 })
    const pendingOutputs = createPendingDownloadsStoreStub([record])
    const requestBlobRevocation = vi.fn(async () => undefined)
    const updateDownloadTask = vi.fn(async () => undefined)
    const updateDownloadTaskChapter = vi.fn(async () => undefined)
    const manager = {
      getGlobalState: vi.fn(async () => ({
        downloadQueue: [
          {
            id: "task-1",
            status: "canceled",
            chapters: [
              {
                id: "chapter-1",
                status: "canceled",
                dispatchAttempt: 1,
                errorMessage: "Canceled by user",
                outputs: { requested: 1, committed: 0, failed: 0 },
              },
            ],
          },
        ],
      })),
      updateDownloadTask,
      updateDownloadTaskChapter,
    } as unknown as CentralizedStateManager

    await finalizePendingOutput(
      {
        stateManager: manager,
        pendingOutputs,
        requestBlobRevocation,
      },
      { downloadId: 103, state: "complete" }
    )

    expect(updateDownloadTaskChapter).toHaveBeenCalledWith(
      "task-1",
      "chapter-1",
      "canceled",
      {
        outputs: { requested: 1, committed: 1, failed: 0 },
        errorMessage: "Canceled by user",
      }
    )
  })

  it("recovers a prepared intent by Blob URL and finalizes its Chrome record", async () => {
    const prepared = createPendingOutputRecord({
      downloadId: undefined,
      state: "prepared",
      blobUrl: "blob:prepared-output",
    })
    const pendingOutputs = createPendingDownloadsStoreStub([prepared])
    const requestBlobRevocation = vi.fn(async () => undefined)
    const { manager, updateDownloadTask } = stateManager()
    const search = vi.fn(async (query: { id?: number; url?: string }) =>
      query.url
        ? [
            {
              id: 201,
              url: "blob:prepared-output",
              state: "complete",
            },
          ]
        : [{ id: 201, url: "blob:prepared-output", state: "complete" }]
    )
    vi.stubGlobal("chrome", {
      downloads: { search },
    } as unknown as typeof chrome)

    await expect(
      reconcilePreparedOutput(
        {
          stateManager: manager,
          pendingOutputs,
          requestBlobRevocation,
        },
        prepared,
        { missingIsInterrupted: true }
      )
    ).resolves.toMatchObject({ downloadId: 201, state: "complete" })

    expect(pendingOutputs.attachDownload).toHaveBeenCalledWith(
      "job-1:archive:0",
      201
    )
    expect(updateDownloadTask).toHaveBeenCalledWith("task-1", {
      lastSuccessfulDownloadId: 201,
    })
    expect(requestBlobRevocation).toHaveBeenCalledTimes(1)
  })

  it("marks an unrecoverable prepared intent interrupted before revoking it", async () => {
    const prepared = createPendingOutputRecord({
      downloadId: undefined,
      state: "prepared",
    })
    const pendingOutputs = createPendingDownloadsStoreStub([prepared])
    const requestBlobRevocation = vi.fn(async () => undefined)
    const { manager, updateDownloadTask } = stateManager()
    vi.stubGlobal("chrome", {
      downloads: { search: vi.fn(async () => []) },
    } as unknown as typeof chrome)

    await expect(
      reconcilePreparedOutput(
        {
          stateManager: manager,
          pendingOutputs,
          requestBlobRevocation,
        },
        prepared,
        { missingIsInterrupted: true }
      )
    ).resolves.toMatchObject({ state: "interrupted" })

    expect(pendingOutputs.markPreparedInterrupted).toHaveBeenCalledWith(
      "job-1:archive:0",
      "Native download was not accepted before the service worker stopped"
    )
    expect(updateDownloadTask).not.toHaveBeenCalled()
    expect(requestBlobRevocation).toHaveBeenCalledTimes(1)
  })
})
