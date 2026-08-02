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
  ensureOffscreenDocumentReady,
  refreshLivenessAlarmForDurableWork,
  scheduleOffscreenCloseIfIdle,
} from "@/entrypoints/background/offscreen-lifecycle"

afterEach(() => {
  vi.useRealTimers()
})

describe("ensureOffscreenDocumentReady", () => {
  const getContexts = vi.fn()
  const hasDocument = vi.fn()
  const createDocument = vi.fn()
  const getURL = vi.fn(() => "chrome-extension://test/offscreen.html")

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()

    vi.stubGlobal("chrome", {
      runtime: {
        getURL,
        getContexts,
      },
      offscreen: {
        hasDocument,
        createDocument,
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

  it("reuses an existing offscreen document without polling readiness", async () => {
    hasDocument.mockResolvedValue(true)

    await ensureOffscreenDocumentReady()

    expect(createDocument).not.toHaveBeenCalled()
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
    const manager = {
      getGlobalState: vi.fn(async () => ({ downloadQueue: [] })),
    }

    await refreshLivenessAlarmForDurableWork(manager as never)

    expect(chrome.alarms.create).not.toHaveBeenCalled()
    expect(chrome.alarms.clear).toHaveBeenCalled()
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

  beforeEach(() => {
    vi.clearAllMocks()

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
        },
      },
      storage: {
        local: { get: vi.fn(async () => ({})) },
      },
    })
  })

  it("does not close the offscreen document when pending native downloads still exist", async () => {
    hasDocument.mockResolvedValue(true)
    sendMessage.mockResolvedValue({
      success: true,
      isInitialized: true,
      activeJobCount: 0,
      activeTaskIds: [],
    })

    const pendingDownloadsStore = {
      hasBlobDependencies: vi.fn(() => true),
    }

    await scheduleOffscreenCloseIfIdle(pendingDownloadsStore as never)

    expect(closeDocument).not.toHaveBeenCalled()
  })

  it("closes the offscreen document when there are no active jobs and no pending native downloads", async () => {
    hasDocument.mockResolvedValue(true)
    sendMessage.mockResolvedValue({
      success: true,
      isInitialized: true,
      activeJobCount: 0,
      activeTaskIds: [],
    })

    const pendingDownloadsStore = {
      hasBlobDependencies: vi.fn(() => false),
    }

    await scheduleOffscreenCloseIfIdle(pendingDownloadsStore as never)

    expect(closeDocument).toHaveBeenCalledTimes(1)
  })
})
