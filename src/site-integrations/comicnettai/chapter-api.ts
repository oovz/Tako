import { getRateLimitPolicyFromSnapshot } from "@/src/runtime/rate-limit"
import { integrationHttpClient } from "../http-client"
import { fetchImageWithStallDetection } from "@/src/runtime/fetch-image"
import logger from "@/src/runtime/logger"
import type { TaskSettingsSnapshot } from "@/src/types/state-snapshots"
import {
  buildComicNettaiViewerApiUrl,
  parseTrustedComicNettaiCdnUrl,
} from "./shared"
import {
  buildPublusImageUrlsFromConfig,
  decodePublusConfigurationPack,
} from "./publus-config"
import type { PublusConfig } from "./contracts/publus"
import {
  descramblePublusImage,
  parsePublusImageTransportUrl,
} from "./publus-image"
import {
  readResponseJson,
  readResponseText,
} from "@/src/shared/html-response-decoder"
import type {
  OffscreenLiveResourceLedger,
  OffscreenLiveResourceLease,
} from "@/src/runtime/offscreen-live-resource-ledger"
import type { ChapterRuntimeData } from "@/src/types/site-integrations"
import type { RateLimitService } from "@/src/runtime/rate-limit"
import { createIntegrationEndpointUrlAssertion } from "../request-policy"
import { ProviderContractError } from "../provider-contract-error"

export { buildPublusImageUrlsFromConfig } from "./publus-config"

const assertComicNettaiImageUrl = createIntegrationEndpointUrlAssertion(
  "comicnettai",
  "comicnettai-cdn-image"
)

type ComicNettaiViewerContentResponse = {
  status?: string | number
  url?: string
  cti?: string
}

function assertViewerContentResponse(value: unknown): string {
  if (!value || typeof value !== "object") {
    throw new ProviderContractError(
      "Comic Nettai chapter returned an invalid viewer response (HTTP 422)."
    )
  }

  const response = value as ComicNettaiViewerContentResponse
  if (response.status === undefined || response.status === null) {
    throw new ProviderContractError(
      "Comic Nettai chapter returned an invalid viewer response (HTTP 422)."
    )
  }
  const viewerStatus = String(response.status ?? "missing")
  if (viewerStatus !== "200") {
    const httpStatus = /^\d{3}$/.test(viewerStatus) ? viewerStatus : "422"
    throw Object.assign(
      new Error(
        `Comic Nettai chapter could not be opened (HTTP ${httpStatus}; viewer status ${viewerStatus}). The chapter may be unavailable or locked.`
      ),
      { status: Number(httpStatus) }
    )
  }

  if (typeof response.url !== "string" || response.url.length === 0) {
    throw new ProviderContractError(
      "Comic Nettai chapter returned no content URL (HTTP 422). The site may have changed its format."
    )
  }

  return parseTrustedComicNettaiCdnUrl(
    response.url,
    "Comic Nettai viewer content URL"
  ).toString()
}

async function fetchJson(
  url: string,
  rateLimitService: RateLimitService,
  settingsSnapshot?: Partial<TaskSettingsSnapshot>,
  signal?: AbortSignal
): Promise<unknown> {
  const response = await integrationHttpClient.request({
    integrationId: "comicnettai",
    endpointId: "comicnettai-viewer-api",
    url,
    scope: "chapter",
    init: {
      headers: {
        accept: "application/json,*/*",
      },
      credentials: "include",
      signal,
    },
    policyOverride: getRateLimitPolicyFromSnapshot(settingsSnapshot, "chapter"),
    rateLimitService,
  })
  if (!response.ok) {
    throw Object.assign(
      new Error(
        `Comic Nettai content request failed (HTTP ${response.status}). The site may be unavailable.`
      ),
      { status: response.status }
    )
  }

  return readResponseJson(response)
}

export async function resolveComicNettaiChapterImageUrls(
  chapter: { id: string; url: string },
  rateLimitService: RateLimitService,
  settingsSnapshot?: Partial<TaskSettingsSnapshot>,
  signal?: AbortSignal
): Promise<string[]> {
  const contentCheckUrl = buildComicNettaiViewerApiUrl(chapter.url)
  const contentPayload = await fetchJson(
    contentCheckUrl,
    rateLimitService,
    settingsSnapshot,
    signal
  )
  const contentBaseUrl = assertViewerContentResponse(contentPayload)

  const configUrl = new URL(
    "configuration_pack.json",
    contentBaseUrl
  ).toString()
  const configResponse = await integrationHttpClient.request({
    integrationId: "comicnettai",
    endpointId: "comicnettai-cdn-config",
    url: configUrl,
    scope: "chapter",
    init: {
      headers: {
        accept: "application/json,*/*",
      },
      credentials: "omit",
      signal,
    },
    policyOverride: getRateLimitPolicyFromSnapshot(settingsSnapshot, "chapter"),
    rateLimitService,
  })
  if (!configResponse.ok) {
    throw Object.assign(
      new Error(
        `Comic Nettai chapter configuration could not be loaded (HTTP ${configResponse.status}). The site may be unavailable.`
      ),
      { status: configResponse.status }
    )
  }

  const rawConfig = await readResponseText(configResponse)
  let config: PublusConfig
  try {
    config = decodePublusConfigurationPack(rawConfig)
    return buildPublusImageUrlsFromConfig(contentBaseUrl, config)
  } catch (error) {
    logger.error(
      "[comicnettai] Failed to decode Publus configuration pack",
      error
    )
    throw new ProviderContractError(
      "Comic Nettai chapter images could not be decoded. The site may have changed its format.",
      error
    )
  }
}

export async function downloadComicNettaiChapterImage(
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
  if (opts.signal?.aborted) {
    throw new Error("aborted")
  }

  const { sourceUrl, metadata } = parsePublusImageTransportUrl(imageUrl)
  const trustedSourceUrl = parseTrustedComicNettaiCdnUrl(
    sourceUrl,
    "Comic Nettai PUBLUS image URL"
  ).toString()
  if (!metadata) {
    throw new ProviderContractError(
      "Comic Nettai PUBLUS reconstruction metadata is missing from the image request"
    )
  }

  const {
    data: rawData,
    mimeType,
    liveResourceLease,
  } = await fetchImageWithStallDetection(trustedSourceUrl, {
    integrationId: "comicnettai",
    endpointId: "comicnettai-cdn-image",
    signal: opts.signal,
    init: { credentials: "omit" },
    rateLimitPolicy: opts.runtime.rateLimitSettings.image,
    rateLimitService: opts.runtime.rateLimitService,
    skipRateLimit: opts.skipRateLimit,
    onBytesReceived: opts.onBytesReceived,
    assertUrlAllowed: assertComicNettaiImageUrl,
    liveResourceLedger: opts.liveResourceLedger,
  })
  const downloadedImage = await descramblePublusImage(
    rawData,
    mimeType,
    metadata,
    opts.signal,
    opts.liveResourceLedger,
    liveResourceLease
  )
  const filename =
    new URL(trustedSourceUrl).pathname.split("/").filter(Boolean).pop() ||
    "page.jpeg"

  return { ...downloadedImage, filename }
}

export async function downloadComicNettaiCoverImage(
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
  if (opts.signal?.aborted) {
    throw new Error("aborted")
  }
  const trustedUrl = parseTrustedComicNettaiCdnUrl(
    imageUrl,
    "Comic Nettai cover image URL"
  ).toString()
  const { data, mimeType, liveResourceLease } =
    await fetchImageWithStallDetection(trustedUrl, {
      integrationId: "comicnettai",
      endpointId: "comicnettai-cdn-image",
      signal: opts.signal,
      rateLimitService: opts.runtime.rateLimitService,
      init: { credentials: "omit" },
      skipRateLimit: opts.skipRateLimit,
      onBytesReceived: opts.onBytesReceived,
      assertUrlAllowed: assertComicNettaiImageUrl,
      liveResourceLedger: opts.liveResourceLedger,
    })
  return {
    data,
    mimeType,
    liveResourceLease,
    filename:
      new URL(trustedUrl).pathname.split("/").filter(Boolean).pop() ||
      "cover.jpg",
  }
}
