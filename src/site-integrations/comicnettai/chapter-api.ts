import {
  getRateLimitPolicyFromContext,
  getRateLimitPolicyFromSnapshot,
  rateLimitedFetchForIntegration,
  scheduleForIntegrationScope,
} from "@/src/runtime/rate-limit"
import { fetchImageWithStallDetection } from "@/src/runtime/fetch-image"
import {
  allowsDeterministicE2eRedirect,
  shouldAcceptDeterministicE2eMockResponse,
} from "@/src/runtime/deterministic-e2e-redirect"
import logger from "@/src/runtime/logger"
import { filterValidImageUrls } from "@/src/shared/site-integration-utils"
import type { TaskSettingsSnapshot } from "@/src/types/state-snapshots"
import {
  buildComicNettaiViewerApiUrl,
  parseTrustedComicNettaiCdnUrl,
} from "./shared"
import {
  buildPublusImageUrlsFromConfig,
  decodePublusConfigurationPack,
  type PublusConfig,
} from "./publus-config"
import {
  descramblePublusImage,
  parsePublusImageTransportUrl,
} from "./publus-image"
import {
  assertIntegrationRequestUrl,
  assertIntegrationResponseUrl,
  createIntegrationUrlAssertion,
} from "../request-policy"
import { ProviderContractError } from "../provider-contract-error"

export { buildPublusImageUrlsFromConfig } from "./publus-config"

const assertComicNettaiRequestUrl = createIntegrationUrlAssertion("comicnettai")

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
    throw new Error(
      `Comic Nettai chapter could not be opened (HTTP ${httpStatus}; viewer status ${viewerStatus}). The chapter may be unavailable or locked.`
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
  settingsSnapshot?: Partial<TaskSettingsSnapshot>
): Promise<unknown> {
  const response = await rateLimitedFetchForIntegration(
    "comicnettai",
    url,
    "chapter",
    {
      headers: {
        accept: "application/json,*/*",
      },
      credentials: "include",
    },
    getRateLimitPolicyFromSnapshot(settingsSnapshot, "chapter")
  )
  if (!response.ok) {
    throw new Error(
      `Comic Nettai content request failed (HTTP ${response.status}). The site may be unavailable.`
    )
  }

  return response.json()
}

export async function resolveComicNettaiChapterImageUrls(
  chapter: { id: string; url: string },
  settingsSnapshot?: Partial<TaskSettingsSnapshot>
): Promise<string[]> {
  const contentCheckUrl = buildComicNettaiViewerApiUrl(chapter.url)
  const contentPayload = await fetchJson(contentCheckUrl, settingsSnapshot)
  const contentBaseUrl = assertViewerContentResponse(contentPayload)

  const configUrl = new URL(
    "configuration_pack.json",
    contentBaseUrl
  ).toString()
  const configResponse = await scheduleForIntegrationScope(
    "comicnettai",
    "chapter",
    async () => {
      assertIntegrationRequestUrl("comicnettai", configUrl)
      const response = await fetch(configUrl, {
        headers: {
          accept: "application/json,*/*",
        },
        credentials: "omit",
        redirect: allowsDeterministicE2eRedirect ? "follow" : "error",
      })
      if (!shouldAcceptDeterministicE2eMockResponse(response.url)) {
        assertIntegrationResponseUrl("comicnettai", configUrl, response.url)
      }
      return response
    },
    getRateLimitPolicyFromSnapshot(settingsSnapshot, "chapter")
  )
  if (!configResponse.ok) {
    throw new Error(
      `Comic Nettai chapter configuration could not be loaded (HTTP ${configResponse.status}). The site may be unavailable.`
    )
  }

  const rawConfig = await configResponse.text()
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

export function processComicNettaiImageUrls(urls: string[]): Promise<string[]> {
  return Promise.resolve(
    filterValidImageUrls(urls).filter((url) => {
      try {
        parseTrustedComicNettaiCdnUrl(url, "Comic Nettai PUBLUS image URL")
        return true
      } catch {
        return false
      }
    })
  )
}

export async function downloadComicNettaiChapterImage(
  imageUrl: string,
  opts?: {
    signal?: AbortSignal
    context?: Record<string, unknown>
    skipRateLimit?: boolean
    onBytesReceived?: (bytesReceived: number) => void | Promise<void>
  }
): Promise<{ data: ArrayBuffer; filename: string; mimeType: string }> {
  if (opts?.signal?.aborted) {
    throw new Error("aborted")
  }

  const { sourceUrl, metadata } = parsePublusImageTransportUrl(imageUrl)
  const trustedSourceUrl = parseTrustedComicNettaiCdnUrl(
    sourceUrl,
    "Comic Nettai PUBLUS image URL"
  ).toString()
  if (!metadata) {
    throw new Error(
      "Comic Nettai PUBLUS reconstruction metadata is missing from the image request"
    )
  }

  const { data: rawData, mimeType } = await fetchImageWithStallDetection(
    trustedSourceUrl,
    {
      integrationId: "comicnettai",
      signal: opts?.signal,
      init: { credentials: "omit" },
      rateLimitPolicy: getRateLimitPolicyFromContext(opts?.context, "image"),
      skipRateLimit: opts?.skipRateLimit,
      onBytesReceived: opts?.onBytesReceived,
      assertUrlAllowed: assertComicNettaiRequestUrl,
    }
  )
  const downloadedImage = await descramblePublusImage(
    rawData,
    mimeType,
    metadata
  )
  const filename =
    new URL(trustedSourceUrl).pathname.split("/").filter(Boolean).pop() ||
    "page.jpeg"

  return { ...downloadedImage, filename }
}
