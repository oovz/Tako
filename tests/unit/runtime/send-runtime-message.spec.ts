import { beforeEach, describe, expect, it, vi } from "vitest"

import { sendRuntimeMessage } from "@/src/runtime/send-runtime-message"

describe("sendRuntimeMessage", () => {
  const runtimeSendMessage = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal("chrome", {
      runtime: { sendMessage: runtimeSendMessage },
    } as unknown as typeof chrome)
  })

  it("sends the validated targeted request and validates its response", async () => {
    runtimeSendMessage.mockResolvedValue({ success: true })
    const request = {
      target: "offscreen",
      type: "REVOKE_BLOB_URL",
      payload: {
        jobId: "job-1",
        attempt: 1,
        taskId: "task-1",
        chapterId: "chapter-1",
        fingerprint: "a".repeat(64),
        documentInstanceId: "document-1",
        outputId: "output-1",
        blobUrl: "blob:output-1",
      },
    } as const

    await expect(sendRuntimeMessage(request)).resolves.toEqual({
      success: true,
    })
    expect(runtimeSendMessage).toHaveBeenCalledWith(request)
  })

  it.each([undefined, { success: true, legacy: true }])(
    "rejects an invalid response %#",
    async (response) => {
      runtimeSendMessage.mockResolvedValue(response)

      await expect(
        sendRuntimeMessage({
          target: "offscreen",
          type: "OFFSCREEN_STATUS",
        })
      ).rejects.toThrow("Invalid OFFSCREEN_STATUS response")
    }
  )

  it("accepts the exact offscreen initialization state and rejects the obsolete boolean", async () => {
    const status = {
      success: true,
      initializationState: "failed",
      documentInstanceId: "document-1",
      activeJobCount: 0,
      activeSeriesResolutionCount: 0,
      activeTaskIds: [],
    } as const
    runtimeSendMessage.mockResolvedValueOnce(status)

    await expect(
      sendRuntimeMessage({
        target: "offscreen",
        type: "OFFSCREEN_STATUS",
      })
    ).resolves.toEqual(status)

    runtimeSendMessage.mockResolvedValueOnce({
      success: true,
      isInitialized: false,
      documentInstanceId: "document-1",
      activeJobCount: 0,
      activeSeriesResolutionCount: 0,
      activeTaskIds: [],
    })
    await expect(
      sendRuntimeMessage({
        target: "offscreen",
        type: "OFFSCREEN_STATUS",
      })
    ).rejects.toThrow("Invalid OFFSCREEN_STATUS response")
  })

  it("rejects malformed typed Options download-state responses", async () => {
    runtimeSendMessage.mockResolvedValue({
      success: true,
      data: { tasks: [], destinationIssue: null, queueStorageBytes: "42" },
    })

    await expect(
      sendRuntimeMessage({
        target: "background",
        type: "GET_OPTIONS_DOWNLOAD_STATE",
      })
    ).rejects.toThrow("Invalid GET_OPTIONS_DOWNLOAD_STATE response")
  })

  it("rejects a request before transport when its target is absent", async () => {
    await expect(
      sendRuntimeMessage({
        type: "OFFSCREEN_STATUS",
      } as never)
    ).rejects.toThrow("Invalid OFFSCREEN_STATUS request")
    expect(runtimeSendMessage).not.toHaveBeenCalled()
  })

  it.each([
    {
      success: true,
      seriesMetadata: { title: "Series", unsupported: true },
    },
    {
      success: true,
      chapterList: {
        chapters: [
          {
            id: "chapter-1",
            url: "https://example.test/chapter-1",
            title: "Chapter 1",
            comicInfo: { Title: "Chapter 1", unsupported: true },
          },
        ],
      },
    },
  ])("rejects malformed nested parsed-series output %#", async (response) => {
    runtimeSendMessage.mockResolvedValue(response)

    await expect(
      sendRuntimeMessage({
        target: "offscreen",
        type: "OFFSCREEN_PARSE_SERIES_HTML",
        payload: {
          requestId: "00000000-0000-4000-8000-000000000001",
          siteIntegrationId: "site",
          seriesUrl: "https://example.test/series",
          html: "<html />",
          rateLimitSettings: {
            image: { concurrency: 1, delayMs: 0 },
            chapter: { concurrency: 1, delayMs: 0 },
          },
        },
      })
    ).rejects.toThrow("Invalid OFFSCREEN_PARSE_SERIES_HTML response")
  })
})
