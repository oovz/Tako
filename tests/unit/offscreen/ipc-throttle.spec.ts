import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const sendMessage = vi.fn()

describe("sendDownloadApiRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sendMessage.mockResolvedValue({ success: true, accepted: true, id: 1 })
    vi.stubGlobal("chrome", {
      runtime: { sendMessage },
    } as unknown as typeof chrome)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("hands rapid NONE-format outputs to the background without a global delay", async () => {
    const { sendDownloadApiRequest } =
      await import("@/entrypoints/offscreen/helpers")

    const first = sendDownloadApiRequest({
      jobId: "job-1",
      attempt: 1,
      outputId: "job-1:image:0",
      taskId: "task-1",
      chapterId: "chapter-1",
      fileUrl: "blob:first",
      filename: "Series/Chapter 1/001.jpg",
      outputIndex: 0,
      outputCount: 2,
      outputKind: "image",
    })
    const second = sendDownloadApiRequest({
      jobId: "job-1",
      attempt: 1,
      outputId: "job-1:image:1",
      taskId: "task-1",
      chapterId: "chapter-1",
      fileUrl: "blob:second",
      filename: "Series/Chapter 1/002.jpg",
      outputIndex: 1,
      outputCount: 2,
      outputKind: "image",
    })

    expect(sendMessage).toHaveBeenCalledTimes(2)
    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
  })

  it("does not hand off a request after cancellation", async () => {
    const { sendDownloadApiRequest } =
      await import("@/entrypoints/offscreen/helpers")
    const controller = new AbortController()
    controller.abort()

    await expect(
      sendDownloadApiRequest(
        {
          jobId: "job-1",
          attempt: 1,
          outputId: "job-1:image:0",
          taskId: "task-1",
          chapterId: "chapter-1",
          fileUrl: "blob:first",
          filename: "Series/Chapter 1/001.jpg",
          outputIndex: 0,
          outputCount: 1,
          outputKind: "image",
        },
        controller.signal
      )
    ).rejects.toThrow("job-cancelled")
    expect(sendMessage).not.toHaveBeenCalled()
  })
})
