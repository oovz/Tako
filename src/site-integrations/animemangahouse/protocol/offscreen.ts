import type { OffscreenSiteAdapter } from "@/src/types/site-integrations"
import { resolveSeriesDocument, type SignedReaderSite } from "./series"
import { ProviderContractError } from "../../provider-contract-error"
import { integrationHttpClient } from "../../http-client"
import { decodeHtmlResponse } from "@/src/shared/html-response-decoder"
import { cancelResponseBody } from "@/src/shared/response-body"
import { fetchImageWithStallDetection } from "@/src/runtime/fetch-image"
import { ChapterImagePlanSchema } from "../../chapter-plan"
import {
  assertImageUrl,
  readReaderConfiguration,
  readSignedImageResponse,
} from "./reader"

function assertOk(site: SignedReaderSite, response: Response): void {
  if (response.ok) return
  cancelResponseBody(response)
  throw Object.assign(
    new Error(`${site.name} request failed (HTTP ${response.status})`),
    { status: response.status }
  )
}

export function createSignedReaderOffscreen(
  site: SignedReaderSite
): OffscreenSiteAdapter {
  const downloadImage: OffscreenSiteAdapter["offscreen"]["chapter"]["downloadImage"] =
    async (imageUrl, opts) => {
      const url = assertImageUrl(site, imageUrl)
      const result = await fetchImageWithStallDetection(url.href, {
        integrationId: site.id,
        endpointId: `${site.id}-image`,
        signal: opts.signal,
        rateLimitPolicy: opts.runtime.rateLimitSettings.image,
        rateLimitService: opts.runtime.rateLimitService,
        skipRateLimit: opts.skipRateLimit,
        onBytesReceived: opts.onBytesReceived,
        liveResourceLedger: opts.liveResourceLedger,
        assertUrlAllowed: (value) => {
          assertImageUrl(site, value)
        },
      })
      return {
        ...result,
        filename: url.pathname.split("/").pop() || "image.jpg",
      }
    }
  return {
    offscreen: {
      name: `${site.name} Offscreen`,
      cover: { downloadImage },
      series: {
        resolveSeriesData(input) {
          return Promise.resolve(
            resolveSeriesDocument(site, input.document, input.seriesUrl)
          )
        },
      },
      chapter: {
        async resolveChapterPlan(chapter, input) {
          const url = new URL(chapter.url)
          if (
            url.origin !== site.origin ||
            url.pathname !== `/m${chapter.id}/` ||
            !/^\d+$/.test(chapter.id)
          )
            throw new ProviderContractError(
              `${site.name} chapter URL is not supported`
            )
          const request = (requestUrl: string, endpointId: string) =>
            integrationHttpClient.request({
              integrationId: site.id,
              endpointId,
              url: requestUrl,
              scope: "chapter",
              rateLimitService: input.runtime.rateLimitService,
              policyOverride: input.runtime.rateLimitSettings.chapter,
              init: { signal: input.signal },
            })
          const page = await request(url.href, `${site.id}-page`)
          assertOk(site, page)
          const { html } = await decodeHtmlResponse(page)
          const config = readReaderConfiguration(site, html, chapter.id)
          const images: string[] = []
          while (images.length < config.count) {
            input.signal?.throwIfAborted()
            const api = new URL(site.chapterEndpoint, url)
            const params: Record<string, string> = {
              cid: config.cid,
              page: String(images.length + 1),
              key: config.key,
              _cid: config.cid,
              _mid: config.mid,
              _dt: config.date,
              _sign: config.sign,
            }
            if (site.id === "animemangahouse")
              Object.assign(params, { language: "1", gtk: "6" })
            api.search = new URLSearchParams(params).toString()
            const response = await request(api.href, `${site.id}-signed-images`)
            assertOk(site, response)
            const batch = readSignedImageResponse(site, await response.text())
            images.push(...batch.slice(0, config.count - images.length))
          }
          if (new Set(images).size !== images.length)
            throw new ProviderContractError(
              `${site.name} reader returned duplicate required pages`
            )
          return ChapterImagePlanSchema.parse({ imageUrls: images })
        },
        downloadImage(imageUrl, opts) {
          return downloadImage(imageUrl, { ...opts, skipRateLimit: true })
        },
      },
    },
  }
}
