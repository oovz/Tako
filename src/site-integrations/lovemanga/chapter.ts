import type { OffscreenIntegration } from "@/src/types/site-integrations"
import { integrationHttpClient } from "../http-client"
import { cancelResponseBody } from "@/src/shared/response-body"
import { decodeHtmlResponse } from "@/src/shared/html-response-decoder"
import { aimanhuaPage, aimanhuaImage, decodeAimanhuaImages } from "./reader"
import { ProviderContractError } from "../provider-contract-error"
export const imageUrl = aimanhuaImage
export const resolveChapterPlan: OffscreenIntegration["chapter"]["resolveChapterPlan"] =
  async (chapter, input) => {
    const url = aimanhuaPage(chapter.url)
    const chapterId = url.pathname.match(/^\/chapter\/\d+\/(\d+)$/)?.[1]
    if (!chapterId || chapterId !== chapter.id)
      throw new ProviderContractError(
        "Aimanhua selected chapter identity does not match its reader URL"
      )
    const response = await integrationHttpClient.request({
      integrationId: "lovemanga",
      endpointId: "lovemanga-page",
      url: url.href,
      scope: "chapter",
      rateLimitService: input.runtime.rateLimitService,
      init: { signal: input.signal },
    })
    if (!response.ok) {
      cancelResponseBody(response)
      throw Object.assign(
        new Error(`Aimanhua reader request failed (HTTP ${response.status})`),
        { status: response.status }
      )
    }
    const { html } = await decodeHtmlResponse(response)
    return { imageUrls: await decodeAimanhuaImages(html, url.href) }
  }
