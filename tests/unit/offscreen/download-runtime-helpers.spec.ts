import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  requestBrowserBlobDownload,
  resolveWritableDownloadRoot,
} from "@/entrypoints/offscreen/download-runtime-helpers"

const mocks = vi.hoisted(() => ({
  sendDownloadApiRequest: vi.fn(),
  loadDownloadRootHandle: vi.fn(),
  queryFsaPermission: vi.fn(),
}))

const outputIdentity = {
  jobId: "job-1",
  attempt: 1,
  outputId: "job-1:archive:0",
  outputIndex: 0,
  outputCount: 1,
  outputKind: "archive" as const,
}

vi.mock("@/entrypoints/offscreen/helpers", () => ({
  sendDownloadApiRequest: mocks.sendDownloadApiRequest,
}))

vi.mock("@/src/storage/fs-access", () => ({
  loadDownloadRootHandle: mocks.loadDownloadRootHandle,
  queryFsaPermission: mocks.queryFsaPermission,
}))

describe("requestBrowserBlobDownload", () => {
  const createObjectURL = vi.fn(() => "blob:mock-url")
  const revokeObjectURL = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    createObjectURL.mockReturnValue("blob:mock-url")
    vi.stubGlobal("URL", {
      createObjectURL,
      revokeObjectURL,
    } as unknown as typeof URL)
  })

  it("keeps the blob URL alive when the background accepts the download", async () => {
    mocks.sendDownloadApiRequest.mockResolvedValueOnce({
      success: true,
      accepted: true,
      id: 123,
    })

    const response = await requestBrowserBlobDownload({
      ...outputIdentity,
      taskId: "task-1",
      chapterId: "chapter-1",
      blob: new Blob(["data"], { type: "application/zip" }),
      filename: "Series/Chapter 1.zip",
    })

    expect(response).toEqual({ success: true, accepted: true, id: 123 })
    expect(mocks.sendDownloadApiRequest).toHaveBeenCalledWith(
      {
        ...outputIdentity,
        taskId: "task-1",
        chapterId: "chapter-1",
        fileUrl: "blob:mock-url",
        filename: "Series/Chapter 1.zip",
      },
      undefined
    )
    expect(revokeObjectURL).not.toHaveBeenCalled()
  })

  it("revokes the blob URL when the background rejects the download handoff", async () => {
    mocks.sendDownloadApiRequest.mockResolvedValueOnce({
      success: false,
      error: "downloads.download returned no download id",
    })

    const response = await requestBrowserBlobDownload({
      ...outputIdentity,
      taskId: "task-1",
      chapterId: "chapter-1",
      blob: new Blob(["data"], { type: "application/zip" }),
      filename: "Series/Chapter 1.zip",
    })

    expect(response).toEqual({
      success: false,
      error: "downloads.download returned no download id",
    })
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url")
  })

  it("retains the blob URL when transport failure makes native acceptance ambiguous", async () => {
    mocks.sendDownloadApiRequest.mockRejectedValueOnce(
      new Error("message port closed")
    )

    await expect(
      requestBrowserBlobDownload({
        ...outputIdentity,
        taskId: "task-1",
        chapterId: "chapter-1",
        blob: new Blob(["data"], { type: "application/zip" }),
        filename: "Series/Chapter 1.zip",
      })
    ).rejects.toThrow("message port closed")

    expect(revokeObjectURL).not.toHaveBeenCalled()
  })

  it("does not silently fall back when the stored custom folder is missing", async () => {
    mocks.loadDownloadRootHandle.mockResolvedValue(undefined)

    await expect(resolveWritableDownloadRoot()).rejects.toThrow(
      "Custom folder is not configured"
    )
  })

  it("does not create or hand off a blob URL after the task is cancelled", async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      requestBrowserBlobDownload({
        ...outputIdentity,
        taskId: "task-1",
        chapterId: "chapter-1",
        blob: new Blob(["data"], { type: "application/zip" }),
        filename: "Series/Chapter 1.zip",
        signal: controller.signal,
      })
    ).rejects.toThrow("job-cancelled")

    expect(createObjectURL).not.toHaveBeenCalled()
    expect(mocks.sendDownloadApiRequest).not.toHaveBeenCalled()
  })
})
