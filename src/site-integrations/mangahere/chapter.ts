import type { OffscreenIntegration } from "@/src/types/site-integrations"
import { integrationHttpClient } from "../http-client"
import { cancelResponseBody } from "@/src/shared/response-body"
import { decodeHtmlResponse } from "@/src/shared/html-response-decoder"
import { ProviderContractError } from "../provider-contract-error"
import {
  mangaHereUrl,
  mangaHereImage,
  parseMangaHerePackedImages,
} from "./reader"
export const imageUrl = mangaHereImage
export const resolveChapterPlan: OffscreenIntegration["chapter"]["resolveChapterPlan"] =
  async (chapter, input) => {
    const url = mangaHereUrl(chapter.url)
    const route = url.pathname.match(
      /^\/manga\/([^/]+\/(?:v[0-9]+\/)?c[^/]+)\/(?:1\.html)?$/
    )
    if (!route)
      throw new ProviderContractError("MangaHere chapter URL is malformed")
    if (route[1] !== chapter.id)
      throw new ProviderContractError(
        "MangaHere selected chapter identity does not match its URL"
      )
    const response = await integrationHttpClient.request({
      integrationId: "mangahere",
      endpointId: "mangahere-page",
      url: url.href,
      scope: "chapter",
      rateLimitService: input.runtime.rateLimitService,
      init: { signal: input.signal },
    })
    if (!response.ok) {
      cancelResponseBody(response)
      throw Object.assign(
        new Error(`MangaHere reader request failed (HTTP ${response.status})`),
        { status: response.status }
      )
    }
    const { html } = await decodeHtmlResponse(response)
    return { imageUrls: parseMangaHerePackedImages(html) }
  }
