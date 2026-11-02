import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  fetchPaginationInfo,
  fetchProducts,
  fetchShonenJumpPlusChapterList,
} from "@/src/site-integrations/shonenjumpplus/series-api"
import { RateLimitService } from "@/src/runtime/rate-limit"

const request = vi.hoisted(() => vi.fn())
vi.mock("@/src/site-integrations/http-client", () => ({
  integrationHttpClient: { request },
}))
const rateLimitService = new RateLimitService({
  resolveEffectivePolicy: async () => ({ concurrency: 1, delayMs: 0 }),
})
beforeEach(() => request.mockReset())

describe("Shonen Jump+ pagination boundaries", () => {
  it.each([
    { per_page: undefined, readable_products_count: undefined, limit: 50 },
    { per_page: 0, readable_products_count: -1, limit: 50 },
    { per_page: 500, readable_products_count: 1, limit: 100 },
    { per_page: 0.5, readable_products_count: 1, limit: 1 },
  ])(
    "bounds reported pagination values: $per_page",
    async ({ limit, ...info }) => {
      request
        .mockResolvedValueOnce(Response.json(info))
        .mockResolvedValueOnce(Response.json([]))
      await expect(
        fetchShonenJumpPlusChapterList("456", "123", rateLimitService)
      ).resolves.toMatchObject({ chapters: [], truncated: true })
      expect(
        new URL(request.mock.calls[1][0].url).searchParams.get("limit")
      ).toBe(String(limit))
      expect(request).toHaveBeenCalledTimes(2)
    }
  )

  it.each([
    fetchPaginationInfo,
    (aggregateId: string, episodeId: string, service: RateLimitService) =>
      fetchProducts(aggregateId, 0, 50, service),
  ])(
    "releases a rejected API body and reports the HTTP status",
    async (fetcher) => {
      const response = new Response("Denied", { status: 503 })
      const cancel = vi.spyOn(response.body!, "cancel")
      request.mockResolvedValueOnce(response)
      await expect(
        fetcher("456", "123", rateLimitService)
      ).rejects.toMatchObject({ status: 503 })
      expect(cancel).toHaveBeenCalledOnce()
    }
  )
})
