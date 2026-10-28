import { DEFAULT_FETCH_TIMEOUT_MS } from "@/src/constants/timeouts"
import { cancelResponseBody } from "@/src/shared/response-body"
import { integrationHttpClient } from "../http-client"
import { ProviderContractError } from "../provider-contract-error"
import type { RateLimitService } from "@/src/runtime/rate-limit"
import { decodeMangaPlusTitle, decodeMangaPlusViewer } from "./proto"

const sessionToken = crypto.randomUUID()
export const MANGAPLUS_ORIGIN = "https://mangaplus.shueisha.co.jp"

export function parseMangaPlusId(
  url: string,
  route: "titles" | "viewer"
): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new ProviderContractError("Invalid MANGA Plus URL")
  }
  const match = parsed.pathname.match(new RegExp(`^/${route}/([1-9][0-9]*)/?$`))
  if (
    parsed.origin !== MANGAPLUS_ORIGIN ||
    !match ||
    parsed.username ||
    parsed.password
  )
    throw new ProviderContractError("Unsupported MANGA Plus URL")
  return match[1]
}

async function request(
  path: string,
  rateLimitService: RateLimitService,
  signal?: AbortSignal
): Promise<Uint8Array> {
  const boundedSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS)])
    : AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS)
  const response = await integrationHttpClient.request({
    integrationId: "mangaplus",
    endpointId: "mangaplus-api",
    scope: "chapter",
    rateLimitService,
    url: `https://jumpg-webapi.tokyo-cdn.com/api/${path}`,
    init: {
      credentials: "include",
      headers: { "SESSION-TOKEN": sessionToken },
      signal: boundedSignal,
    },
  })
  if (!response.ok) {
    cancelResponseBody(response)
    throw new ProviderContractError(
      `MANGA Plus request failed (HTTP ${response.status}).`
    )
  }
  return new Uint8Array(await response.arrayBuffer())
}

export async function fetchMangaPlusTitle(
  id: string,
  rateLimitService: RateLimitService,
  signal?: AbortSignal
) {
  return decodeMangaPlusTitle(
    await request(
      `title_detailV4?title_id=${id}&clang=eng`,
      rateLimitService,
      signal
    )
  )
}
export async function fetchMangaPlusViewer(
  id: string,
  rateLimitService: RateLimitService,
  signal?: AbortSignal
) {
  return decodeMangaPlusViewer(
    await request(
      `manga_viewer_v3?chapter_id=${id}&split=yes&img_quality=high&clang=eng`,
      rateLimitService,
      signal
    )
  )
}
