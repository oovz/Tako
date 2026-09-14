import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  resolveSeriesDataViaOffscreen,
  configureSeriesDataOffscreenLifecycle,
} from "@/src/runtime/resolve-series-data-offscreen"
import type { RateLimitService } from "@/src/runtime/rate-limit"
import {
  closeOffscreenDocumentIfCurrent,
  queryOffscreenStatus,
  runOffscreenDocumentAdmissionExclusive,
  scheduleOffscreenCloseIfIdle,
} from "@/entrypoints/background/offscreen-lifecycle"

const sendMessage = vi.fn()
const hasDocument = vi.fn()
const closeDocument = vi.fn()
const getContexts = vi.fn()

const rateLimitService = {
  resolveEffectivePolicy: vi.fn(async () => ({ concurrency: 1, delayMs: 0 })),
  scheduleForIntegrationScope: vi.fn(
    async <T>(_integrationId: string, _scope: string, task: () => Promise<T>) =>
      task()
  ),
  cleanupRateLimiters: vi.fn(),
} as unknown as RateLimitService

describe("series resolution and offscreen lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal("chrome", {
      runtime: {
        getURL: vi.fn(() => "chrome-extension://test/offscreen.html"),
        getContexts,
        sendMessage,
      },
      offscreen: {
        hasDocument,
        closeDocument,
        createDocument: vi.fn(),
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
    } as unknown as typeof chrome)
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn(() => "00000000-0000-4000-8000-000000000001"),
    })
    configureSeriesDataOffscreenLifecycle(
      runOffscreenDocumentAdmissionExclusive
    )
  })

  it("releases the lifecycle gate after dispatch while reserving the document until parsing settles", async () => {
    hasDocument.mockResolvedValue(true)
    getContexts.mockResolvedValue([{ documentId: "offscreen-document" }])

    let resolveParse!: (response: unknown) => void
    let parseStarted!: () => void
    const parseStartedPromise = new Promise<void>((resolve) => {
      parseStarted = resolve
    })
    sendMessage.mockImplementation(async (message) => {
      if (message.type === "OFFSCREEN_STATUS") {
        return {
          success: true,
          initializationState: "ready",
          documentInstanceId: "document-1",
          activeJobCount: 0,
          activeSeriesResolutionCount: 0,
          activeTaskIds: [],
        }
      }
      if (message.type === "OFFSCREEN_PARSE_SERIES_HTML") {
        parseStarted()
        return await new Promise((resolve) => {
          resolveParse = resolve
        })
      }
      throw new Error(`Unexpected runtime message: ${message.type}`)
    })
    closeDocument.mockResolvedValue(undefined)

    const parse = resolveSeriesDataViaOffscreen({
      siteIntegrationId: "site",
      seriesUrl: "https://example.test/series",
      html: "<html><body>series</body></html>",
      rateLimitService,
    })
    await parseStartedPromise

    let secondAdmissionCompleted = false
    const secondAdmission = runOffscreenDocumentAdmissionExclusive(async () => {
      secondAdmissionCompleted = true
      return "admitted"
    })
    await vi.waitFor(() => expect(secondAdmissionCompleted).toBe(true))
    await expect(secondAdmission).resolves.toBe("admitted")

    const queueRepository = {
      getActiveDispatchLease: vi.fn(async () => null),
    }
    const nativeOutputCoordinator = {
      hasLiveDependencies: vi.fn(async () => false),
    }
    let idleCloseCompleted = false
    const idleClose = scheduleOffscreenCloseIfIdle(
      queueRepository as never,
      nativeOutputCoordinator as never
    ).then(() => {
      idleCloseCompleted = true
    })
    await vi.waitFor(() => expect(idleCloseCompleted).toBe(true))
    expect(closeDocument).not.toHaveBeenCalled()

    resolveParse({
      success: true,
      chapterList: { chapters: [], volumes: [] },
    })
    await expect(parse).resolves.toMatchObject({
      chapterList: { chapters: [], volumes: [] },
    })

    await scheduleOffscreenCloseIfIdle(
      queueRepository as never,
      nativeOutputCoordinator as never
    )
    expect(closeDocument).toHaveBeenCalledOnce()
    await idleClose
  })

  it.each([
    ["failure", { success: false, error: "parse failed" }],
    [
      "cancellation",
      {
        success: true,
        chapterList: { chapters: [], volumes: [] },
      },
    ],
  ] as const)(
    "releases the reservation after parser %s",
    async (outcome, parseResponse) => {
      hasDocument.mockResolvedValue(true)
      getContexts.mockResolvedValue([{ documentId: "offscreen-document" }])

      let resolveParse!: (response: unknown) => void
      let parseStarted!: () => void
      const parseStartedPromise = new Promise<void>((resolve) => {
        parseStarted = resolve
      })
      sendMessage.mockImplementation(async (message) => {
        if (message.type === "OFFSCREEN_STATUS") {
          return {
            success: true,
            initializationState: "ready",
            documentInstanceId: "document-1",
            activeJobCount: 0,
            activeSeriesResolutionCount: 0,
            activeTaskIds: [],
          }
        }
        if (message.type === "OFFSCREEN_PARSE_SERIES_HTML") {
          parseStarted()
          return await new Promise((resolve) => {
            resolveParse = resolve
          })
        }
        if (message.type === "OFFSCREEN_CANCEL_SERIES_HTML") {
          return { success: true, canceled: true }
        }
        throw new Error(`Unexpected runtime message: ${message.type}`)
      })
      closeDocument.mockResolvedValue(undefined)

      const controller = new AbortController()
      const parse = resolveSeriesDataViaOffscreen({
        siteIntegrationId: "site",
        seriesUrl: "https://example.test/series",
        html: "<html><body>series</body></html>",
        signal: controller.signal,
        rateLimitService,
      })
      await parseStartedPromise

      const queueRepository = {
        getActiveDispatchLease: vi.fn(async () => null),
      }
      const nativeOutputCoordinator = {
        hasLiveDependencies: vi.fn(async () => false),
      }
      await scheduleOffscreenCloseIfIdle(
        queueRepository as never,
        nativeOutputCoordinator as never
      )
      expect(closeDocument).not.toHaveBeenCalled()

      if (outcome === "cancellation") controller.abort()
      resolveParse(parseResponse)

      await expect(parse).rejects.toThrow()
      await scheduleOffscreenCloseIfIdle(
        queueRepository as never,
        nativeOutputCoordinator as never
      )
      expect(closeDocument).toHaveBeenCalledOnce()
    }
  )

  it("releases the reservation when the browser document disappears", async () => {
    hasDocument.mockResolvedValue(true)
    getContexts.mockResolvedValue([{ documentId: "offscreen-document" }])

    let resolveParse!: (response: unknown) => void
    let parseStarted!: () => void
    const parseStartedPromise = new Promise<void>((resolve) => {
      parseStarted = resolve
    })
    sendMessage.mockImplementation(async (message) => {
      if (message.type === "OFFSCREEN_STATUS") {
        return {
          success: true,
          initializationState: "ready",
          documentInstanceId: "document-1",
          activeJobCount: 0,
          activeSeriesResolutionCount: 0,
          activeTaskIds: [],
        }
      }
      if (message.type === "OFFSCREEN_PARSE_SERIES_HTML") {
        parseStarted()
        return await new Promise((resolve) => {
          resolveParse = resolve
        })
      }
      throw new Error(`Unexpected runtime message: ${message.type}`)
    })

    const parse = resolveSeriesDataViaOffscreen({
      siteIntegrationId: "site",
      seriesUrl: "https://example.test/series",
      html: "<html><body>series</body></html>",
      rateLimitService,
    })
    await parseStartedPromise

    getContexts.mockResolvedValueOnce([])
    await expect(
      closeOffscreenDocumentIfCurrent({ documentInstanceId: "document-1" })
    ).resolves.toBe("stale")

    const queueRepository = {
      getActiveDispatchLease: vi.fn(async () => null),
    }
    const nativeOutputCoordinator = {
      hasLiveDependencies: vi.fn(async () => false),
    }
    hasDocument.mockResolvedValue(false)
    await scheduleOffscreenCloseIfIdle(
      queueRepository as never,
      nativeOutputCoordinator as never
    )

    hasDocument.mockResolvedValue(true)
    getContexts.mockResolvedValue([{ documentId: "new-offscreen-document" }])
    sendMessage.mockImplementation(async (message) => {
      if (message.type === "OFFSCREEN_STATUS") {
        return {
          success: true,
          initializationState: "ready",
          documentInstanceId: "document-2",
          activeJobCount: 0,
          activeSeriesResolutionCount: 0,
          activeTaskIds: [],
        }
      }
      if (message.type === "OFFSCREEN_PARSE_SERIES_HTML") {
        return await new Promise((resolve) => {
          resolveParse = resolve
        })
      }
      throw new Error(`Unexpected runtime message: ${message.type}`)
    })
    closeDocument.mockResolvedValue(undefined)
    await scheduleOffscreenCloseIfIdle(
      queueRepository as never,
      nativeOutputCoordinator as never
    )
    expect(closeDocument).toHaveBeenCalledOnce()

    resolveParse({
      success: true,
      chapterList: { chapters: [], volumes: [] },
    })
    await expect(parse).resolves.toMatchObject({
      chapterList: { chapters: [], volumes: [] },
    })
  })

  it("allows an exact explicit close while a parse reservation is pending", async () => {
    hasDocument.mockResolvedValue(true)
    getContexts.mockResolvedValue([{ documentId: "offscreen-document" }])

    let resolveParse!: (response: unknown) => void
    let parseStarted!: () => void
    const parseStartedPromise = new Promise<void>((resolve) => {
      parseStarted = resolve
    })
    sendMessage.mockImplementation(async (message) => {
      if (message.type === "OFFSCREEN_STATUS") {
        return {
          success: true,
          initializationState: "ready",
          documentInstanceId: "document-1",
          activeJobCount: 0,
          activeSeriesResolutionCount: 0,
          activeTaskIds: [],
        }
      }
      if (message.type === "OFFSCREEN_PARSE_SERIES_HTML") {
        parseStarted()
        return await new Promise((resolve) => {
          resolveParse = resolve
        })
      }
      throw new Error(`Unexpected runtime message: ${message.type}`)
    })
    closeDocument.mockImplementation(async () => {
      hasDocument.mockResolvedValue(false)
    })

    const parse = resolveSeriesDataViaOffscreen({
      siteIntegrationId: "site",
      seriesUrl: "https://example.test/series",
      html: "<html><body>series</body></html>",
      rateLimitService,
    })
    await parseStartedPromise

    await expect(
      closeOffscreenDocumentIfCurrent({
        documentInstanceId: "document-1",
        browserDocumentId: "offscreen-document",
      })
    ).resolves.toBe("closed")
    expect(closeDocument).toHaveBeenCalledOnce()

    hasDocument.mockResolvedValue(true)
    getContexts.mockResolvedValue([{ documentId: "replacement-document" }])
    sendMessage.mockResolvedValue({
      success: true,
      initializationState: "ready",
      documentInstanceId: "document-2",
      activeJobCount: 0,
      activeSeriesResolutionCount: 0,
      activeTaskIds: [],
    })
    await scheduleOffscreenCloseIfIdle(
      { getActiveDispatchLease: vi.fn(async () => null) } as never,
      { hasLiveDependencies: vi.fn(async () => false) } as never
    )
    expect(closeDocument).toHaveBeenCalledTimes(2)

    resolveParse({
      success: true,
      chapterList: { chapters: [], volumes: [] },
    })
    await expect(parse).resolves.toMatchObject({
      chapterList: { chapters: [], volumes: [] },
    })
  })

  it("does not let a delayed absence observation clear a newer admission reservation", async () => {
    hasDocument.mockResolvedValue(true)
    getContexts.mockResolvedValue([{ documentId: "offscreen-document" }])
    sendMessage.mockResolvedValue({
      success: true,
      initializationState: "ready",
      documentInstanceId: "document-1",
      activeJobCount: 0,
      activeSeriesResolutionCount: 0,
      activeTaskIds: [],
    })

    let oldReservation: { release: () => void } | undefined
    await runOffscreenDocumentAdmissionExclusive(async (context) => {
      oldReservation = context.reserveSeriesResolution()
    })
    oldReservation?.release()

    let resolveAbsence!: (exists: boolean) => void
    const absenceObservation = new Promise<boolean>((resolve) => {
      resolveAbsence = resolve
    })
    hasDocument.mockImplementationOnce(async () => await absenceObservation)
    const delayedAbsence = queryOffscreenStatus()
    await Promise.resolve()

    let newReservation: { release: () => void } | undefined
    await expect(
      runOffscreenDocumentAdmissionExclusive(async (context) => {
        newReservation = context.reserveSeriesResolution()
        return "admitted"
      })
    ).resolves.toBe("admitted")

    resolveAbsence(false)
    await expect(delayedAbsence).resolves.toBeNull()

    await scheduleOffscreenCloseIfIdle(
      { getActiveDispatchLease: vi.fn(async () => null) } as never,
      { hasLiveDependencies: vi.fn(async () => false) } as never
    )
    expect(closeDocument).not.toHaveBeenCalled()

    newReservation?.release()
  })
})
