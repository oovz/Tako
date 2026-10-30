import { afterEach, describe, expect, it, vi } from "vitest"
import { createBackgroundCoverPreviewMessageHandlers } from "@/entrypoints/background/background-cover-preview-message-handlers"
import type { CurrentSeriesContext } from "@/entrypoints/background/tab-cache"
import type { RuntimeMessageRequest } from "@/src/runtime/runtime-message-contracts"

const owner = {
  documentId: "requesting-panel",
  url: "chrome-extension://test/sidepanel.html",
}
const otherOwner = { ...owner, documentId: "another-panel" }

function request(index: number): RuntimeMessageRequest<"GET_COVER_PREVIEW"> {
  return {
    target: "background",
    type: "GET_COVER_PREVIEW",
    payload: {
      requestId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      source: {
        kind: "series",
        tabId: 3,
        windowId: 1,
        seriesId: "123",
        seriesRevision: 5,
      },
    },
  }
}

function fixture() {
  const ready = Promise.withResolvers<void>()
  const ensureRuntimeReady = vi.fn(() => ready.promise)
  const coverUrl = "https://biccam.com/comics/123-series.png"
  const context: CurrentSeriesContext = {
    windowId: 1,
    revision: 5,
    context: {
      sourceUrl: "https://www.mycomic.com/comic/123",
      siteIntegrationId: "mycomic",
      mangaId: "123",
      seriesTitle: "Series",
      metadata: { coverUrl },
      chapters: [],
      volumes: [],
      lastUpdated: 1,
    },
  }
  const getCurrentSeriesContext = vi.fn(async () => context)
  const release = vi.fn()
  const sendMessage = vi.fn(async (_message: unknown) => ({
    success: true,
    integrationId: "mycomic",
    coverUrl,
    mimeType: "image/png",
    base64: "AA==",
  }))
  vi.stubGlobal("chrome", {
    permissions: { contains: async () => true },
    runtime: { sendMessage, getManifest: () => ({}) },
  })
  const handlers = createBackgroundCoverPreviewMessageHandlers({
    ensureRuntimeReady,
    getCurrentSeriesContext,
    queueRepository: { getTask: async () => undefined },
    siteIntegrationEnablementService: {
      getAll: async () => ({ mycomic: true }),
    },
    rateLimitService: {
      resolveEffectivePolicy: async () => ({ concurrency: 1, delayMs: 0 }),
    },
    ensureNetworkReady: async () => undefined,
    admit: async (operation) =>
      operation({ reserveTransientWork: () => ({ release }) }),
  })
  const cancel = async (message: ReturnType<typeof request>, sender = owner) =>
    handlers.CANCEL_COVER_PREVIEW(
      {
        target: "background",
        type: "CANCEL_COVER_PREVIEW",
        payload: { requestId: message.payload.requestId },
      },
      sender
    )
  return {
    ready,
    ensureRuntimeReady,
    getCurrentSeriesContext,
    sendMessage,
    release,
    handlers,
    cancel,
  }
}

afterEach(() => vi.unstubAllGlobals())

describe("cover preview admission", () => {
  it("preserves the first document's pending request when another document reuses its ID", async () => {
    const service = fixture()
    const message = request(1)
    const first = Promise.resolve(
      service.handlers.GET_COVER_PREVIEW(message, owner)
    )
    const duplicate = Promise.resolve(
      service.handlers.GET_COVER_PREVIEW(message, otherOwner)
    )
    const duplicateOutcome = vi.fn()
    void duplicate.then(duplicateOutcome)
    try {
      await Promise.resolve()
      expect(duplicateOutcome).toHaveBeenCalledWith(
        expect.objectContaining({ success: false })
      )
      await expect(duplicate).resolves.toMatchObject({ success: false })
      await expect(service.cancel(message, otherOwner)).resolves.toEqual({
        success: true,
      })
      let firstSettled = false
      void first.then(() => {
        firstSettled = true
      })
      await Promise.resolve()
      expect(firstSettled).toBe(false)
      await expect(service.cancel(message)).resolves.toEqual({ success: true })
      await expect(first).resolves.toMatchObject({ success: false })
      expect(service.getCurrentSeriesContext).not.toHaveBeenCalled()
      expect(service.sendMessage).not.toHaveBeenCalled()
    } finally {
      await Promise.allSettled([
        service.cancel(message),
        service.cancel(message, otherOwner),
      ])
      service.ready.resolve()
      await Promise.allSettled([first, duplicate])
    }
  })

  it("admits sixteen pending requests and rejects another before starting privileged work", async () => {
    const service = fixture()
    const messages = Array.from({ length: 17 }, (_, index) =>
      request(index + 1)
    )
    const pending = messages
      .slice(0, 16)
      .map((message) =>
        Promise.resolve(service.handlers.GET_COVER_PREVIEW(message, owner))
      )
    const overflow = Promise.resolve(
      service.handlers.GET_COVER_PREVIEW(messages[16], owner)
    )
    let settledAdmissions = 0
    for (const admission of pending)
      void admission.then(() => {
        settledAdmissions += 1
      })
    const overflowOutcome = vi.fn()
    void overflow.then(overflowOutcome)
    try {
      await Promise.resolve()
      expect(settledAdmissions).toBe(0)
      expect(overflowOutcome).toHaveBeenCalledWith(
        expect.objectContaining({ success: false })
      )
      await expect(overflow).resolves.toMatchObject({ success: false })
      expect(service.getCurrentSeriesContext).not.toHaveBeenCalled()
      expect(service.sendMessage).not.toHaveBeenCalled()
    } finally {
      await Promise.allSettled(
        messages.map((message) => service.cancel(message))
      )
      service.ready.resolve()
      await Promise.allSettled([...pending, overflow])
    }
  })

  it("acknowledges cancellation before admission and after a preview has completed", async () => {
    const service = fixture()
    const message = request(1)
    await expect(service.cancel(message)).resolves.toEqual({ success: true })
    service.ready.resolve()
    await expect(
      service.handlers.GET_COVER_PREVIEW(message, owner)
    ).resolves.toMatchObject({ success: true })
    await expect(service.cancel(message)).resolves.toEqual({ success: true })
    expect(service.sendMessage).toHaveBeenCalledOnce()
    expect(service.sendMessage.mock.calls[0][0]).toMatchObject({
      type: "OFFSCREEN_FETCH_COVER_PREVIEW",
    })
    expect(service.release).toHaveBeenCalledOnce()
  })
})
