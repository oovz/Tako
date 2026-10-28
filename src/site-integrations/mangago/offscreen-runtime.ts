import type {
  OffscreenIntegration,
  OffscreenSiteAdapter,
} from "@/src/types/site-integrations"
import { integrationHttpClient } from "../http-client"
import { cancelResponseBody } from "@/src/shared/response-body"
import {
  decodeHtmlResponse,
  readResponseText,
} from "@/src/shared/html-response-decoder"
import { fetchImageWithStallDetection } from "@/src/runtime/fetch-image"
import { ChapterImagePlanSchema } from "../chapter-plan"
import { ProviderContractError } from "../provider-contract-error"
import { parseMangagoSeries } from "./series-dom"
import { assertMangagoImageUrl, parseMangagoUrl } from "./shared"
import {
  decodeMangagoImageList,
  parseMangagoProtocol,
  parseMangagoReader,
  withMangagoGrid,
} from "./reader"
import {
  parseMangagoImageTransport,
  reconstructMangagoImage,
} from "./grid-image"

const downloadImage: OffscreenIntegration["chapter"]["downloadImage"] = async (
  imageUrl,
  opts
) => {
  const { sourceUrl, columns, grid } = parseMangagoImageTransport(imageUrl)
  assertMangagoImageUrl(sourceUrl)
  const result = await fetchImageWithStallDetection(sourceUrl, {
    integrationId: "mangago",
    endpointId: "mangago-image",
    signal: opts.signal,
    rateLimitService: opts.runtime.rateLimitService,
    rateLimitPolicy: opts.runtime.rateLimitSettings.image,
    skipRateLimit: true,
    onBytesReceived: opts.onBytesReceived,
    assertUrlAllowed: assertMangagoImageUrl,
    init: { credentials: "omit" },
    liveResourceLedger: opts.liveResourceLedger,
  })
  const filename = new URL(sourceUrl).pathname.split("/").pop()!
  if (!grid || !columns) return { ...result, filename }
  const reconstructed = await reconstructMangagoImage(
    result.data,
    result.mimeType,
    columns,
    grid,
    opts.signal,
    opts.liveResourceLedger,
    result.liveResourceLease
  )
  return { ...reconstructed, filename: filename.replace(/\.[^.]+$/, ".png") }
}
const offscreen: OffscreenIntegration = {
  name: "Mangago Offscreen",
  series: {
    resolveSeriesData({ document, seriesUrl }) {
      return Promise.resolve(parseMangagoSeries(document, seriesUrl))
    },
  },
  cover: { downloadImage },
  chapter: {
    async resolveChapterPlan(chapter, input) {
      if (parseMangagoUrl(chapter.url).chapterId !== chapter.id)
        throw new ProviderContractError(
          "Mangago selected chapter does not match its URL"
        )
      const request = async (url: string, script = false) => {
        input.signal?.throwIfAborted()
        const response = await integrationHttpClient.request({
          integrationId: "mangago",
          endpointId: script ? "mangago-script" : "mangago-page",
          url,
          scope: "chapter",
          rateLimitService: input.runtime.rateLimitService,
          policyOverride: input.runtime.rateLimitSettings.chapter,
          init: {
            credentials: script ? "omit" : "include",
            signal: input.signal,
          },
        })
        if (!response.ok) {
          cancelResponseBody(response)
          throw Object.assign(
            new Error(
              `Mangago reader request failed (HTTP ${response.status})`
            ),
            { status: response.status }
          )
        }
        return script
          ? readResponseText(response, 2_000_000)
          : (
              await decodeHtmlResponse(response, {
                // Viewer scripts precede its explicit charset declaration.
                scanByteLimit: 64 * 1024,
              })
            ).html
      }
      const first = parseMangagoReader(
        new DOMParser().parseFromString(
          await request(chapter.url),
          "text/html"
        ),
        chapter.url
      )
      const protocol = parseMangagoProtocol(
        await request(first.scriptUrl, true)
      )
      const entries = await decodeMangagoImageList(
        first.encryptedImages,
        protocol
      )
      const imageUrls: string[] = []
      for (let index = 0; index < first.totalPages; index++) {
        let source = entries[index]?.trim()
        if (!source) {
          const url = first.pageUrl(index + 1)
          const reader = parseMangagoReader(
            new DOMParser().parseFromString(await request(url), "text/html"),
            url
          )
          if (
            reader.totalPages !== first.totalPages ||
            reader.currentPage !== index + 1 ||
            reader.scriptUrl !== first.scriptUrl
          )
            throw new ProviderContractError(
              "Mangago reader page sequence changed"
            )
          const batch = await decodeMangagoImageList(
            reader.encryptedImages,
            protocol
          )
          for (let position = index; position < first.totalPages; position++)
            if (batch[position]?.trim()) entries[position] = batch[position]!
          source = entries[index]?.trim()
        }
        if (!source)
          throw new ProviderContractError(
            `Mangago required page ${index + 1} is unavailable`
          )
        imageUrls.push(withMangagoGrid(source, protocol))
      }
      return ChapterImagePlanSchema.parse({ imageUrls })
    },
    downloadImage,
  },
}
export const offscreenSiteAdapter: OffscreenSiteAdapter = { offscreen }
