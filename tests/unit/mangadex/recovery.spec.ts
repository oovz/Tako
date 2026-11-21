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

function options(signal?: AbortSignal, imageRetries = 3) {
  return {
    signal,
    liveResourceLedger: new OffscreenLiveResourceLedger(),
    runtime: {
      chapterId: "chapter",
      rateLimitService,
      retrySettings: { image: imageRetries, chapter: 0 },
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
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

it.each([
  { granted: true, reports: 1 },
  { granted: false, reports: 0 },
])(
  "sends $reports MangaDex@Home reports when Firefox consent at dispatch is $granted",
  async ({ granted, reports }) => {
    vi.stubEnv("FIREFOX", "true")
    let consent = true
    vi.stubGlobal("chrome", {
      permissions: {
        contains: async ({ data_collection }: { data_collection?: string[] }) =>
          !data_collection?.includes("websiteActivity") || consent,
      },
    })
    const reportUrl = "https://api.mangadex.network/report"
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      const response =
        url === reportUrl
          ? new Response(null, { status: 204 })
          : new Response(new Uint8Array([1, 2, 3]), {
              headers: { "content-type": "image/jpeg" },
            })
      Object.defineProperty(response, "url", { value: url })
      return response
    })

    const entered = Promise.withResolvers<void>()
    const admitReport = Promise.withResolvers<void>()
    const finished = Promise.withResolvers<void>()
    const opts = options(undefined, 0)
    opts.runtime.rateLimitService = {
      ...opts.runtime.rateLimitService,
      scheduleForIntegrationScope: async (_id, scope, run) => {
        if (scope !== "chapter") return await run()
        entered.resolve()
        await admitReport.promise
        try {
          return await run()
        } finally {
          finished.resolve()
        }
      },
    } as RateLimitService

    const image = await downloadMangadexChapterImage(imageUrl, opts)
    image.liveResourceLease.release()
    await entered.promise
    consent = granted
    admitReport.resolve()
    await finished.promise

    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === reportUrl)
    ).toHaveLength(reports)
  }
)

it("bounds refreshed image attempts while retaining the original failure as cause", async () => {
  mockRecovery(503)
  const pending = downloadMangadexChapterImage(imageUrl, options(undefined, 5))
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

it("uses only the original image request with zero configured retries", async () => {
  mockRecovery(503)
  await expect(
    downloadMangadexChapterImage(imageUrl, options(undefined, 0))
  ).rejects.toMatchObject({ status: 404 })
  expect(
    fetchMock.mock.calls.filter(([url]) => String(url) === imageUrl)
  ).toHaveLength(1)
  expect(
    fetchMock.mock.calls.some(([url]) =>
      String(url).includes("/at-home/server/")
    )
  ).toBe(false)
})

it("shares the configured page retry budget between rate limits and node recovery", async () => {
  mockRecovery(503)
  fetchMock.mockImplementationOnce(
    async () => new Response(null, { status: 429 })
  )
  const pending = downloadMangadexChapterImage(imageUrl, options(undefined, 2))
  const rejected = expect(pending).rejects.toMatchObject({
    cause: { status: 404 },
    message: expect.stringContaining("503"),
  })
  await vi.advanceTimersByTimeAsync(5000)
  await rejected

  expect(
    fetchMock.mock.calls.filter(([url]) => String(url) === imageUrl)
  ).toHaveLength(2)
  expect(
    fetchMock.mock.calls.filter(([url]) => String(url) === uploadsUrl)
  ).toHaveLength(1)
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
