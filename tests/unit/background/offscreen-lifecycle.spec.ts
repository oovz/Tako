import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/src/runtime/logger", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

import {
  closeOffscreenDocumentIfCurrent,
  ensureOffscreenDocumentReady,
  queryOffscreenJob,
  queryOffscreenStatus,
  refreshLivenessAlarmForDurableWork,
  runOffscreenDocumentAdmissionExclusive,
  scheduleOffscreenCloseIfIdle,
} from "@/entrypoints/background/offscreen-lifecycle"

afterEach(() => {
  vi.useRealTimers()
})

describe("ensureOffscreenDocumentReady", () => {
  const getContexts = vi.fn()
  const hasDocument = vi.fn()
  const createDocument = vi.fn()
  const closeDocument = vi.fn()
  const sendMessage = vi.fn()
  const getURL = vi.fn(() => "chrome-extension://test/offscreen.html")

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    getContexts.mockResolvedValue([{ documentId: "offscreen-document" }])

    vi.stubGlobal("chrome", {
      runtime: {
        getURL,
        getContexts,
        sendMessage,
      },
      offscreen: {
        hasDocument,
        createDocument,
        closeDocument,
        Reason: {
          BLOBS: "BLOBS",
          WORKERS: "WORKERS",
          DOM_PARSER: "DOM_PARSER",
        },
      },
      alarms: {
        get: vi.fn(async () => undefined),
        clear: vi.fn(async () => true),
        create: vi.fn(async () => undefined),
      },
      storage: {
        local: { get: vi.fn(async () => ({})) },
      },
    })
  })

  it("creates the offscreen document when it does not already exist without polling readiness", async () => {
    hasDocument.mockResolvedValue(false)
    createDocument.mockResolvedValue(undefined)

    await ensureOffscreenDocumentReady()

    expect(createDocument).toHaveBeenCalledTimes(1)
  })

  it("reuses an existing ready offscreen document", async () => {
    hasDocument.mockResolvedValue(true)
    sendMessage.mockResolvedValue({
      success: true,
      initializationState: "ready",
      documentInstanceId: "document-1",
      activeJobCount: 0,
      activeSeriesResolutionCount: 0,
      activeTaskIds: [],
    })

    await ensureOffscreenDocumentReady()

    expect(sendMessage).toHaveBeenCalledWith({
      target: "offscreen",
      type: "OFFSCREEN_STATUS",
    })
    expect(closeDocument).not.toHaveBeenCalled()
    expect(createDocument).not.toHaveBeenCalled()
  })

  it("preserves an existing initializing offscreen document", async () => {
    hasDocument.mockResolvedValue(true)
    sendMessage.mockResolvedValue({
      success: true,
      initializationState: "initializing",
      documentInstanceId: "document-1",
      activeJobCount: 0,
      activeSeriesResolutionCount: 0,
      activeTaskIds: [],
    })

    await ensureOffscreenDocumentReady()

    expect(closeDocument).not.toHaveBeenCalled()
    expect(createDocument).not.toHaveBeenCalled()
  })

  it("closes only the exact current application and browser incarnation", async () => {
    hasDocument.mockResolvedValue(true)
    sendMessage.mockResolvedValue({
      success: true,
      initializationState: "failed",
      documentInstanceId: "document-1",
      activeJobCount: 0,
      activeSeriesResolutionCount: 0,
      activeTaskIds: [],
    })

    await expect(
      closeOffscreenDocumentIfCurrent({
        documentInstanceId: "document-1",
        browserDocumentId: "offscreen-document",
      })
    ).resolves.toBe("closed")
    expect(closeDocument).toHaveBeenCalledOnce()
  })

  it.each([
    {
      caseName: "stale application incarnation",
      documentInstanceId: "document-stale",
      browserDocumentId: undefined,
    },
    {
      caseName: "stale browser incarnation",
      documentInstanceId: "document-1",
      browserDocumentId: "offscreen-document-stale",
    },
  ] as const)(
    "returns stale without closing for a $caseName",
    async ({ documentInstanceId, browserDocumentId }) => {
      hasDocument.mockResolvedValue(true)
      sendMessage.mockResolvedValue({
        success: true,
        initializationState: "failed",
        documentInstanceId: "document-1",
        activeJobCount: 0,
        activeSeriesResolutionCount: 0,
        activeTaskIds: [],
      })

      await expect(
        closeOffscreenDocumentIfCurrent({
          documentInstanceId,
          browserDocumentId,
        })
      ).resolves.toBe("stale")
      expect(closeDocument).not.toHaveBeenCalled()
    }
  )

  it("replaces a failed document discovered from status without an in-memory failure marker", async () => {
    hasDocument.mockResolvedValue(true)
    sendMessage.mockResolvedValue({
      success: true,
      initializationState: "failed",
      documentInstanceId: "document-1",
      activeJobCount: 0,
      activeSeriesResolutionCount: 0,
      activeTaskIds: [],
    })
    closeDocument.mockResolvedValue(undefined)
    createDocument.mockResolvedValue(undefined)

    await ensureOffscreenDocumentReady()

    expect(closeDocument).toHaveBeenCalledOnce()
    expect(createDocument).toHaveBeenCalledOnce()
  })

  it("coalesces concurrent failed-document replacement through close and create", async () => {
    let documentExists = true
    hasDocument.mockImplementation(async () => documentExists)
    sendMessage.mockResolvedValue({
      success: true,
      initializationState: "failed",
      documentInstanceId: "document-1",
      activeJobCount: 0,
      activeSeriesResolutionCount: 0,
      activeTaskIds: [],
    })
    closeDocument.mockImplementation(async () => {
      if (!documentExists) {
        throw new Error("No current offscreen document")
      }
      documentExists = false
    })
    createDocument.mockImplementation(async () => {
      documentExists = true
    })

    await expect(
      Promise.all([
        ensureOffscreenDocumentReady(),
        ensureOffscreenDocumentReady(),
      ])
    ).resolves.toEqual([undefined, undefined])

    expect(sendMessage).toHaveBeenCalledTimes(2)
    expect(closeDocument).toHaveBeenCalledOnce()
    expect(createDocument).toHaveBeenCalledOnce()
  })

  it("does not close a new incarnation after observing an older failed document", async () => {
    let currentDocumentInstanceId = "document-old"
    let currentBrowserDocumentId = "browser-document-old"
    let releaseOldStatus!: () => void
    let signalOldStatusQueryStarted!: () => void
    const oldStatusQueryStarted = new Promise<void>((resolve) => {
      signalOldStatusQueryStarted = resolve
    })
    const oldStatusRelease = new Promise<void>((resolve) => {
      releaseOldStatus = resolve
    })

    hasDocument.mockResolvedValue(true)
    getContexts.mockImplementation(async () => [
      { documentId: currentBrowserDocumentId },
    ])
    sendMessage
      .mockImplementationOnce(async () => {
        signalOldStatusQueryStarted()
        await oldStatusRelease
        return {
          success: true,
          initializationState: "failed",
          documentInstanceId: "document-old",
          activeJobCount: 0,
          activeSeriesResolutionCount: 0,
          activeTaskIds: [],
        }
      })
      .mockImplementation(async () => ({
        success: true,
        initializationState: "ready",
        documentInstanceId: currentDocumentInstanceId,
        activeJobCount: 0,
        activeSeriesResolutionCount: 0,
        activeTaskIds: [],
      }))
    const closedDocumentInstanceIds: string[] = []
    closeDocument.mockImplementation(async () => {
      closedDocumentInstanceIds.push(currentDocumentInstanceId)
    })

    const ensuring = ensureOffscreenDocumentReady()
    await oldStatusQueryStarted
    currentDocumentInstanceId = "document-replacement"
    currentBrowserDocumentId = "browser-document-replacement"
    releaseOldStatus()

    await expect(ensuring).rejects.toThrow(
      "Offscreen document changed during failed-document replacement"
    )
    expect(closedDocumentInstanceIds).toEqual([])
    expect(createDocument).not.toHaveBeenCalled()
  })

  it("maps the exact offscreen initialization state", async () => {
    hasDocument.mockResolvedValue(true)
    sendMessage.mockResolvedValue({
      success: true,
      initializationState: "failed",
      documentInstanceId: "document-1",
      activeJobCount: 0,
      activeSeriesResolutionCount: 0,
      activeTaskIds: [],
    })

    await expect(queryOffscreenStatus()).resolves.toEqual({
      initializationState: "failed",
      documentInstanceId: "document-1",
      activeJobCount: 0,
      activeSeriesResolutionCount: 0,
      activeTaskIds: [],
    })
  })

  it("queries an exact retained offscreen job identity", async () => {
    const identity = {
      jobId: "job-old",
      attempt: 1,
      taskId: "task-1",
      chapterId: "chapter-1",
      fingerprint: "a".repeat(64),
      documentInstanceId: "document-1",
    }
    hasDocument.mockResolvedValue(true)
    sendMessage.mockImplementationOnce(async (message) => ({
      success: true,
      requestId: message.payload.requestId,
      job: {
        ...identity,
        status: "canceled",
        stage: "saving",
        lastSequence: 4,
      },
    }))

    await expect(queryOffscreenJob(identity)).resolves.toMatchObject({
      ...identity,
      status: "canceled",
    })
    expect(sendMessage).toHaveBeenCalledWith({
      target: "offscreen",
      type: "OFFSCREEN_QUERY_JOB",
      payload: {
        requestId: expect.any(String),
        identity,
      },
    })
  })

  it("surfaces creation failures and allows a later retry", async () => {
    hasDocument.mockResolvedValue(false)
    createDocument
      .mockRejectedValueOnce(new Error("offscreen create failed"))
      .mockResolvedValueOnce(undefined)

    await expect(ensureOffscreenDocumentReady()).rejects.toThrow(
      "offscreen create failed"
    )
    await expect(ensureOffscreenDocumentReady()).resolves.toBeUndefined()

    expect(createDocument).toHaveBeenCalledTimes(2)
  })

  it("does not arm the liveness alarm for native-download-only work", async () => {
    const queueRepository = {
      getQueue: vi.fn(async () => []),
      getActiveDispatchLease: vi.fn(async () => null),
    }

    await refreshLivenessAlarmForDurableWork(
      queueRepository as never,
      {
        getLiveTaskIds: vi.fn(async () => []),
        hasLiveDependencies: vi.fn(async () => false),
      } as never
    )

    expect(chrome.alarms.create).not.toHaveBeenCalled()
    expect(chrome.alarms.clear).toHaveBeenCalled()
  })

  it("keeps the liveness alarm armed while a native manifest dependency is unresolved", async () => {
    const queueRepository = {
      getQueue: vi.fn(async () => []),
      getActiveDispatchLease: vi.fn(async () => null),
    }

    await refreshLivenessAlarmForDurableWork(
      queueRepository as never,
      {
        getLiveTaskIds: vi.fn(async () => []),
        hasLiveDependencies: vi.fn(async () => true),
      } as never
    )

    expect(chrome.alarms.create).toHaveBeenCalled()
    expect(chrome.alarms.clear).not.toHaveBeenCalled()
  })

  it("does not treat a hasDocument failure as proof that no offscreen document exists", async () => {
    hasDocument.mockRejectedValueOnce(new Error("presence query failed"))

    await expect(ensureOffscreenDocumentReady()).rejects.toThrow(
      "presence query failed"
    )
    expect(createDocument).not.toHaveBeenCalled()
  })
})

describe("scheduleOffscreenCloseIfIdle", () => {
  const getContexts = vi.fn()
  const hasDocument = vi.fn()
  const createDocument = vi.fn()
  const sendMessage = vi.fn()
  const closeDocument = vi.fn()
  const getURL = vi.fn(() => "chrome-extension://test/offscreen.html")
  const queueRepository = {
    getActiveDispatchLease: vi.fn(async () => null),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    getContexts.mockResolvedValue([{ documentId: "offscreen-document" }])

    vi.stubGlobal("chrome", {
      runtime: {
        getURL,
        getContexts,
        sendMessage,
      },
      offscreen: {
        hasDocument,
        createDocument,
        closeDocument,
        Reason: {
          BLOBS: "BLOBS",
          WORKERS: "WORKERS",
          DOM_PARSER: "DOM_PARSER",
        },
      },
      alarms: {
        get: vi.fn(async () => undefined),
        clear: vi.fn(async () => true),
        create: vi.fn(async () => undefined),
      },
      storage: {
        local: { get: vi.fn(async () => ({})) },
      },
    })
  })

  it("does not close the offscreen document while native output dependencies remain", async () => {
    hasDocument.mockResolvedValue(true)
    sendMessage.mockResolvedValue({
      success: true,
      initializationState: "ready",
      documentInstanceId: "document-1",
      activeJobCount: 0,
      activeSeriesResolutionCount: 0,
      activeTaskIds: [],
    })

    const nativeOutputCoordinator = {
      hasLiveDependencies: vi.fn(async () => true),
    }

    await scheduleOffscreenCloseIfIdle(
      queueRepository as never,
      nativeOutputCoordinator as never
    )

    expect(closeDocument).not.toHaveBeenCalled()
  })

  it("closes the offscreen document when no runtime or native work remains", async () => {
    hasDocument.mockResolvedValue(true)
    sendMessage.mockResolvedValue({
      success: true,
      initializationState: "ready",
      documentInstanceId: "document-1",
      activeJobCount: 0,
      activeSeriesResolutionCount: 0,
      activeTaskIds: [],
    })

    const nativeOutputCoordinator = {
      hasLiveDependencies: vi.fn(async () => false),
    }

    await scheduleOffscreenCloseIfIdle(
      queueRepository as never,
      nativeOutputCoordinator as never
    )

    expect(closeDocument).toHaveBeenCalledTimes(1)
  })

  it.each(["download admission", "series resolution"])(
    "serializes a zero-activity idle snapshot before a %s",
    async () => {
      let currentDocumentInstanceId: string | null = "document-old"
      let currentBrowserDocumentId: string | null = "browser-document-old"
      let activeJobCount = 0
      let activeSeriesResolutionCount = 0
      let releaseNativeDependencyCheck!: (hasDependencies: boolean) => void
      const nativeDependencyCheck = new Promise<boolean>((resolve) => {
        releaseNativeDependencyCheck = resolve
      })

      hasDocument.mockImplementation(
        async () => currentDocumentInstanceId !== null
      )
      getContexts.mockImplementation(async () =>
        currentBrowserDocumentId === null
          ? []
          : [{ documentId: currentBrowserDocumentId }]
      )
      sendMessage.mockImplementation(async () => ({
        success: true,
        initializationState: "ready",
        documentInstanceId: currentDocumentInstanceId,
        activeJobCount,
        activeSeriesResolutionCount,
        activeTaskIds: activeJobCount === 0 ? [] : ["admitted-download-task"],
      }))
      const closedDocumentInstanceIds: string[] = []
      closeDocument.mockImplementation(async () => {
        if (currentDocumentInstanceId !== null) {
          closedDocumentInstanceIds.push(currentDocumentInstanceId)
        }
        currentDocumentInstanceId = null
        currentBrowserDocumentId = null
      })
      createDocument.mockImplementation(async () => {
        currentDocumentInstanceId = "document-replacement"
        currentBrowserDocumentId = "browser-document-replacement"
      })
      const nativeOutputCoordinator = {
        hasLiveDependencies: vi.fn(async () => await nativeDependencyCheck),
      }

      const idleClose = scheduleOffscreenCloseIfIdle(
        queueRepository as never,
        nativeOutputCoordinator as never
      )
      await vi.waitFor(() =>
        expect(nativeOutputCoordinator.hasLiveDependencies).toHaveBeenCalled()
      )

      let admittedDocumentInstanceId: string | null = null
      const admission = runOffscreenDocumentAdmissionExclusive(async () => {
        admittedDocumentInstanceId = currentDocumentInstanceId
        activeJobCount = 1
        activeSeriesResolutionCount = 1
      })
      await Promise.resolve()
      expect(admittedDocumentInstanceId).toBeNull()

      releaseNativeDependencyCheck(false)
      await Promise.all([idleClose, admission])

      expect(closedDocumentInstanceIds).toEqual(["document-old"])
      expect(admittedDocumentInstanceId).toBe("document-replacement")
      expect(currentDocumentInstanceId).toBe("document-replacement")
    }
  )

  it("does not close while a series resolution is active", async () => {
    hasDocument.mockResolvedValue(true)
    sendMessage.mockResolvedValue({
      success: true,
      initializationState: "ready",
      documentInstanceId: "document-1",
      activeJobCount: 0,
      activeSeriesResolutionCount: 1,
      activeTaskIds: [],
    })

    const nativeOutputCoordinator = {
      hasLiveDependencies: vi.fn(async () => false),
    }

    await scheduleOffscreenCloseIfIdle(
      queueRepository as never,
      nativeOutputCoordinator as never
    )

    expect(closeDocument).not.toHaveBeenCalled()
  })

  it("retains an idle offscreen owner while native cleanup is unresolved", async () => {
    hasDocument.mockResolvedValue(true)
    sendMessage.mockResolvedValue({
      success: true,
      initializationState: "ready",
      documentInstanceId: "document-1",
      activeJobCount: 0,
      activeSeriesResolutionCount: 0,
      activeTaskIds: [],
    })

    const nativeOutputCoordinator = {
      hasLiveDependencies: vi.fn(async () => true),
    }

    await scheduleOffscreenCloseIfIdle(
      queueRepository as never,
      nativeOutputCoordinator as never
    )

    expect(closeDocument).not.toHaveBeenCalled()
  })

  it("does not let an idle close tear down a replacement created by ensure", async () => {
    let currentDocumentInstanceId: string | null = "document-old"
    let currentBrowserDocumentId: string | null = "browser-document-old"
    let statusQueryCount = 0
    let releaseNativeDependencyCheck!: (hasDependencies: boolean) => void
    const nativeDependencyCheck = new Promise<boolean>((resolve) => {
      releaseNativeDependencyCheck = resolve
    })

    hasDocument.mockImplementation(
      async () => currentDocumentInstanceId !== null
    )
    getContexts.mockImplementation(async () =>
      currentBrowserDocumentId === null
        ? []
        : [{ documentId: currentBrowserDocumentId }]
    )
    sendMessage.mockImplementation(async () => {
      statusQueryCount += 1
      return {
        success: true,
        initializationState:
          statusQueryCount === 1
            ? "ready"
            : currentDocumentInstanceId === "document-old"
              ? "failed"
              : "ready",
        documentInstanceId: currentDocumentInstanceId,
        activeJobCount: 0,
        activeSeriesResolutionCount: 0,
        activeTaskIds: [],
      }
    })
    const closedDocumentInstanceIds: string[] = []
    closeDocument.mockImplementation(async () => {
      if (currentDocumentInstanceId !== null) {
        closedDocumentInstanceIds.push(currentDocumentInstanceId)
      }
      currentDocumentInstanceId = null
      currentBrowserDocumentId = null
    })
    createDocument.mockImplementation(async () => {
      currentDocumentInstanceId = "document-replacement"
      currentBrowserDocumentId = "browser-document-replacement"
    })
    const nativeOutputCoordinator = {
      hasLiveDependencies: vi.fn(async () => await nativeDependencyCheck),
    }

    const idleClose = scheduleOffscreenCloseIfIdle(
      queueRepository as never,
      nativeOutputCoordinator as never
    )
    await vi.waitFor(() => {
      expect(nativeOutputCoordinator.hasLiveDependencies).toHaveBeenCalledOnce()
    })
    const replacementEnsure = ensureOffscreenDocumentReady()
    await Promise.resolve()
    expect(closedDocumentInstanceIds).toEqual([])

    releaseNativeDependencyCheck(false)
    await Promise.all([idleClose, replacementEnsure])

    expect(closedDocumentInstanceIds).toEqual(["document-old"])
    expect(currentDocumentInstanceId).toBe("document-replacement")
  })
})
