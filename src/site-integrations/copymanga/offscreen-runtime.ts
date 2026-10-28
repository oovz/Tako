import {
  CopyCatalogResponseSchema,
  CopyCatalogSelectorSchema,
} from "./contracts/api"
import type {
  OffscreenIntegration,
  OffscreenSiteAdapter,
} from "@/src/types/site-integrations"
import { fetchImageWithStallDetection } from "@/src/runtime/fetch-image"
import {
  decodeHtmlResponse,
  readResponseJson,
} from "@/src/shared/html-response-decoder"
import { cancelResponseBody } from "@/src/shared/response-body"
import { integrationHttpClient } from "../http-client"
import { ProviderContractError } from "../provider-contract-error"
import {
  decodeCopyPayload,
  normalizeCopyImageUrl,
  parseCopyChapterCatalog,
  parseCopyReader,
  parseCopyUrl,
  readCopyKey,
} from "./api"

const downloadImage: OffscreenIntegration["chapter"]["downloadImage"] = async (
  imageUrl,
  opts
) => {
  const result = await fetchImageWithStallDetection(imageUrl, {
    integrationId: "copymanga",
    endpointId: "copy-image",
    rateLimitService: opts.runtime.rateLimitService,
    skipRateLimit: true,
    signal: opts.signal,
    onBytesReceived: opts.onBytesReceived,
    liveResourceLedger: opts.liveResourceLedger,
  })
  return {
    ...result,
    filename: new URL(imageUrl).pathname.split("/").pop() || "page.jpg",
  }
}

function assertSuccess(response: Response): void {
  if (!response.ok) {
    cancelResponseBody(response)
    throw Object.assign(
      new Error(`Copy request failed (HTTP ${response.status})`),
      { status: response.status }
    )
  }
}

export const offscreenSiteAdapter: OffscreenSiteAdapter = {
  offscreen: {
    name: "Copy Offscreen",
    cover: { downloadImage },
    series: {
      async resolveSeriesData(input) {
        const route = parseCopyUrl(input.seriesUrl)
        const title = input.document
          .querySelector(".comicParticulars-title h6")
          ?.textContent?.trim()
        if (!title)
          throw new ProviderContractError("Copy series metadata is unavailable")
        const cover =
          input.document
            .querySelector(".comicParticulars-left-img img")
            ?.getAttribute("data-src") ??
          input.document
            .querySelector(".comicParticulars-left-img img")
            ?.getAttribute("src")
        const seriesMetadata = {
          title,
          coverUrl: cover ? normalizeCopyImageUrl(cover) : undefined,
          description: input.document
            .querySelector(".intro")
            ?.textContent?.trim(),
          author: [
            ...new Set(
              Array.from(input.document.querySelectorAll('a[href^="/author/"]'))
                .map((a) => a.textContent?.trim())
                .filter(Boolean)
            ),
          ].join(", "),
          genres: [
            ...new Set(
              Array.from(
                input.document.querySelectorAll(".comicParticulars-tag a[href]")
              )
                .map((link) => link.textContent?.trim().replace(/^#\s*/, ""))
                .filter((value): value is string => Boolean(value))
            ),
          ],
          language: "zh",
        }
        const selector = CopyCatalogSelectorSchema.safeParse(
          input.document.querySelector("#dnt")?.getAttribute("value")
        )
        if (!selector.success)
          throw new ProviderContractError(
            "Copy catalog request metadata is unavailable"
          )
        const response = await integrationHttpClient.request({
          integrationId: "copymanga",
          endpointId: "copy-catalog",
          url: new URL(`/comicdetail/${route.slug}/chapters`, route.url.origin)
            .href,
          scope: "chapter",
          rateLimitService: input.rateLimitService,
          init: {
            credentials: "include",
            signal: input.signal,
            headers: {
              "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
              dnts: selector.data,
            },
          },
        })
        assertSuccess(response)
        const result = CopyCatalogResponseSchema.parse(
          await readResponseJson(response)
        )
        if (result.code !== 200 || !result.results)
          throw new ProviderContractError("Copy chapter catalog is unavailable")
        const chapterList = parseCopyChapterCatalog(
          await decodeCopyPayload(
            result.results,
            readCopyKey(input.html, "ccz")
          ),
          route.url
        )
        return { seriesId: route.slug, seriesMetadata, chapterList }
      },
    },
    chapter: {
      async resolveChapterPlan(chapter, input) {
        const route = parseCopyUrl(chapter.url)
        if (!route.chapterId || route.chapterId !== chapter.id)
          throw new ProviderContractError("Copy chapter route is unavailable")
        const response = await integrationHttpClient.request({
          integrationId: "copymanga",
          endpointId: "copy-page",
          url: route.url.href,
          scope: "chapter",
          rateLimitService: input.runtime.rateLimitService,
          init: { credentials: "include", signal: input.signal },
        })
        assertSuccess(response)
        const { html } = await decodeHtmlResponse(response)
        return { imageUrls: await parseCopyReader(html) }
      },
      downloadImage,
    },
  },
}
