import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  runOffscreenDocumentAdmissionExclusive: vi.fn(
    async <T>(operation: () => Promise<T>): Promise<T> => await operation()
  ),
  sendMessage: vi.fn(),
}))

import {
  configureSeriesDataOffscreenLifecycle,
  resolveSeriesDataViaOffscreen,
} from "@/src/runtime/resolve-series-data-offscreen"
import type { RateLimitService } from "@/src/runtime/rate-limit"

const rateLimitService = {
  resolveEffectivePolicy: vi.fn(async () => ({ concurrency: 1, delayMs: 0 })),
  scheduleForIntegrationScope: vi.fn(
    async <T>(_integrationId: string, _scope: string, task: () => Promise<T>) =>
      task()
  ),
  cleanupRateLimiters: vi.fn(),
} as unknown as RateLimitService

describe("resolveSeriesDataViaOffscreen", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: mocks.sendMessage,
      },
    } as unknown as typeof chrome)
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn(() => "00000000-0000-4000-8000-000000000001"),
    })
    configureSeriesDataOffscreenLifecycle(
      mocks.runOffscreenDocumentAdmissionExclusive as <T>(
        operation: () => Promise<T>
      ) => Promise<T>
    )
  })

  it("admits the parse send with the offscreen lifecycle and maps a successful response", async () => {
    mocks.sendMessage.mockResolvedValue({
      success: true,
      seriesMetadata: { title: "Series" },
      chapterList: { chapters: [], volumes: [] },
      metadataError: undefined,
      chapterListError: undefined,
      chapterListNotice: undefined,
    })

    await expect(
      resolveSeriesDataViaOffscreen({
        siteIntegrationId: "site",
        seriesUrl: "https://example.test/series",
        html: "<html />",
        language: "en",
        rateLimitService,
      })
    ).resolves.toEqual({
      seriesMetadata: { title: "Series" },
      chapterList: { chapters: [], volumes: [] },
      metadataError: undefined,
      chapterListError: undefined,
      chapterListNotice: undefined,
    })

    expect(mocks.runOffscreenDocumentAdmissionExclusive).toHaveBeenCalledOnce()
    expect(mocks.sendMessage).toHaveBeenCalledWith({
      target: "offscreen",
      type: "OFFSCREEN_PARSE_SERIES_HTML",
      payload: {
        requestId: "00000000-0000-4000-8000-000000000001",
        siteIntegrationId: "site",
        seriesUrl: "https://example.test/series",
        html: "<html />",
        language: "en",
        rateLimitSettings: {
          image: { concurrency: 1, delayMs: 0 },
          chapter: { concurrency: 1, delayMs: 0 },
        },
      },
    })
  })

  it("does not parse an already-aborted request", async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      resolveSeriesDataViaOffscreen({
        siteIntegrationId: "site",
        seriesUrl: "https://example.test/series",
        html: "<html />",
        signal: controller.signal,
        rateLimitService,
      })
    ).rejects.toThrow()
    expect(mocks.sendMessage).not.toHaveBeenCalled()
  })

  it("does not parse when readiness is aborted", async () => {
    const controller = new AbortController()
    mocks.runOffscreenDocumentAdmissionExclusive.mockImplementationOnce(
      async () => {
        controller.abort()
      }
    )

    await expect(
      resolveSeriesDataViaOffscreen({
        siteIntegrationId: "site",
        seriesUrl: "https://example.test/series",
        html: "<html />",
        signal: controller.signal,
        rateLimitService,
      })
    ).rejects.toThrow()
    expect(mocks.sendMessage).not.toHaveBeenCalled()
  })

  it("cancels when the signal aborts while parsing", async () => {
    const controller = new AbortController()
    let resolveParse!: (value: unknown) => void
    mocks.sendMessage.mockImplementation((message) => {
      if (message.type === "OFFSCREEN_PARSE_SERIES_HTML") {
        return new Promise((resolve) => {
          resolveParse = resolve
        })
      }
      return Promise.resolve(undefined)
    })

    const resolution = resolveSeriesDataViaOffscreen({
      siteIntegrationId: "site",
      seriesUrl: "https://example.test/series",
      html: "<html />",
      signal: controller.signal,
      rateLimitService,
    })
    await vi.waitFor(() => expect(resolveParse).toBeTypeOf("function"))

    controller.abort()
    expect(mocks.sendMessage).toHaveBeenNthCalledWith(2, {
      target: "offscreen",
      type: "OFFSCREEN_CANCEL_SERIES_HTML",
      payload: { requestId: "00000000-0000-4000-8000-000000000001" },
    })
    resolveParse({
      success: true,
      seriesMetadata: {},
      chapterList: { chapters: [], volumes: [] },
    })
    await expect(resolution).rejects.toThrow()
  })

  it("surfaces missing and failed parser responses", async () => {
    mocks.sendMessage.mockResolvedValueOnce(undefined)
    await expect(
      resolveSeriesDataViaOffscreen({
        siteIntegrationId: "site",
        seriesUrl: "https://example.test/series",
        html: "html",
        rateLimitService,
      })
    ).rejects.toThrow("Invalid OFFSCREEN_PARSE_SERIES_HTML response")

    mocks.sendMessage.mockResolvedValueOnce({
      success: false,
      error: "parse failed",
    })
    await expect(
      resolveSeriesDataViaOffscreen({
        siteIntegrationId: "site",
        seriesUrl: "https://example.test/series",
        html: "html",
        rateLimitService,
      })
    ).rejects.toThrow("parse failed")

    mocks.sendMessage.mockResolvedValueOnce({
      success: false,
    })
    await expect(
      resolveSeriesDataViaOffscreen({
        siteIntegrationId: "site",
        seriesUrl: "https://example.test/series",
        html: "html",
        rateLimitService,
      })
    ).rejects.toThrow("Invalid OFFSCREEN_PARSE_SERIES_HTML response")
  })
})
