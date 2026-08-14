import {
  getRateLimitPolicyFromSnapshot,
  type RateLimitService,
} from "@/src/runtime/rate-limit"
import { integrationHttpClient } from "../http-client"
import { fetchImageWithStallDetection } from "@/src/runtime/fetch-image"
import type { TaskSettingsSnapshot } from "@/src/types/state-snapshots"
import { decodeHtmlResponse } from "@/src/shared/html-response-decoder"
import { buildManhuaguiChapterImageUrlsFromHtml } from "./chapter-viewer"
import {
  assertManhuaguiChapterUrl,
  isAllowedManhuaguiCoverUrl,
  isAllowedManhuaguiImageUrl,
} from "./shared"
import { createIntegrationEndpointUrlAssertion } from "../request-policy"
import { ProviderContractError } from "../provider-contract-error"
import { MANHUAGUI_CREDENTIAL_POLICY } from "./policy"
import type {
  OffscreenLiveResourceLedger,
  OffscreenLiveResourceLease,
} from "@/src/runtime/offscreen-live-resource-ledger"
import type { ChapterRuntimeData } from "@/src/types/site-integrations"

const assertManhuaguiImageUrl = createIntegrationEndpointUrlAssertion(
  "manhuagui",
  "manhuagui-image-cdn"
)

/**
 * Fetch the chapter viewer HTML and reconstruct the signed image URL list.
 * Returns absolute CDN URLs ready to be downloaded in order.
 */
export async function resolveManhuaguiChapterImageUrls(
  chapter: { id: string; url: string },
  rateLimitService: RateLimitService,
  settingsSnapshot?: Partial<TaskSettingsSnapshot>,
  signal?: AbortSignal
): Promise<string[]> {
  assertManhuaguiChapterUrl(chapter.url)
  const chapterPolicy = getRateLimitPolicyFromSnapshot(
    settingsSnapshot,
    "chapter"
  )
  const response = await integrationHttpClient.request({
    integrationId: "manhuagui",
    endpointId: "manhuagui-series-html",
    url: chapter.url,
    scope: "chapter",
    init: { credentials: MANHUAGUI_CREDENTIAL_POLICY.pageHtml, signal },
    rateLimitService,
    policyOverride: chapterPolicy,
  })
  if (!response.ok) {
    throw Object.assign(
      new Error(`HTTP ${response.status}: ${response.statusText}`),
      { status: response.status }
    )
  }

  const { html } = await decodeHtmlResponse(response)
  return buildManhuaguiChapterImageUrlsFromHtml(
    html,
    rateLimitService,
    chapterPolicy,
    signal
  )
}

/**
 * Download a single Manhuagui chapter image. Fetch cannot manufacture the
 * provider's cross-origin Referer value; the provider-declared,
 * extension-initiated DNR session rule supplies it. The request itself omits
 * ambient credentials and remains constrained by the provider URL allowlist.
 */
export async function downloadManhuaguiChapterImage(
  imageUrl: string,
  opts: {
    signal?: AbortSignal
    runtime: ChapterRuntimeData
    skipRateLimit?: boolean
    onBytesReceived?: (bytesReceived: number) => void | Promise<void>
    liveResourceLedger?: OffscreenLiveResourceLedger
  }
): Promise<{
  data: ArrayBuffer
  filename: string
  mimeType: string
  liveResourceLease?: OffscreenLiveResourceLease
}> {
  if (!isAllowedManhuaguiImageUrl(imageUrl)) {
    throw new ProviderContractError("Manhuagui image URL origin is not allowed")
  }
  if (opts.signal?.aborted) {
    throw new Error("aborted")
  }

  const { data, mimeType, liveResourceLease } =
    await fetchImageWithStallDetection(imageUrl, {
      integrationId: "manhuagui",
      endpointId: "manhuagui-image-cdn",
      signal: opts.signal,
      rateLimitPolicy: opts.runtime.rateLimitSettings.image,
      rateLimitService: opts.runtime.rateLimitService,
      skipRateLimit: opts.skipRateLimit,
      onBytesReceived: opts.onBytesReceived,
      assertUrlAllowed: assertManhuaguiImageUrl,
      liveResourceLedger: opts.liveResourceLedger,
      init: {
        credentials: MANHUAGUI_CREDENTIAL_POLICY.image,
      },
    })
  const filename =
    new URL(imageUrl).pathname.split("/").filter(Boolean).pop() || "image.jpg"

  return { data, filename, mimeType, liveResourceLease }
}

export async function downloadManhuaguiCoverImage(
  imageUrl: string,
  opts: {
    signal?: AbortSignal
    runtime: ChapterRuntimeData
    skipRateLimit?: boolean
    onBytesReceived?: (bytesReceived: number) => void | Promise<void>
    liveResourceLedger?: OffscreenLiveResourceLedger
  }
): Promise<{
  data: ArrayBuffer
  filename: string
  mimeType: string
  liveResourceLease?: OffscreenLiveResourceLease
}> {
  if (!isAllowedManhuaguiCoverUrl(imageUrl)) {
    throw new ProviderContractError("Manhuagui cover URL origin is not allowed")
  }
  const { data, mimeType, liveResourceLease } =
    await fetchImageWithStallDetection(imageUrl, {
      integrationId: "manhuagui",
      endpointId: "manhuagui-image-cdn",
      signal: opts.signal,
      rateLimitService: opts.runtime.rateLimitService,
      skipRateLimit: opts.skipRateLimit,
      onBytesReceived: opts.onBytesReceived,
      assertUrlAllowed: assertManhuaguiImageUrl,
      liveResourceLedger: opts.liveResourceLedger,
      init: { credentials: MANHUAGUI_CREDENTIAL_POLICY.image },
    })
  return {
    data,
    mimeType,
    liveResourceLease,
    filename:
      new URL(imageUrl).pathname.split("/").filter(Boolean).pop() ||
      "cover.jpg",
  }
}
