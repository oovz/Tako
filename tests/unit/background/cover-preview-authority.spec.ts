import { beforeEach, describe, expect, it, vi } from "vitest"
import { createBackgroundCoverPreviewMessageHandlers } from "@/entrypoints/background/background-cover-preview-message-handlers"
import { runtimeMessageRegistry } from "@/src/runtime/runtime-message-contracts"
import type { CurrentSeriesContext } from "@/entrypoints/background/tab-cache"

const requestId = "d6dbd6f2-e9b1-41ea-aa4e-c1cf68724470"
const source = {
  kind: "series" as const,
  tabId: 3,
  windowId: 1,
  seriesId: "123",
  seriesRevision: 5,
}
const coverUrl = "https://biccam.com/comics/123-series.png"
const sender = {
  id: "extension",
  documentId: "panel",
  url: "chrome-extension://extension/sidepanel.html",
}
const getCurrentSeriesContext = vi.fn()
const getTask = vi.fn()
const getAll = vi.fn()
const sendMessage = vi.fn()
const contains = vi.fn()
const ensureNetworkReady = vi.fn()
const release = vi.fn()
const ensureRuntimeReady = vi.fn()
const rateLimitService = {
  resolveEffectivePolicy: vi.fn(async () => ({ concurrency: 1, delayMs: 0 })),
}
function handlers() {
  return createBackgroundCoverPreviewMessageHandlers({
    getCurrentSeriesContext,
    queueRepository: { getTask },
    siteIntegrationEnablementService: { getAll },
    rateLimitService,
    ensureNetworkReady,
    ensureRuntimeReady,
    admit: async (operation) =>
      operation({ reserveTransientWork: () => ({ release }) }),
  })
}
function current(): CurrentSeriesContext {
  return {
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
}
const request = {
  target: "background" as const,
  type: "GET_COVER_PREVIEW" as const,
  payload: { requestId, source },
}

describe("cover preview authority", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ensureRuntimeReady.mockResolvedValue(undefined)
    getCurrentSeriesContext.mockResolvedValue(current())
    getAll.mockResolvedValue({ mycomic: true })
    contains.mockResolvedValue(true)
    sendMessage.mockResolvedValue({
      success: true,
      integrationId: "mycomic",
      coverUrl,
      mimeType: "image/png",
      base64: "aGVsbG8=",
    })
    vi.stubGlobal("chrome", {
      permissions: { contains },
      runtime: { sendMessage, getManifest: () => ({}) },
    })
  })
  it("fetches only the cover in the current background-owned series revision", async () => {
    const result = await handlers().GET_COVER_PREVIEW(request, sender)
    expect(result).toMatchObject({ success: true, coverUrl })
    expect(sendMessage.mock.calls[0]?.[0]).toMatchObject({
      target: "offscreen",
      type: "OFFSCREEN_FETCH_COVER_PREVIEW",
      payload: { integrationId: "mycomic", coverUrl },
    })
    expect(release).toHaveBeenCalledOnce()
  })
  it("rejects a stale series revision before network access", async () => {
    getCurrentSeriesContext.mockResolvedValue({ ...current(), revision: 6 })
    expect(await handlers().GET_COVER_PREVIEW(request, sender)).toMatchObject({
      success: false,
    })
    expect(sendMessage).not.toHaveBeenCalled()
  })
  it("rejects disabled integrations and denied host permissions", async () => {
    getAll.mockResolvedValue({ mycomic: false })
    expect(await handlers().GET_COVER_PREVIEW(request, sender)).toMatchObject({
      success: false,
    })
    getAll.mockResolvedValue({ mycomic: true })
    contains.mockResolvedValue(false)
    expect(await handlers().GET_COVER_PREVIEW(request, sender)).toMatchObject({
      success: false,
    })
    expect(sendMessage).not.toHaveBeenCalled()
  })
  it("uses the retained task cover and rejects a removed task", async () => {
    getTask.mockResolvedValue({
      siteIntegrationId: "mycomic",
      seriesCoverUrl: coverUrl,
    })
    const message = {
      ...request,
      payload: {
        requestId,
        source: { kind: "task" as const, taskId: "task-1" },
      },
    }
    expect(await handlers().GET_COVER_PREVIEW(message, sender)).toMatchObject({
      success: true,
      coverUrl,
    })
    getTask.mockResolvedValue(undefined)
    expect(await handlers().GET_COVER_PREVIEW(message, sender)).toMatchObject({
      success: false,
    })
  })

  it("rejects a caller-supplied URL at the message boundary", () => {
    expect(
      runtimeMessageRegistry.GET_COVER_PREVIEW.request.safeParse({
        ...request,
        payload: {
          ...request.payload,
          coverUrl: "https://unrelated.example/cover.png",
        },
      }).success
    ).toBe(false)
  })

  it("allows only the requesting document to cancel and releases admitted work", async () => {
    let finish!: (value: unknown) => void
    sendMessage.mockImplementation((message) =>
      message.type === "OFFSCREEN_FETCH_COVER_PREVIEW"
        ? new Promise((resolve) => {
            finish = resolve
          })
        : Promise.resolve({ success: true })
    )
    const service = handlers()
    const result = service.GET_COVER_PREVIEW(request, sender)
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledOnce())
    const cancel = {
      target: "background" as const,
      type: "CANCEL_COVER_PREVIEW" as const,
      payload: { requestId },
    }
    await service.CANCEL_COVER_PREVIEW(cancel, {
      ...sender,
      documentId: "other-panel",
    })
    expect(sendMessage).toHaveBeenCalledOnce()
    await service.CANCEL_COVER_PREVIEW(cancel, sender)
    expect(await result).toMatchObject({ success: false })
    expect(sendMessage.mock.calls[1]?.[0]).toMatchObject({
      type: "OFFSCREEN_CANCEL_COVER_PREVIEW",
      payload: { requestId },
    })
    finish({ success: false, error: "Canceled" })
    await vi.waitFor(() => expect(release).toHaveBeenCalledOnce())
  })
  it("preserves cancellation while runtime hydration is still pending", async () => {
    let ready!: () => void
    ensureRuntimeReady.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          ready = resolve
        })
    )
    const service = handlers()
    const result = service.GET_COVER_PREVIEW(request, sender)
    await vi.waitFor(() => expect(ensureRuntimeReady).toHaveBeenCalledOnce())
    expect(getCurrentSeriesContext).not.toHaveBeenCalled()
    await service.CANCEL_COVER_PREVIEW(
      {
        target: "background",
        type: "CANCEL_COVER_PREVIEW",
        payload: { requestId },
      },
      sender
    )
    await expect(result).resolves.toMatchObject({ success: false })
    ready()
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(sendMessage).not.toHaveBeenCalled()
  })
})
