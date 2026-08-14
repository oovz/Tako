import type {
  OffscreenIntegration,
  OffscreenSiteAdapter,
} from "@/src/types/site-integrations"
import { ChapterImagePlanSchema } from "../chapter-plan"
import logger from "@/src/runtime/logger"
import { fetchImageWithStallDetection } from "@/src/runtime/fetch-image"
import { getRateLimitPolicyFromSnapshot } from "@/src/runtime/rate-limit"
import { integrationHttpClient } from "../http-client"
import { decodeHtmlResponse } from "@/src/shared/html-response-decoder"
import { extractImageUrlsFromEpisodeJsonScript } from "./episode-json"
import { descrambleGigaviewerImage } from "./gigaviewer-image"
import { createIntegrationEndpointUrlAssertion } from "../request-policy"
import { ProviderContractError } from "../provider-contract-error"
import {
  isScrambledShonenJumpPlusPageUrl,
  isTrustedShonenJumpPlusAssetUrl,
  parseTrustedShonenJumpPlusEpisodeUrl,
} from "./urls"
import type {
  OffscreenLiveResourceLedger,
  OffscreenLiveResourceLease,
} from "@/src/runtime/offscreen-live-resource-ledger"

const PUBLIC_FETCH_INIT: RequestInit = { credentials: "omit" }
const assertShonenJumpPlusImageUrl = createIntegrationEndpointUrlAssertion(
  "shonenjumpplus",
  "shonenjumpplus-image-cdn"
)

async function downloadShonenJumpPlusCoverImage(
  imageUrl: string,
  opts: {
    signal?: AbortSignal
    runtime: import("@/src/types/site-integrations").ChapterRuntimeData
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
  if (!isTrustedShonenJumpPlusAssetUrl(imageUrl)) {
    throw new ProviderContractError(
      "Invalid or untrusted Shonen Jump+ cover URL."
    )
  }
  const { data, mimeType, liveResourceLease } =
    await fetchImageWithStallDetection(imageUrl, {
      integrationId: "shonenjumpplus",
      endpointId: "shonenjumpplus-image-cdn",
      signal: opts.signal,
      init: PUBLIC_FETCH_INIT,
      skipRateLimit: opts.skipRateLimit,
      rateLimitService: opts.runtime.rateLimitService,
      onBytesReceived: opts.onBytesReceived,
      assertUrlAllowed: assertShonenJumpPlusImageUrl,
      liveResourceLedger: opts.liveResourceLedger,
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

function requireTrustedEpisodeUrl(input: string): URL {
  const trusted = parseTrustedShonenJumpPlusEpisodeUrl(input)
  if (!trusted) {
    throw new ProviderContractError(
      "Invalid or untrusted Shonen Jump+ episode URL."
    )
  }
  return trusted.url
}

function trustedPageUrls(html: string): string[] {
  const imageUrls = extractImageUrlsFromEpisodeJsonScript(html)
  for (const imageUrl of imageUrls) {
    if (!isTrustedShonenJumpPlusAssetUrl(imageUrl)) {
      throw new ProviderContractError(
        "Shonen Jump+ episode data contains an untrusted page image URL."
      )
    }
  }
  return imageUrls
}

const offscreen: OffscreenIntegration = {
  name: "Shonen Jump+ Offscreen",
  cover: {
    downloadImage: downloadShonenJumpPlusCoverImage,
  },
  chapter: {
    async resolveChapterPlan(chapter, input) {
      const chapterUrl = requireTrustedEpisodeUrl(chapter.url)
      const response = await integrationHttpClient.request({
        integrationId: "shonenjumpplus",
        endpointId: "shonenjumpplus-episode-html",
        url: chapterUrl.href,
        scope: "chapter",
        init: { ...PUBLIC_FETCH_INIT, signal: input.signal },
        rateLimitService: input.runtime.rateLimitService,
        policyOverride: getRateLimitPolicyFromSnapshot(
          input.settings,
          "chapter"
        ),
      })
      if (!response.ok) {
        throw Object.assign(
          new Error(
            `Shonen Jump+ chapter page could not be loaded (HTTP ${response.status}).`
          ),
          { status: response.status }
        )
      }
      const { html } = await decodeHtmlResponse(response)
      const urls = trustedPageUrls(html)
      if (urls.length === 0) {
        throw new ProviderContractError(
          "Shonen Jump+ episode data contained no trusted readable page images."
        )
      }
      logger.debug("[shonenjumpplus] Resolved trusted episode page images", {
        chapterId: chapter.id,
        urlCount: urls.length,
      })
      return ChapterImagePlanSchema.parse({ imageUrls: urls })
    },

    async downloadImage(imageUrl, opts) {
      if (!isTrustedShonenJumpPlusAssetUrl(imageUrl)) {
        throw new ProviderContractError(
          "Invalid or untrusted Shonen Jump+ asset URL."
        )
      }
      if (opts.signal?.aborted) throw new Error("aborted")
      const { data, mimeType, liveResourceLease } =
        await fetchImageWithStallDetection(imageUrl, {
          integrationId: "shonenjumpplus",
          endpointId: "shonenjumpplus-image-cdn",
          signal: opts.signal,
          init: PUBLIC_FETCH_INIT,
          rateLimitPolicy: opts.runtime.rateLimitSettings.image,
          rateLimitService: opts.runtime.rateLimitService,
          skipRateLimit: true,
          onBytesReceived: opts.onBytesReceived,
          assertUrlAllowed: assertShonenJumpPlusImageUrl,
          liveResourceLedger: opts.liveResourceLedger,
        })
      const downloaded = isScrambledShonenJumpPlusPageUrl(imageUrl)
        ? await descrambleGigaviewerImage(
            data,
            mimeType,
            opts.signal,
            opts.liveResourceLedger,
            liveResourceLease
          )
        : { data, mimeType, liveResourceLease }
      const filename =
        new URL(imageUrl).pathname.split("/").filter(Boolean).pop() ||
        "image.jpg"
      return { ...downloaded, filename }
    },
  },
}

export const offscreenSiteAdapter: OffscreenSiteAdapter = {
  id: "shonenjumpplus",
  offscreen,
}
