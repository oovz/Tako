import { afterEach, describe, expect, it, vi } from "vitest"
import {
  OffscreenSeriesResolver,
  MAX_CANCELED_SERIES_RESOLUTION_REQUESTS,
} from "@/entrypoints/offscreen/series-resolver"
import { RateLimitService } from "@/src/runtime/rate-limit"
import { loadOffscreenSiteIntegrationEnablement } from "@/src/runtime/site-integration-offscreen-initialization"

vi.mock("@/src/runtime/site-integration-offscreen-initialization", () => ({
  loadOffscreenSiteIntegrationEnablement: vi.fn(),
}))
const policy = {
  image: { concurrency: 1, delayMs: 0 },
  chapter: { concurrency: 1, delayMs: 0 },
}
const request = (requestId: string) => ({
  requestId,
  siteIntegrationId: "mangadex",
  seriesUrl: "https://mangadex.org/title/one",
  html: "<main>Series</main>",
  rateLimitSettings: policy,
})
const createResolver = () =>
  new OffscreenSeriesResolver(
    () =>
      new RateLimitService({
        resolveEffectivePolicy: async () => ({ concurrency: 1, delayMs: 0 }),
      })
  )
afterEach(() => vi.resetAllMocks())

describe("series resolution request cancellation", () => {
  it("rejects duplicate admission while cancellation waits for enablement to settle", async () => {
    let release!: (value: Record<string, boolean>) => void
    vi.mocked(loadOffscreenSiteIntegrationEnablement).mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      })
    )
    const resolver = createResolver()
    const pending = resolver.parseSeriesHtml(request("same-request"))
    expect(resolver.getActiveCount()).toBe(1)
    await expect(
      resolver.parseSeriesHtml(request("same-request"))
    ).resolves.toMatchObject({ success: false })
    expect(resolver.getActiveCount()).toBe(1)
    expect(resolver.cancelSeriesHtml("same-request")).toBe(true)
    expect(resolver.getActiveCount()).toBe(1)
    release({})
    await expect(pending).resolves.toMatchObject({ success: false })
    expect(resolver.getActiveCount()).toBe(0)
  })

  it("retains recent pre-admission cancellations and admits the evicted oldest identity", async () => {
    const resolver = createResolver()
    for (
      let index = 0;
      index <= MAX_CANCELED_SERIES_RESOLUTION_REQUESTS;
      index++
    )
      resolver.cancelSeriesHtml(`request-${index}`)
    await expect(
      resolver.parseSeriesHtml(
        request(`request-${MAX_CANCELED_SERIES_RESOLUTION_REQUESTS}`)
      )
    ).resolves.toMatchObject({ success: false })
    expect(loadOffscreenSiteIntegrationEnablement).not.toHaveBeenCalled()

    let release!: (value: Record<string, boolean>) => void
    vi.mocked(loadOffscreenSiteIntegrationEnablement).mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      })
    )
    const oldest = resolver.parseSeriesHtml(request("request-0"))
    expect(loadOffscreenSiteIntegrationEnablement).toHaveBeenCalledOnce()
    expect(resolver.getActiveCount()).toBe(1)
    release({})
    await oldest
    expect(resolver.getActiveCount()).toBe(0)
  })
})
