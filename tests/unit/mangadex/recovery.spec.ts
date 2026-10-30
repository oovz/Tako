import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { downloadMangadexChapterImage } from "@/src/site-integrations/mangadex/chapter-api"
import { OffscreenLiveResourceLedger } from "@/src/runtime/offscreen-live-resource-ledger"
import type { RateLimitService } from "@/src/runtime/rate-limit"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"

vi.mock("@/src/runtime/logger", () => ({
  default: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const imageUrl = "https://node.example/data/hash/1.jpg"
const uploadsUrl = "https://uploads.mangadex.org/data/hash/1.jpg"
const fetchMock = vi.fn<typeof fetch>()
const rateLimitService = {
  scheduleForIntegrationScope: async <T>(
    _id: string,
    _scope: string,
    task: () => Promise<T>
  ) => task(),
  resolveEffectivePolicy: async () => ({ concurrency: 1, delayMs: 0 }),
} as unknown as RateLimitService

function options(signal?: AbortSignal) {
  return {
    signal,
    liveResourceLedger: new OffscreenLiveResourceLedger(),
    runtime: {
      chapterId: "chapter",
      rateLimitService,
      rateLimitSettings: createTaskSettingsSnapshot(
        DEFAULT_SETTINGS,
        "mangadex"
      ).rateLimitSettings,
    },
  }
}

function mockRecovery(status: number) {
  fetchMock.mockImplementation(async (input) => {
    const url = String(input)
    let body: unknown = {}
    let responseStatus = 200
    if (url === imageUrl) responseStatus = 404
    else if (url === uploadsUrl) responseStatus = status
    else if (url.includes("/at-home/server/"))
      body = {
        baseUrl: "https://node.example",
        chapter: { hash: "hash", data: ["1.jpg"], dataSaver: [] },
      }
    else if (!url.endsWith("/report"))
      throw new Error(`Unexpected request ${url}`)
    const response = new Response(JSON.stringify(body), {
      status: responseStatus,
      headers: { "content-type": "application/json" },
    })
    Object.defineProperty(response, "url", { value: url })
    return response
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it("bounds refreshed image attempts while retaining the original failure as cause", async () => {
  mockRecovery(503)
  const pending = downloadMangadexChapterImage(imageUrl, options())
  const rejected = expect(pending).rejects.toMatchObject({
    cause: { status: 404 },
    message: expect.stringContaining("503"),
  })
  await vi.advanceTimersByTimeAsync(5000)
  await rejected
  expect(
    fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("/at-home/server/")
    )
  ).toHaveLength(5)
  expect(
    fetchMock.mock.calls.filter(([url]) => String(url) === uploadsUrl)
  ).toHaveLength(5)
})

it("stops recovery on a nontransient candidate failure", async () => {
  mockRecovery(403)
  const pending = downloadMangadexChapterImage(imageUrl, options())
  const rejected = expect(pending).rejects.toMatchObject({
    cause: { status: 404 },
    message: expect.stringContaining("403"),
  })
  await vi.advanceTimersByTimeAsync(5000)
  await rejected
  expect(
    fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("/at-home/server/")
    )
  ).toHaveLength(1)
})

it("cancels the recovery wait before another at-home refresh", async () => {
  mockRecovery(404)
  const controller = new AbortController()
  const pending = downloadMangadexChapterImage(
    imageUrl,
    options(controller.signal)
  )
  const rejected = expect(pending).rejects.toThrow("aborted")
  await vi.advanceTimersByTimeAsync(0)
  expect(fetchMock.mock.calls.some(([url]) => String(url) === uploadsUrl)).toBe(
    true
  )
  controller.abort()
  await rejected
  await vi.advanceTimersByTimeAsync(5000)
  expect(
    fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("/at-home/server/")
    )
  ).toHaveLength(1)
})
