import type {
  OffscreenIntegration,
  OffscreenSiteAdapter,
  ParseImageUrlsFromHtmlInput,
} from "@/src/types/site-integrations"
import logger from "@/src/runtime/logger"
import { fetchImageWithStallDetection } from "@/src/runtime/fetch-image"
import {
  getRateLimitPolicyFromContext,
  getRateLimitPolicyFromSnapshot,
  rateLimitedFetchForIntegration,
} from "@/src/runtime/rate-limit"
import { decodeHtmlResponse } from "@/src/shared/html-response-decoder"
import { extractImageUrlsFromEpisodeJsonScript } from "./episode-json"
import { descrambleGigaviewerImage } from "./gigaviewer-image"
import { createIntegrationUrlAssertion } from "../request-policy"
import { ProviderContractError } from "../provider-contract-error"
import {
  isScrambledShonenJumpPlusPageUrl,
  isTrustedShonenJumpPlusAssetUrl,
  parseTrustedShonenJumpPlusEpisodeUrl,
} from "./urls"

const PUBLIC_FETCH_INIT: RequestInit = { credentials: "omit" }
const assertShonenJumpPlusRequestUrl =
  createIntegrationUrlAssertion("shonenjumpplus")

function requireTrustedEpisodeUrl(input: string): URL {
  const trusted = parseTrustedShonenJumpPlusEpisodeUrl(input)
  if (!trusted) {
    throw new Error("Invalid or untrusted Shonen Jump+ episode URL.")
  }
  return trusted.url
}

function trustedPageUrls(html: string): string[] {
  return extractImageUrlsFromEpisodeJsonScript(html).filter(
    isTrustedShonenJumpPlusAssetUrl
  )
}

const offscreen: OffscreenIntegration = {
  name: "Shonen Jump+ Offscreen",
  chapter: {
    async resolveImageUrls(
      chapter,
      _context,
      settingsSnapshot
    ): Promise<string[]> {
      const chapterUrl = requireTrustedEpisodeUrl(chapter.url)
      const response = await rateLimitedFetchForIntegration(
        "shonenjumpplus",
        chapterUrl.href,
        "chapter",
        PUBLIC_FETCH_INIT,
        getRateLimitPolicyFromSnapshot(settingsSnapshot, "chapter")
      )
      if (!response.ok) {
        throw new Error(
          `Shonen Jump+ chapter page could not be loaded (HTTP ${response.status}).`
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
      return urls
    },

    parseImageUrlsFromHtml({
      chapterHtml,
      chapterUrl,
    }: ParseImageUrlsFromHtmlInput): Promise<string[]> {
      requireTrustedEpisodeUrl(chapterUrl)
      const urls = trustedPageUrls(chapterHtml)
      if (urls.length === 0) {
        return Promise.reject(
          new ProviderContractError(
            "Shonen Jump+ episode data contained no trusted readable page images."
          )
        )
      }
      return Promise.resolve(urls)
    },

    processImageUrls(urls: string[]): Promise<string[]> {
      return Promise.resolve(urls.filter(isTrustedShonenJumpPlusAssetUrl))
    },

    async downloadImage(imageUrl, opts) {
      if (!isTrustedShonenJumpPlusAssetUrl(imageUrl)) {
        throw new Error("Invalid or untrusted Shonen Jump+ asset URL.")
      }
      if (opts?.signal?.aborted) throw new Error("aborted")
      const { data, mimeType } = await fetchImageWithStallDetection(imageUrl, {
        integrationId: "shonenjumpplus",
        signal: opts?.signal,
        init: PUBLIC_FETCH_INIT,
        rateLimitPolicy: getRateLimitPolicyFromContext(opts?.context, "image"),
        skipRateLimit: true,
        onBytesReceived: opts?.onBytesReceived,
        assertUrlAllowed: assertShonenJumpPlusRequestUrl,
      })
      const downloaded = isScrambledShonenJumpPlusPageUrl(imageUrl)
        ? await descrambleGigaviewerImage(data, mimeType)
        : { data, mimeType }
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
