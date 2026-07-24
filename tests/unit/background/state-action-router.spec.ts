import { beforeEach, describe, expect, it, vi } from "vitest"

function mockRouterDependencies(): void {
  vi.doMock("@/src/runtime/logger", () => ({
    default: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  }))

  vi.doMock(
    "@/entrypoints/background/action-handlers/tab-state-handlers",
    () => ({
      handleInitializeTab: vi.fn(async () => ({ success: true })),
      handleClearTabState: vi.fn(async () => ({ success: true })),
    })
  )

  vi.doMock(
    "@/entrypoints/background/action-handlers/download-task-handlers",
    () => ({
      handleRemoveDownloadTask: vi.fn(async () => ({ success: true })),
      handleCancelDownloadTask: vi.fn(async () => ({ success: true })),
      handleRetryDestinationTask: vi.fn(async () => ({ success: true })),
      handleContinueTaskInDownloads: vi.fn(async () => ({ success: true })),
    })
  )
}

describe("createStateManager", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it("returns the same initialized manager across repeated calls", async () => {
    const instances: Array<{ initialize: ReturnType<typeof vi.fn> }> = []

    class MockCentralizedStateManager {
      initialize = vi.fn(async () => undefined)

      constructor() {
        instances.push(this)
      }
    }

    mockRouterDependencies()
    vi.doMock("@/src/runtime/centralized-state", () => ({
      CentralizedStateManager: MockCentralizedStateManager,
    }))

    const { createStateManager } =
      await import("@/entrypoints/background/state-action-router")

    const [first, second, third] = await Promise.all([
      createStateManager(),
      createStateManager(),
      createStateManager(),
    ])

    expect(first).toBe(second)
    expect(second).toBe(third)
    expect(instances).toHaveLength(1)
    expect(instances[0]?.initialize).toHaveBeenCalledTimes(1)
  })

  it("retries initialization after a failed createStateManager call", async () => {
    const instances: Array<{ initialize: ReturnType<typeof vi.fn> }> = []
    let initializeAttempts = 0

    class MockCentralizedStateManager {
      initialize = vi.fn(async () => {
        initializeAttempts += 1
        if (initializeAttempts === 1) {
          throw new Error("initialize failed")
        }
      })

      constructor() {
        instances.push(this)
      }
    }

    mockRouterDependencies()
    vi.doMock("@/src/runtime/centralized-state", () => ({
      CentralizedStateManager: MockCentralizedStateManager,
    }))

    const { createStateManager } =
      await import("@/entrypoints/background/state-action-router")

    await expect(createStateManager()).rejects.toThrow("initialize failed")

    const recovered = await createStateManager()

    expect(recovered).toBe(instances[1])
    expect(instances).toHaveLength(2)
    expect(instances[0]?.initialize).toHaveBeenCalledTimes(1)
    expect(instances[1]?.initialize).toHaveBeenCalledTimes(1)
  })
})

describe("processStateAction sender authorization", () => {
  const extensionId = "abcdefghijklmnop"
  const stateManager = {} as never

  function contentScriptSender(
    tabId: number,
    overrides: Partial<chrome.runtime.MessageSender> = {}
  ): chrome.runtime.MessageSender {
    return {
      id: extensionId,
      tab: { id: tabId } as chrome.tabs.Tab,
      frameId: 0,
      url: "https://mangadex.org/title/series-1",
      documentId: "document-current",
      documentLifecycle: "active",
      ...overrides,
    }
  }

  function extensionPageSender(page: string): chrome.runtime.MessageSender {
    return {
      id: extensionId,
      url: `chrome-extension://${extensionId}/${page}`,
    }
  }

  async function loadRouter() {
    mockRouterDependencies()

    vi.stubGlobal("chrome", {
      runtime: { id: extensionId },
    })

    const router = await import("@/entrypoints/background/state-action-router")
    const tabHandlers =
      await import("@/entrypoints/background/action-handlers/tab-state-handlers")
    const taskHandlers =
      await import("@/entrypoints/background/action-handlers/download-task-handlers")

    return { ...router, tabHandlers, taskHandlers }
  }

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it("rejects content-script state actions", async () => {
    const { processStateAction, tabHandlers } = await loadRouter()

    const result = await processStateAction(
      stateManager,
      {
        type: "STATE_ACTION",
        action: 1,
        tabId: 42,
      },
      contentScriptSender(42)
    )

    expect(result).toEqual({
      success: false,
      error: "State actions are only accepted from extension pages",
    })
    expect(tabHandlers.handleClearTabState).not.toHaveBeenCalled()
  })

  it("allows a side panel to mutate an explicitly targeted tab", async () => {
    const { processStateAction, tabHandlers } = await loadRouter()

    const result = await processStateAction(
      stateManager,
      {
        type: "STATE_ACTION",
        action: 1,
        tabId: 73,
      },
      extensionPageSender("sidepanel.html")
    )

    expect(result).toEqual({ success: true })
    expect(tabHandlers.handleClearTabState).toHaveBeenCalledWith(
      stateManager,
      73
    )
  })

  it("allows the options page to manage download tasks", async () => {
    const { processStateAction, taskHandlers } = await loadRouter()

    const result = await processStateAction(
      stateManager,
      {
        type: "STATE_ACTION",
        action: 2,
        payload: { taskId: "task-1" },
      },
      extensionPageSender("options.html")
    )

    expect(result).toEqual({ success: true })
    expect(taskHandlers.handleRemoveDownloadTask).toHaveBeenCalledWith(
      stateManager,
      { taskId: "task-1" }
    )
  })

  it("rejects unknown fields in a state-action payload", async () => {
    const { processStateAction, taskHandlers } = await loadRouter()

    const result = await processStateAction(
      stateManager,
      {
        type: "STATE_ACTION",
        action: 2,
        payload: { taskId: "task-1", privileged: true },
      },
      extensionPageSender("options.html")
    )

    expect(result).toEqual({
      success: false,
      error: "Invalid payload for REMOVE_DOWNLOAD_TASK",
    })
    expect(taskHandlers.handleRemoveDownloadTask).not.toHaveBeenCalled()
  })

  it("rejects task management from a content script", async () => {
    const { processStateAction, taskHandlers } = await loadRouter()

    const result = await processStateAction(
      stateManager,
      {
        type: "STATE_ACTION",
        action: 2,
        payload: { taskId: "task-1" },
      },
      contentScriptSender(42)
    )

    expect(result).toEqual({
      success: false,
      error: "State actions are only accepted from extension pages",
    })
    expect(taskHandlers.handleRemoveDownloadTask).not.toHaveBeenCalled()
  })

  it("rejects offscreen and unknown runtime sender contexts", async () => {
    const { processStateAction, tabHandlers } = await loadRouter()
    const message = {
      type: "STATE_ACTION" as const,
      action: 1,
      tabId: 42,
    }

    await expect(
      processStateAction(stateManager, message, {
        id: extensionId,
        url: `chrome-extension://${extensionId}/offscreen.html`,
      })
    ).resolves.toEqual({
      success: false,
      error: "State actions are only accepted from extension pages",
    })
    await expect(
      processStateAction(stateManager, message, {})
    ).resolves.toEqual({
      success: false,
      error: "State actions are only accepted from extension pages",
    })
    expect(tabHandlers.handleClearTabState).not.toHaveBeenCalled()
  })

  it("preserves trusted direct background-origin actions", async () => {
    const { processStateAction, tabHandlers, taskHandlers } = await loadRouter()

    await expect(
      processStateAction(stateManager, {
        type: "STATE_ACTION",
        action: 1,
        tabId: 8,
      })
    ).resolves.toEqual({ success: true })
    await expect(
      processStateAction(stateManager, {
        type: "STATE_ACTION",
        action: 3,
        payload: { taskId: "task-8" },
      })
    ).resolves.toEqual({ success: true })

    expect(tabHandlers.handleClearTabState).toHaveBeenCalledWith(
      stateManager,
      8
    )
    expect(taskHandlers.handleCancelDownloadTask).toHaveBeenCalledWith(
      stateManager,
      { taskId: "task-8" }
    )
  })

  it.each([
    [4, "handleRetryDestinationTask"],
    [5, "handleContinueTaskInDownloads"],
  ] as const)(
    "routes destination recovery action %s from an extension page",
    async (action, handlerName) => {
      const { processStateAction, taskHandlers } = await loadRouter()

      const result = await processStateAction(
        stateManager,
        {
          type: "STATE_ACTION",
          action,
          payload: { taskId: "task-folder" },
        },
        extensionPageSender("options.html")
      )

      expect(result).toEqual({ success: true })
      expect(taskHandlers[handlerName]).toHaveBeenCalledWith(stateManager, {
        taskId: "task-folder",
      })
    }
  )
})
