import type {
  OffscreenSiteAdapter,
  ChapterRuntimeData,
} from "@/src/types/site-integrations"
import type { OffscreenLiveResourceLedger } from "@/src/runtime/offscreen-live-resource-ledger"
import { getRateLimitPolicyFromSnapshot } from "@/src/runtime/rate-limit"
import { fetchImageWithStallDetection } from "@/src/runtime/fetch-image"
import { cancelResponseBody } from "@/src/shared/response-body"
import { decodeHtmlResponse } from "@/src/shared/html-response-decoder"
import { integrationHttpClient } from "../http-client"
import {
  assertBoyloveImageUrl,
  assertBoylovePageUrl,
  resolveBoyloveSeries,
} from "./series-dom"
import { parseBoyloveReader, readBoyloveImageLayout } from "./chapter-reader"
import { reconstructBoyloveImage } from "./image-reconstruction"

type ImageOptions = {
  runtime: ChapterRuntimeData
  signal?: AbortSignal
  skipRateLimit?: boolean
  onBytesReceived?: (bytesReceived: number) => void | Promise<void>
  liveResourceLedger: OffscreenLiveResourceLedger
}

async function downloadImage(sourceUrl: URL, opts: ImageOptions) {
  return fetchImageWithStallDetection(sourceUrl.href, {
    ...opts,
    integrationId: "boylove",
    endpointId: "boylove-image",
    rateLimitPolicy: opts.runtime.rateLimitSettings.image,
    rateLimitService: opts.runtime.rateLimitService,
    assertUrlAllowed: (value) => {
      assertBoyloveImageUrl(value)
    },
  })
}

export const offscreenSiteAdapter: OffscreenSiteAdapter = {
  offscreen: {
    name: "BoyLove Offscreen",
    series: {
      resolveSeriesData({ document }) {
        return Promise.resolve().then(() => resolveBoyloveSeries(document))
      },
    },
    cover: {
      async downloadImage(imageUrl, opts) {
        const url = assertBoyloveImageUrl(imageUrl)
        const image = await downloadImage(url, opts)
        return {
          ...image,
          filename: url.pathname.split("/").at(-1) || "cover.webp",
        }
      },
    },
    chapter: {
      async resolveChapterPlan(chapter, input) {
        const url = assertBoylovePageUrl(chapter.url, "capter")
        if (url.pathname.split("/").filter(Boolean).at(-1) !== chapter.id)
          throw new Error("BoyLove chapter identity does not match its URL.")
        const response = await integrationHttpClient.request({
          integrationId: "boylove",
          endpointId: "boylove-page",
          url: url.href,
          scope: "chapter",
          rateLimitService: input.runtime.rateLimitService,
          policyOverride: getRateLimitPolicyFromSnapshot(
            input.settings,
            "chapter"
          ),
          init: { signal: input.signal },
        })
        if (!response.ok) {
          cancelResponseBody(response)
          throw Object.assign(
            new Error(
              `BoyLove reader request failed (HTTP ${response.status}).`
            ),
            { status: response.status }
          )
        }
        const { html } = await decodeHtmlResponse(response)
        return parseBoyloveReader(html)
      },
      async downloadImage(imageUrl, opts) {
        const url = assertBoyloveImageUrl(imageUrl)
        const layout = readBoyloveImageLayout(url)
        url.hash = ""
        const image = await downloadImage(url, { ...opts, skipRateLimit: true })
        const reconstructed = await reconstructBoyloveImage(
          image.data,
          image.mimeType,
          layout,
          opts.signal,
          opts.liveResourceLedger,
          image.liveResourceLease
        )
        return {
          ...reconstructed,
          filename:
            (url.pathname.split("/").at(-1) || "image").replace(
              /\.[^.]*$/,
              ""
            ) + ".png",
        }
      },
    },
  },
}
