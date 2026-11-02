import { afterEach, describe, expect, it, vi } from "vitest"

import {
  E2E_SEED_DOWNLOAD_QUEUE_MESSAGE,
  E2E_SEED_TAB_CONTEXT_MESSAGE,
  registerE2EStateSeedListener,
} from "@/entrypoints/background/e2e-state-seed"
import { TabContextStateService } from "@/entrypoints/background/tab-context-state-service"
import { setEnablementMap, isEnabled } from "@/src/site-integrations/catalog"
import { HistoryRepository } from "@/src/storage/history-repository"
import { QueueProjectionService } from "@/src/storage/queue-projection-service"
import { QueueRepository } from "@/src/storage/queue-repository"
import { LOCAL_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import type { ResolvedTabReadyContext } from "@/src/types/resolved-tab-context"

type SeedListener = Parameters<typeof chrome.runtime.onMessage.addListener>[0]

const sender = {
  id: "extension-id",
  url: "chrome-extension://extension-id/options.html",
}
const context: ResolvedTabReadyContext = {
  context: "ready",
  sourceUrl: "https://mangadex.org/title/series",
  siteIntegrationId: "mangadex",
  mangaId: "series",
  seriesTitle: "Series",
  chapters: [],
}
const queueRequest = {
  target: "e2e",
  type: E2E_SEED_DOWNLOAD_QUEUE_MESSAGE,
  payload: { downloadQueue: [] },
}
const tabRequest = {
  target: "e2e",
  type: E2E_SEED_TAB_CONTEXT_MESSAGE,
  payload: { tabId: 0, context },
}

function setup() {
  const addListener = vi.fn<(listener: SeedListener) => void>()
  const ensureRuntimeReady = vi.fn<() => Promise<void>>(async () => undefined)
  const setAll = vi.fn(async () => undefined)
  const write = vi.fn(async () => undefined)
  const getTab = vi.fn<() => Promise<Partial<chrome.tabs.Tab>>>(async () => ({
    id: 0,
    active: true,
    windowId: 3,
    url: context.sourceUrl,
  }))
  vi.stubGlobal("chrome", {
    runtime: { id: sender.id, onMessage: { addListener } },
    storage: { local: { set: write } },
    tabs: { get: getTab },
  })
  const queueRepository = new QueueRepository(
    new QueueProjectionService(),
    new HistoryRepository()
  )
  const initialize = vi.spyOn(queueRepository, "initialize").mockResolvedValue()
  const service = new TabContextStateService()
  const commit = vi
    .spyOn(service, "commitResolvedTabContext")
    .mockResolvedValue({ success: true })
  const cancel = vi.fn()
  registerE2EStateSeedListener({
    ensureRuntimeReady,
    queueRepository,
    siteIntegrationEnablementService: { setAll },
    getTabContextStateService: () => service,
    cancelTabContextResolution: cancel,
  })
  const listener = addListener.mock.calls[0][0]
  function dispatch(message: unknown, source = sender) {
    const response = vi.fn<(value: unknown) => void>()
    const accepted = listener(message, source, response)
    return { accepted, response }
  }
  return {
    dispatch,
    ensureRuntimeReady,
    setAll,
    write,
    initialize,
    getTab,
    commit,
    cancel,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  setEnablementMap({})
})

describe("isolated E2E seed request boundary", () => {
  it.each([null, 1, "e2e", {}, { target: "background" }])(
    "leaves unrelated messages unanswered: %j",
    (message) => {
      const fixture = setup()
      const result = fixture.dispatch(message)
      expect(result.accepted).toBe(false)
      expect(result.response).not.toHaveBeenCalled()
      expect(fixture.ensureRuntimeReady).not.toHaveBeenCalled()
    }
  )

  it.each([
    { type: "UNKNOWN", payload: {} },
    { type: E2E_SEED_DOWNLOAD_QUEUE_MESSAGE },
    { type: E2E_SEED_DOWNLOAD_QUEUE_MESSAGE, payload: { downloadQueue: {} } },
    {
      type: E2E_SEED_DOWNLOAD_QUEUE_MESSAGE,
      payload: { downloadQueue: [], siteIntegrationEnablement: null },
    },
    {
      type: E2E_SEED_DOWNLOAD_QUEUE_MESSAGE,
      payload: { downloadQueue: [], siteIntegrationEnablement: [] },
    },
    { type: E2E_SEED_TAB_CONTEXT_MESSAGE, payload: { tabId: -1, context } },
    { type: E2E_SEED_TAB_CONTEXT_MESSAGE, payload: { tabId: 0.5, context } },
    { type: E2E_SEED_TAB_CONTEXT_MESSAGE, payload: { tabId: "0", context } },
    {
      type: E2E_SEED_TAB_CONTEXT_MESSAGE,
      payload: { tabId: 0, context: { context: "unsupported" } },
    },
  ])("rejects malformed seed requests before readiness: %j", (message) => {
    const fixture = setup()
    const result = fixture.dispatch({ target: "e2e", ...message })
    expect(result.accepted).toBe(true)
    expect(result.response).toHaveBeenCalledExactlyOnceWith({
      success: false,
      error: "Invalid E2E seed request",
    })
    expect(fixture.ensureRuntimeReady).not.toHaveBeenCalled()
    expect(fixture.write).not.toHaveBeenCalled()
  })

  it("waits for readiness and persists enablement before queue hydration", async () => {
    const fixture = setup()
    setEnablementMap({ mangadex: true })
    const ready = Promise.withResolvers<void>()
    const stored = Promise.withResolvers<void>()
    fixture.ensureRuntimeReady.mockReturnValue(ready.promise)
    fixture.setAll.mockImplementation(async () => {
      expect(fixture.write).not.toHaveBeenCalled()
      expect(isEnabled("mangadex")).toBe(true)
    })
    fixture.write.mockImplementation(async () => {
      expect(isEnabled("mangadex")).toBe(false)
      await stored.promise
    })
    const request = {
      ...queueRequest,
      payload: {
        downloadQueue: [],
        siteIntegrationEnablement: { mangadex: false },
      },
    }
    const result = fixture.dispatch(request)
    expect(result.accepted).toBe(true)
    expect(fixture.setAll).not.toHaveBeenCalled()
    expect(fixture.write).not.toHaveBeenCalled()
    ready.resolve()
    await vi.waitFor(() => expect(fixture.write).toHaveBeenCalledOnce())
    expect(fixture.setAll).toHaveBeenCalledExactlyOnceWith({ mangadex: false })
    expect(fixture.write).toHaveBeenCalledWith({
      [LOCAL_STORAGE_KEYS.downloadQueue]: [],
    })
    expect(fixture.initialize).not.toHaveBeenCalled()
    expect(result.response).not.toHaveBeenCalled()
    stored.resolve()
    await vi.waitFor(() =>
      expect(result.response).toHaveBeenCalledExactlyOnceWith({ success: true })
    )
    expect(fixture.initialize).toHaveBeenCalledOnce()
  })

  it("seeds a queue without changing the existing enablement profile", async () => {
    const fixture = setup()
    setEnablementMap({ mangadex: true })
    const result = fixture.dispatch(queueRequest)
    await vi.waitFor(() =>
      expect(result.response).toHaveBeenCalledExactlyOnceWith({ success: true })
    )
    expect(fixture.setAll).not.toHaveBeenCalled()
    expect(isEnabled("mangadex")).toBe(true)
  })

  it.each([new Error("storage unavailable"), "storage unavailable"])(
    "reports a failed queue write without hydrating the queue: %s",
    async (error) => {
      const fixture = setup()
      fixture.write.mockRejectedValue(error)
      const result = fixture.dispatch(queueRequest)
      await vi.waitFor(() =>
        expect(result.response).toHaveBeenCalledExactlyOnceWith({
          success: false,
          error: "storage unavailable",
        })
      )
      expect(fixture.initialize).not.toHaveBeenCalled()
    }
  )

  it.each([
    { active: false },
    { windowId: undefined },
    { url: "https://mangadex.org/title/different" },
    { url: "", pendingUrl: context.sourceUrl },
  ])(
    "rejects a stale tab target before canceling its resolver: %j",
    async (changes) => {
      const fixture = setup()
      fixture.getTab.mockResolvedValue({
        id: 0,
        active: true,
        windowId: 3,
        url: context.sourceUrl,
        ...changes,
      })
      const result = fixture.dispatch(tabRequest)
      await vi.waitFor(() =>
        expect(result.response).toHaveBeenCalledExactlyOnceWith({
          success: false,
          error: "E2E tab context target is not the active source page",
        })
      )
      expect(fixture.cancel).not.toHaveBeenCalled()
      expect(fixture.commit).not.toHaveBeenCalled()
    }
  )

  it("uses a pending tab URL and fences the resolver on both sides of the commit", async () => {
    const fixture = setup()
    fixture.getTab.mockResolvedValue({
      id: 0,
      active: true,
      windowId: 3,
      url: undefined,
      pendingUrl: context.sourceUrl,
    })
    fixture.commit.mockImplementation(async () => {
      expect(fixture.cancel).toHaveBeenCalledExactlyOnceWith(0)
      return { success: true }
    })
    const result = fixture.dispatch(tabRequest)
    await vi.waitFor(() =>
      expect(result.response).toHaveBeenCalledExactlyOnceWith({ success: true })
    )
    expect(fixture.ensureRuntimeReady).toHaveBeenCalledOnce()
    expect(fixture.cancel).toHaveBeenCalledTimes(2)
    expect(fixture.commit).toHaveBeenCalledExactlyOnceWith(context, 0, {
      windowId: 3,
      expectedUrl: context.sourceUrl,
      supersedeInFlight: true,
    })
  })

  it("reports a rejected context commit without claiming a successful seed", async () => {
    const fixture = setup()
    fixture.commit.mockResolvedValue({ success: false })
    const result = fixture.dispatch(tabRequest)
    await vi.waitFor(() =>
      expect(result.response).toHaveBeenCalledExactlyOnceWith({
        success: false,
        error: "E2E tab context seed was rejected",
      })
    )
    expect(fixture.cancel).toHaveBeenCalledExactlyOnceWith(0)
  })
})
