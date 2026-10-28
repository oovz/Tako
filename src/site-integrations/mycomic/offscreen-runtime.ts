import type {
  OffscreenIntegration,
  OffscreenSiteAdapter,
} from "@/src/types/site-integrations"
import { integrationHttpClient } from "../http-client"
import { cancelResponseBody } from "@/src/shared/response-body"
import { decodeHtmlResponse } from "@/src/shared/html-response-decoder"
import { fetchImageWithStallDetection } from "@/src/runtime/fetch-image"
import { parseMyComicSeries } from "./series-dom"
import { parseMyComicChapterImages } from "./reader"
import { assertMyComicImageUrl, parseMyComicUrl } from "./shared"

const downloadImage: OffscreenIntegration["chapter"]["downloadImage"] = async (
  imageUrl,
  opts
) => {
  assertMyComicImageUrl(imageUrl)
  const result = await fetchImageWithStallDetection(imageUrl, {
    integrationId: "mycomic",
    endpointId: "mycomic-image",
    signal: opts.signal,
    rateLimitService: opts.runtime.rateLimitService,
    rateLimitPolicy: opts.runtime.rateLimitSettings.image,
    skipRateLimit: true,
    onBytesReceived: opts.onBytesReceived,
    assertUrlAllowed: assertMyComicImageUrl,
    init: { credentials: "omit" },
    liveResourceLedger: opts.liveResourceLedger,
  })
  return { ...result, filename: new URL(imageUrl).pathname.split("/").pop()! }
}
const offscreen: OffscreenIntegration = {
  name: "MyComic Offscreen",
  series: {
    resolveSeriesData({ document, seriesUrl }) {
      return Promise.resolve(parseMyComicSeries(document, seriesUrl))
    },
  },
  cover: { downloadImage },
  chapter: {
    async resolveChapterPlan(chapter, input) {
      const { id } = parseMyComicUrl(chapter.url, "chapters")
      if (id !== chapter.id)
        throw new Error(
          "MyComic selected chapter identity does not match its URL"
        )
      const response = await integrationHttpClient.request({
        integrationId: "mycomic",
        endpointId: "mycomic-page",
        url: chapter.url,
        scope: "chapter",
        rateLimitService: input.runtime.rateLimitService,
        policyOverride: input.runtime.rateLimitSettings.chapter,
        init: { credentials: "include", signal: input.signal },
      })
      if (!response.ok) {
        cancelResponseBody(response)
        throw Object.assign(
          new Error(`MyComic reader request failed (HTTP ${response.status})`),
          { status: response.status }
        )
      }
      const { html } = await decodeHtmlResponse(response)
      return {
        imageUrls: parseMyComicChapterImages(
          new DOMParser().parseFromString(html, "text/html"),
          id
        ),
      }
    },
    downloadImage,
  },
}
export const offscreenSiteAdapter: OffscreenSiteAdapter = { offscreen }
