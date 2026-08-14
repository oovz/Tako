import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/src/runtime/logger", () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock("@/src/runtime/site-integration-offscreen-initialization", () => ({
  initializeOffscreenSiteIntegrations: vi.fn(),
}))

import { initializeOffscreenSiteIntegrations } from "@/src/runtime/site-integration-offscreen-initialization"

describe("offscreen entrypoint initialization failure handling", () => {
  const addListener = vi.fn()
  const removeListener = vi.fn()
  const sendMessage = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    sendMessage.mockResolvedValue({ success: true })

    const mockElement = {
      textContent: "",
      dataset: {},
      hidden: false,
      innerHTML: "",
    }

    vi.stubGlobal("chrome", {
      runtime: {
        id: "test-extension",
        sendMessage,
        onMessage: {
          addListener,
          removeListener,
        },
      },
    } as unknown as typeof chrome)

    vi.stubGlobal("document", {
      getElementById: vi.fn().mockReturnValue(mockElement),
      addEventListener: vi.fn(),
    } as unknown as Document)

    vi.stubGlobal("window", globalThis as unknown as Window & typeof globalThis)
    vi.stubGlobal("HTMLElement", class {} as unknown as typeof HTMLElement)
    vi.stubGlobal(
      "HTMLDivElement",
      class {} as unknown as typeof HTMLDivElement
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("flushes queued responses and fails closed after offscreen initialization fails", async () => {
    vi.mocked(initializeOffscreenSiteIntegrations).mockRejectedValueOnce(
      new Error("registry init failed")
    )

    await import("@/entrypoints/offscreen/main")

    expect(addListener).toHaveBeenCalledTimes(1)

    const listener = addListener.mock.calls[0]?.[0] as (
      message: { target: string; type: string; payload?: unknown },
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: { success: boolean; error?: string }) => void
    ) => boolean

    const queuedResponse = vi.fn()
    expect(
      listener(
        {
          target: "offscreen",
          type: "REVOKE_BLOB_URL",
          payload: {
            jobId: "job-queued",
            attempt: 1,
            taskId: "task-queued",
            chapterId: "chapter-queued",
            fingerprint: "a".repeat(64),
            documentInstanceId: "document-queued",
            outputId: "job-queued:archive:0",
            blobUrl: "blob:queued-before-init-failure",
          },
        },
        { id: "test-extension" } as chrome.runtime.MessageSender,
        queuedResponse
      )
    ).toBe(true)

    for (
      let attempt = 0;
      attempt < 5 && queuedResponse.mock.calls.length === 0;
      attempt += 1
    ) {
      await Promise.resolve()
    }

    expect(queuedResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.stringContaining("registry init failed"),
      })
    )
    await vi.waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith({
        target: "background",
        type: "OFFSCREEN_INITIALIZATION_FAILED",
        payload: {
          errorMessage: "registry init failed",
          documentInstanceId: expect.any(String),
        },
      })
    )

    const postFailureResponse = vi.fn()
    expect(
      listener(
        {
          target: "offscreen",
          type: "REVOKE_BLOB_URL",
          payload: {
            jobId: "job-after-failure",
            attempt: 1,
            taskId: "task-after-failure",
            chapterId: "chapter-after-failure",
            fingerprint: "b".repeat(64),
            documentInstanceId: "document-after-failure",
            outputId: "job-after-failure:archive:0",
            blobUrl: "blob:after-init-failure",
          },
        },
        { id: "test-extension" } as chrome.runtime.MessageSender,
        postFailureResponse
      )
    ).toBe(true)

    await vi.waitFor(() =>
      expect(postFailureResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringContaining("registry init failed"),
        })
      )
    )
  })
})
