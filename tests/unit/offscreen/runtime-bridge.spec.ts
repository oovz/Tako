import { beforeEach, describe, expect, it, vi } from "vitest"

import { registerOffscreenRuntime } from "@/entrypoints/offscreen/runtime-bridge"

const loggerMocks = vi.hoisted(() => ({
  debug: vi.fn(),
  error: vi.fn(),
}))

vi.mock("@/src/runtime/logger", () => ({
  default: {
    debug: loggerMocks.debug,
    info: vi.fn(),
    warn: vi.fn(),
    error: loggerMocks.error,
  },
}))

describe("registerOffscreenRuntime", () => {
  const addListener = vi.fn()
  const runtimeOptions = {
    onInitialized: vi.fn(),
    onInitializationError: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()

    vi.stubGlobal("chrome", {
      runtime: {
        onMessage: {
          addListener,
        },
      },
    } as unknown as typeof chrome)
  })

  it("does not claim unowned messages while initialization is pending", () => {
    let resolveInitialize!: () => void
    const worker = {
      initialize: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveInitialize = resolve
          })
      ),
      processDownloadChapter: vi.fn(),
      parseSeriesHtml: vi.fn(),
      cancelTask: vi.fn(() => true),
      cancelJob: vi.fn(() => true),
      getCurrentJobState: vi.fn(() => null),
      getActiveJobCount: vi.fn(() => 0),
      getActiveTaskIds: vi.fn(() => []),
    }

    registerOffscreenRuntime(worker, runtimeOptions)

    const listener = addListener.mock.calls[0]?.[0] as (
      message: { type: string; payload?: unknown },
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: { success: boolean; error?: string }) => void
    ) => boolean

    const sendResponse = vi.fn()
    const handled = listener(
      { type: "GET_SETTINGS" },
      {} as chrome.runtime.MessageSender,
      sendResponse
    )

    expect(handled).toBe(false)
    expect(sendResponse).not.toHaveBeenCalled()

    resolveInitialize()
  })

  it("reports lifecycle status while initialization is pending", () => {
    const worker = {
      initialize: vi.fn(() => new Promise<void>(() => undefined)),
      processDownloadChapter: vi.fn(),
      parseSeriesHtml: vi.fn(),
      cancelTask: vi.fn(() => true),
      cancelJob: vi.fn(() => true),
      getCurrentJobState: vi.fn(() => null),
      getActiveJobCount: vi.fn(() => 0),
      getActiveTaskIds: vi.fn(() => []),
    }

    registerOffscreenRuntime(worker, runtimeOptions)

    const listener = addListener.mock.calls[0]?.[0] as (
      message: { type: string },
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: unknown) => void
    ) => boolean
    const sendResponse = vi.fn()

    expect(
      listener(
        { type: "OFFSCREEN_STATUS" },
        {} as chrome.runtime.MessageSender,
        sendResponse
      )
    ).toBe(true)
    expect(sendResponse).toHaveBeenCalledWith({
      success: true,
      isInitialized: false,
      activeJobCount: 0,
      activeTaskIds: [],
    })
  })

  it("rejects malformed OFFSCREEN_CONTROL messages instead of treating them as successful no-ops", async () => {
    const worker = {
      initialize: vi.fn(async () => undefined),
      processDownloadChapter: vi.fn(),
      parseSeriesHtml: vi.fn(),
      cancelTask: vi.fn(() => true),
      cancelJob: vi.fn(() => true),
      getCurrentJobState: vi.fn(() => null),
      getActiveJobCount: vi.fn(() => 0),
      getActiveTaskIds: vi.fn(() => []),
    }

    registerOffscreenRuntime(worker, runtimeOptions)
    await Promise.resolve()

    const listener = addListener.mock.calls[0]?.[0] as (
      message: { type: string; payload?: unknown },
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: { success: boolean; error?: string }) => void
    ) => boolean

    const sendResponse = vi.fn()
    const handled = listener(
      {
        type: "OFFSCREEN_CONTROL",
        payload: { taskId: "", action: "cancel" },
      },
      {} as chrome.runtime.MessageSender,
      sendResponse
    )

    expect(handled).toBe(true)
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: "Invalid OFFSCREEN_CONTROL payload",
    })
    expect(worker.cancelTask).not.toHaveBeenCalled()
  })

  it("rejects malformed REVOKE_BLOB_URL messages before touching URL.revokeObjectURL", async () => {
    const worker = {
      initialize: vi.fn(async () => undefined),
      processDownloadChapter: vi.fn(),
      parseSeriesHtml: vi.fn(),
      cancelTask: vi.fn(() => true),
      cancelJob: vi.fn(() => true),
      getCurrentJobState: vi.fn(() => null),
      getActiveJobCount: vi.fn(() => 0),
      getActiveTaskIds: vi.fn(() => []),
    }
    const revokeObjectURL = vi.fn()
    vi.stubGlobal("URL", {
      revokeObjectURL,
    } as unknown as typeof URL)

    registerOffscreenRuntime(worker, runtimeOptions)
    await Promise.resolve()

    const listener = addListener.mock.calls[0]?.[0] as (
      message: { type: string; payload?: unknown },
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: { success: boolean; error?: string }) => void
    ) => boolean

    const sendResponse = vi.fn()
    const handled = listener(
      {
        type: "REVOKE_BLOB_URL",
        payload: { blobUrl: "" },
      },
      {} as chrome.runtime.MessageSender,
      sendResponse
    )

    expect(handled).toBe(true)
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: "Invalid REVOKE_BLOB_URL payload",
    })
    expect(revokeObjectURL).not.toHaveBeenCalled()
  })

  it("reports deterministic active task identities in OFFSCREEN_STATUS", async () => {
    const worker = {
      initialize: vi.fn(async () => undefined),
      processDownloadChapter: vi.fn(),
      parseSeriesHtml: vi.fn(),
      cancelTask: vi.fn(() => true),
      cancelJob: vi.fn(() => true),
      getCurrentJobState: vi.fn(() => null),
      getActiveJobCount: vi.fn(() => 2),
      getActiveTaskIds: vi.fn(() => ["task-z", "task-a"]),
    }

    registerOffscreenRuntime(worker, runtimeOptions)
    await Promise.resolve()

    const listener = addListener.mock.calls[0]?.[0] as (
      message: { type: string },
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: unknown) => void
    ) => boolean
    const sendResponse = vi.fn()

    expect(
      listener(
        { type: "OFFSCREEN_STATUS" },
        {} as chrome.runtime.MessageSender,
        sendResponse
      )
    ).toBe(true)
    expect(sendResponse).toHaveBeenCalledWith({
      success: true,
      isInitialized: true,
      activeJobCount: 2,
      activeTaskIds: ["task-a", "task-z"],
    })
  })

  it("rejects missing initialization callbacks before registering listeners", () => {
    const worker = {
      initialize: vi.fn(async () => undefined),
      processDownloadChapter: vi.fn(),
      parseSeriesHtml: vi.fn(),
      cancelTask: vi.fn(() => true),
      cancelJob: vi.fn(() => true),
      getCurrentJobState: vi.fn(() => null),
      getActiveJobCount: vi.fn(() => 0),
      getActiveTaskIds: vi.fn(() => []),
    }

    expect(() => registerOffscreenRuntime(worker, {} as never)).toThrowError(
      "registerOffscreenRuntime requires initialization callbacks"
    )
    expect(addListener).not.toHaveBeenCalled()
    expect(worker.initialize).not.toHaveBeenCalled()
  })
})
