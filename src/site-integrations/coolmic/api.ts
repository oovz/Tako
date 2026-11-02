import { DEFAULT_FETCH_TIMEOUT_MS } from "@/src/constants/timeouts"
import { decodeHtmlResponse } from "@/src/shared/html-response-decoder"
import { cancelResponseBody } from "@/src/shared/response-body"
import type { RateLimitService } from "@/src/runtime/rate-limit"
import { integrationHttpClient } from "../http-client"
import { ProviderContractError } from "../provider-contract-error"
import { CoolmicViewerSchema } from "./contracts"
export const COOLMIC_ORIGIN = "https://coolmic.me"
export function parseCoolmicId(
  raw: string,
  route: "titles" | "episodes"
): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new ProviderContractError("Invalid Coolmic URL")
  }
  const match = url.pathname.match(new RegExp(`^/${route}/([1-9][0-9]*)/?$`))
  if (url.origin !== COOLMIC_ORIGIN || url.username || url.password || !match)
    throw new ProviderContractError("Unsupported Coolmic URL")
  return match[1]
}
async function request(
  url: string,
  endpointId: string,
  rateLimitService: RateLimitService,
  signal?: AbortSignal
): Promise<Response> {
  const boundedSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS)])
    : AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS)
  const response = await integrationHttpClient.request({
    integrationId: "coolmic",
    endpointId,
    url,
    scope: "chapter",
    rateLimitService,
    init: { credentials: "include", signal: boundedSignal },
  })
  if (!response.ok) {
    cancelResponseBody(response)
    throw new ProviderContractError(
      `Coolmic request failed (HTTP ${response.status}).`
    )
  }
  return response
}
export async function fetchCoolmicTitle(
  id: string,
  rateLimitService: RateLimitService,
  signal?: AbortSignal
): Promise<string> {
  return (
    await decodeHtmlResponse(
      await request(
        `${COOLMIC_ORIGIN}/titles/${id}`,
        "coolmic-page",
        rateLimitService,
        signal
      )
    )
  ).html
}
export async function fetchCoolmicViewer(
  id: string,
  rateLimitService: RateLimitService,
  signal?: AbortSignal
) {
  const response = await request(
    `${COOLMIC_ORIGIN}/api/v1/viewer/episodes/${id}`,
    "coolmic-viewer",
    rateLimitService,
    signal
  )
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new ProviderContractError("Coolmic reader response is invalid")
  }
  const parsed = CoolmicViewerSchema.safeParse(body)
  if (!parsed.success)
    throw new ProviderContractError(
      "Coolmic reader is unavailable or its response has changed"
    )
  return parsed.data
}
