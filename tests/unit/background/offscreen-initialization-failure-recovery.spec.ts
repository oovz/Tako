import { beforeEach, describe, expect, it, vi } from "vitest"

import { createBackgroundOffscreenEventMessageHandlers } from "@/entrypoints/background/background-offscreen-event-message-handlers"
import type { BackgroundRuntimeHandlerDependencies } from "@/entrypoints/background/background-runtime-handler-dependencies"
import { ensureOffscreenDocumentReady } from "@/entrypoints/background/offscreen-lifecycle"
import { dispatchRuntimeMessage } from "@/src/runtime/runtime-message-dispatcher"

vi.mock("@/src/runtime/logger", () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

describe("offscreen initialization failure recovery", () => {
  const closeDocument = vi.fn()
  const createDocument = vi.fn()
  const getContexts = vi.fn()
  const sendMessage = vi.fn()
  let hasDocument = true

  beforeEach(() => {
    vi.clearAllMocks()
    hasDocument = true
    closeDocument.mockImplementation(async () => {
      hasDocument = false
    })
    createDocument.mockImplementation(async () => {
      hasDocument = true
    })
    getContexts.mockResolvedValue([{ documentId: "offscreen-document" }])
    sendMessage.mockResolvedValue({
      success: true,
      initializationState: "failed",
      documentInstanceId: "document-instance-1",
      activeJobCount: 0,
      activeSeriesResolutionCount: 0,
      activeTaskIds: [],
    })
    vi.stubGlobal("chrome", {
      alarms: {
        get: vi.fn(async () => undefined),
        create: vi.fn(async () => undefined),
        clear: vi.fn(async () => true),
      },
      runtime: {
        getURL: vi.fn(() => "chrome-extension://test/offscreen.html"),
        getContexts,
        sendMessage,
      },
      offscreen: {
        Reason: {
          BLOBS: "BLOBS",
          WORKERS: "WORKERS",
          DOM_PARSER: "DOM_PARSER",
        },
        hasDocument: vi.fn(async () => hasDocument),
        closeDocument,
        createDocument,
      },
    } as unknown as typeof chrome)
  })

  it.each([
    ["without a browser documentId", undefined],
    ["with the old browser documentId", "offscreen-document-old"],
  ])(
    "does not close a replacement created while an old initialization failure is being validated %s",
    async (_case, senderDocumentId) => {
      let currentDocumentInstanceId: string | null = "document-instance-old"
      let currentBrowserDocumentId: string | null = "offscreen-document-old"
      let releaseOldStatus!: () => void
      let signalStatusQueryStarted!: () => void
      const oldStatusQueryStarted = new Promise<void>((resolve) => {
        signalStatusQueryStarted = resolve
      })
      const oldStatusRelease = new Promise<void>((resolve) => {
        releaseOldStatus = resolve
      })

      getContexts.mockImplementation(async () =>
        currentBrowserDocumentId === null
          ? []
          : [{ documentId: currentBrowserDocumentId }]
      )
      vi.mocked(chrome.offscreen.hasDocument).mockImplementation(
        async () => currentDocumentInstanceId !== null
      )
      sendMessage.mockImplementationOnce(async () => {
        signalStatusQueryStarted()
        await oldStatusRelease
        return {
          success: true,
          initializationState: "failed",
          documentInstanceId: "document-instance-old",
          activeJobCount: 0,
          activeSeriesResolutionCount: 0,
          activeTaskIds: [],
        }
      })
      createDocument.mockImplementation(async () => {
        currentDocumentInstanceId = "document-instance-replacement"
        currentBrowserDocumentId = "offscreen-document-replacement"
      })
      const closedDocumentInstanceIds: Array<string | null> = []
      closeDocument.mockImplementation(async () => {
        closedDocumentInstanceIds.push(currentDocumentInstanceId)
        currentDocumentInstanceId = null
        currentBrowserDocumentId = null
      })
      const handlers = createBackgroundOffscreenEventMessageHandlers(
        {} as BackgroundRuntimeHandlerDependencies
      )

      const failureHandling = handlers.OFFSCREEN_INITIALIZATION_FAILED(
        {
          target: "background",
          type: "OFFSCREEN_INITIALIZATION_FAILED",
          payload: {
            errorMessage: "old registry init failure",
            documentInstanceId: "document-instance-old",
          },
        },
        {
          id: "test",
          url: "chrome-extension://test/offscreen.html",
          documentId: senderDocumentId,
        } as chrome.runtime.MessageSender
      )
      await oldStatusQueryStarted

      currentDocumentInstanceId = null
      currentBrowserDocumentId = null
      const replacementEnsure = ensureOffscreenDocumentReady()
      for (let iteration = 0; iteration < 8; iteration += 1) {
        await Promise.resolve()
      }
      releaseOldStatus()

      await expect(failureHandling).resolves.toEqual({ success: true })
      await expect(replacementEnsure).resolves.toBeUndefined()
      expect(closedDocumentInstanceIds).toEqual([])
      expect(currentDocumentInstanceId).toBe("document-instance-replacement")
    }
  )

  it("acknowledges the failed document close and allows the next ensure to recreate it", async () => {
    const handlers = createBackgroundOffscreenEventMessageHandlers(
      {} as BackgroundRuntimeHandlerDependencies
    )

    await expect(
      handlers.OFFSCREEN_INITIALIZATION_FAILED(
        {
          target: "background",
          type: "OFFSCREEN_INITIALIZATION_FAILED",
          payload: {
            errorMessage: "registry init failed",
            documentInstanceId: "document-instance-1",
          },
        },
        {
          id: "test",
          url: "chrome-extension://test/offscreen.html",
        } as chrome.runtime.MessageSender
      )
    ).resolves.toEqual({ success: true })

    expect(closeDocument).toHaveBeenCalledOnce()
    expect(hasDocument).toBe(false)

    await ensureOffscreenDocumentReady()

    expect(createDocument).toHaveBeenCalledOnce()
    expect(hasDocument).toBe(true)
  })

  it("ignores a stale application incarnation when browser documentId is absent", async () => {
    const handlers = createBackgroundOffscreenEventMessageHandlers(
      {} as BackgroundRuntimeHandlerDependencies
    )

    await expect(
      handlers.OFFSCREEN_INITIALIZATION_FAILED(
        {
          target: "background",
          type: "OFFSCREEN_INITIALIZATION_FAILED",
          payload: {
            errorMessage: "stale registry init failure",
            documentInstanceId: "stale-document-instance",
          },
        },
        {
          id: "test",
          url: "chrome-extension://test/offscreen.html",
        } as chrome.runtime.MessageSender
      )
    ).resolves.toEqual({ success: true })

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      target: "offscreen",
      type: "OFFSCREEN_STATUS",
    })
    expect(closeDocument).not.toHaveBeenCalled()
    expect(hasDocument).toBe(true)
  })

  it("ignores a stale browser documentId even when the application incarnation matches", async () => {
    const handlers = createBackgroundOffscreenEventMessageHandlers(
      {} as BackgroundRuntimeHandlerDependencies
    )

    await expect(
      handlers.OFFSCREEN_INITIALIZATION_FAILED(
        {
          target: "background",
          type: "OFFSCREEN_INITIALIZATION_FAILED",
          payload: {
            errorMessage: "stale registry init failure",
            documentInstanceId: "document-instance-1",
          },
        },
        {
          id: "test",
          url: "chrome-extension://test/offscreen.html",
          documentId: "stale-offscreen-document",
        } as chrome.runtime.MessageSender
      )
    ).resolves.toEqual({ success: true })

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      target: "offscreen",
      type: "OFFSCREEN_STATUS",
    })
    expect(closeDocument).not.toHaveBeenCalled()
    expect(hasDocument).toBe(true)
  })

  it("maps a strict close rejection to failure and retries closure only on later work", async () => {
    closeDocument.mockRejectedValueOnce(new Error("offscreen close failed"))
    const handlers = createBackgroundOffscreenEventMessageHandlers(
      {} as BackgroundRuntimeHandlerDependencies
    )
    const message = {
      target: "background",
      type: "OFFSCREEN_INITIALIZATION_FAILED",
      payload: {
        errorMessage: "registry init failed",
        documentInstanceId: "document-instance-1",
      },
    } as const

    await expect(
      dispatchRuntimeMessage(
        message,
        { documentId: "offscreen-document" } as chrome.runtime.MessageSender,
        {
          target: "background",
          handlers: handlers as never,
          classifySender: () => "offscreen",
          waitForReadiness: async () => undefined,
        }
      )
    ).resolves.toEqual({
      success: false,
      error: "offscreen close failed",
    })
    expect(hasDocument).toBe(true)
    expect(createDocument).not.toHaveBeenCalled()

    await ensureOffscreenDocumentReady()

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      target: "offscreen",
      type: "OFFSCREEN_STATUS",
    })
    expect(closeDocument).toHaveBeenCalledTimes(2)
    expect(createDocument).toHaveBeenCalledOnce()
    expect(hasDocument).toBe(true)
  })
})
