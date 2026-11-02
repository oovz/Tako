import { beforeEach, describe, expect, it, vi } from "vitest"
import { createBackgroundOffscreenEventMessageHandlers } from "@/entrypoints/background/background-offscreen-event-message-handlers"
import { createBackgroundSettingsUiMessageHandlers } from "@/entrypoints/background/background-settings-ui-message-handlers"
import type { BackgroundRuntimeHandlerDependencies } from "@/entrypoints/background/background-runtime-handler-dependencies"
import type { QueueRepository } from "@/src/storage/queue-repository"
import { createDispatchLease } from "@/src/runtime/dispatch-lease"
import type { RuntimeMessageRequest } from "@/src/runtime/runtime-message-contracts"

const identity = {
  jobId: "job",
  taskId: "task",
  chapterId: "chapter",
  attempt: 1,
  fingerprint: "a".repeat(64),
  documentInstanceId: "producer",
}
const heartbeat = {
  target: "background",
  type: "OFFSCREEN_JOB_HEARTBEAT",
  payload: { ...identity, stage: "downloading", sequence: 2, sentAt: 200 },
} satisfies RuntimeMessageRequest<"OFFSCREEN_JOB_HEARTBEAT">
const lease = createDispatchLease({
  ...identity,
  saveMode: "downloads-api",
  now: 100,
})

describe("offscreen platform event authority", () => {
  let renewal: Awaited<ReturnType<QueueRepository["renewDispatchLease"]>>
  const renew = vi.fn(async () => renewal)
  const getTask = vi.fn(async () => ({
    status: "downloading",
    chapters: [{ id: "chapter", status: "downloading" }],
  }))
  const contexts = vi.fn(async (): Promise<unknown[]> => [
    { documentId: "current" },
  ])
  function handlers() {
    return createBackgroundOffscreenEventMessageHandlers({
      queueRepository: { renewDispatchLease: renew, getTask },
    } as unknown as BackgroundRuntimeHandlerDependencies)
  }
  beforeEach(() => {
    vi.clearAllMocks()
    renewal = { outcome: "applied", lease }
    contexts.mockResolvedValue([{ documentId: "current" }])
    vi.stubGlobal("chrome", {
      runtime: {
        getURL: (path: string) => `chrome-extension://test/${path}`,
        getContexts: contexts,
      },
    })
  })
  it.each([
    ["empty browser identity", ""],
    ["replaced browser document", "previous"],
  ])("rejects %s before renewing durable work", async (_label, documentId) => {
    const response = await handlers().OFFSCREEN_JOB_HEARTBEAT(heartbeat, {
      documentId,
    })
    expect(response).toEqual({
      success: true,
      disposition: "lease_not_current",
    })
    expect(renew).not.toHaveBeenCalled()
  })
  it("accepts a browser document only when the current offscreen context owns it", async () => {
    contexts.mockResolvedValue([
      null,
      "irrelevant",
      {},
      { documentId: "current" },
    ])
    expect(
      await handlers().OFFSCREEN_JOB_HEARTBEAT(heartbeat, {
        documentId: "current",
      })
    ).toEqual({ success: true, disposition: "renewed" })
    expect(renew).toHaveBeenCalledWith(
      expect.objectContaining({
        ...identity,
        activityAt: 200,
        stage: "downloading",
        sequence: 2,
      })
    )
  })
  it.each([
    ["stale-sequence", "stale_or_reordered"],
    ["lease-not-current", "lease_not_current"],
    ["sequence-conflict", "protocol_error"],
  ] as const)(
    "reports %s without acknowledging renewal",
    async (reason, disposition) => {
      renewal = { outcome: "rejected", reason }
      expect(await handlers().OFFSCREEN_JOB_HEARTBEAT(heartbeat, {})).toEqual({
        success: true,
        disposition,
      })
    }
  )
  it("acknowledges a duplicate event without renewing its sequence", async () => {
    renewal = { outcome: "unchanged", lease }
    expect(await handlers().OFFSCREEN_JOB_HEARTBEAT(heartbeat, {})).toEqual({
      success: true,
      disposition: "stale_or_reordered",
    })
  })
})

describe("options page routing", () => {
  const query = vi.fn()
  const update = vi.fn(async () => undefined)
  const create = vi.fn(async () => undefined)
  const focusWindow = vi.fn(async () => undefined)
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal("chrome", {
      runtime: { getURL: (path: string) => `chrome-extension://test/${path}` },
      tabs: { query, update, create },
      windows: { update: focusWindow },
    })
  })
  it("reuses the options tab and focuses its window when a section is requested", async () => {
    query.mockResolvedValue([{ id: 8, windowId: 4 }])
    const handlers = createBackgroundSettingsUiMessageHandlers(
      {} as BackgroundRuntimeHandlerDependencies
    )
    await handlers.OPEN_OPTIONS(
      {
        target: "background",
        type: "OPEN_OPTIONS",
        payload: { page: "storage" },
      },
      {}
    )
    expect(update).toHaveBeenCalledWith(8, {
      active: true,
      url: "chrome-extension://test/options.html?tab=storage",
    })
    expect(focusWindow).toHaveBeenCalledWith(4, { focused: true })
    expect(create).not.toHaveBeenCalled()
  })
  it("creates the default options page when no existing tab is available", async () => {
    query.mockResolvedValue([])
    const handlers = createBackgroundSettingsUiMessageHandlers(
      {} as BackgroundRuntimeHandlerDependencies
    )
    await handlers.OPEN_OPTIONS(
      { target: "background", type: "OPEN_OPTIONS", payload: {} },
      {}
    )
    expect(create).toHaveBeenCalledWith({
      url: "chrome-extension://test/options.html",
      active: true,
    })
    expect(update).not.toHaveBeenCalled()
  })
})
