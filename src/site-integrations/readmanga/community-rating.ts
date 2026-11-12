import { z } from "zod"
import { cancelResponseBody } from "@/src/shared/response-body"
import type { RateLimitService } from "@/src/runtime/rate-limit"
import { integrationHttpClient } from "../http-client"

const RATING_TIMEOUT_MS = 4_000
const voteCount = z.int().nonnegative()
const votes = z.object({
  success: z.literal(true),
  data: z.object({
    s1: voteCount,
    s2: voteCount,
    s3: voteCount,
    s4: voteCount,
    s5: voteCount,
  }),
})

async function requestRating(
  url: URL,
  rateLimitService: RateLimitService,
  signal: AbortSignal
): Promise<number | undefined> {
  const response = await integrationHttpClient.request({
    integrationId: "readmanga",
    endpointId: "readmanga-community-rating",
    url: url.href,
    scope: "chapter",
    init: { signal },
    rateLimitService,
  })
  if (!response.ok) {
    cancelResponseBody(response)
    return undefined
  }

  const result = votes.safeParse(await response.json())
  if (!result.success) return undefined

  const { s1, s2, s3, s4, s5 } = result.data.data
  const total = s1 + s2 + s3 + s4 + s5
  if (!total) return undefined
  return Number(((s1 + 2 * s2 + 3 * s3 + 4 * s4 + 5 * s5) / total).toFixed(2))
}

export async function fetchManhuaguiCommunityRating(input: {
  seriesUrl: string
  seriesId: string
  rateLimitService: RateLimitService
  signal?: AbortSignal
}): Promise<number | undefined> {
  if (!/^\d+$/.test(input.seriesId)) return undefined
  const timeout = AbortSignal.timeout(RATING_TIMEOUT_MS)
  const signal = input.signal
    ? AbortSignal.any([input.signal, timeout])
    : timeout
  if (signal.aborted) return undefined

  const url = new URL("/tools/vote.ashx", input.seriesUrl)
  url.searchParams.set("act", "get")
  url.searchParams.set("bid", input.seriesId)

  // The optional vote request shares the limiter with chapter work. Bound
  // the wait for its queue slot as well as the network request itself.
  const expired = new Promise<undefined>((resolve) => {
    signal.addEventListener("abort", () => resolve(undefined), { once: true })
  })
  return Promise.race([
    expired,
    requestRating(url, input.rateLimitService, signal).catch(() => undefined),
  ])
}
