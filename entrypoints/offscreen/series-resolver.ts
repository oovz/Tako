import { isEnabled } from "@/src/site-integrations/catalog"
import { offscreenSiteAdaptersById } from "@/src/runtime/generated/site-integration-offscreen-registry"
import { loadOffscreenSiteIntegrationEnablement } from "@/src/runtime/site-integration-offscreen-initialization"
import type {
  RuntimeMessageRequest,
  RuntimeMessageResponse,
} from "@/src/runtime/runtime-message-contracts"
import type { RateLimitService } from "@/src/runtime/rate-limit"

export type OffscreenParseSeriesHtmlPayload =
  RuntimeMessageRequest<"OFFSCREEN_PARSE_SERIES_HTML">["payload"]
export type OffscreenParseSeriesHtmlResponse =
  RuntimeMessageResponse<"OFFSCREEN_PARSE_SERIES_HTML">

export const MAX_CANCELED_SERIES_RESOLUTION_REQUESTS = 128

export class OffscreenSeriesResolver {
  readonly seriesResolutionControllers = new Map<string, AbortController>()
  private readonly canceledSeriesResolutionRequests = new Set<string>()

  constructor(
    private readonly createRateLimitService: (
      settings: OffscreenParseSeriesHtmlPayload["rateLimitSettings"]
    ) => RateLimitService
  ) {}

  getActiveCount(): number {
    return this.seriesResolutionControllers.size
  }

  /**
   * Parse a fetched series page HTML in the offscreen document using the
   * integration's DOM-based series resolver.
   */
  async parseSeriesHtml(
    request: OffscreenParseSeriesHtmlPayload
  ): Promise<OffscreenParseSeriesHtmlResponse> {
    if (this.seriesResolutionControllers.has(request.requestId)) {
      return {
        success: false,
        error: "Series HTML request identity collision",
      }
    }
    if (this.canceledSeriesResolutionRequests.delete(request.requestId)) {
      return {
        success: false,
        error: "Series HTML parsing was canceled",
      }
    }

    const controller = new AbortController()
    this.seriesResolutionControllers.set(request.requestId, controller)
    try {
      const currentEnablement = await loadOffscreenSiteIntegrationEnablement()
      if (controller.signal.aborted) {
        return {
          success: false,
          error: "Series HTML parsing was canceled",
        }
      }
      if (!isEnabled(request.siteIntegrationId, currentEnablement)) {
        return {
          success: false,
          error: `Site integration ${request.siteIntegrationId} is disabled`,
        }
      }

      const integration =
        offscreenSiteAdaptersById[request.siteIntegrationId]?.offscreen
      if (!integration?.series?.resolveSeriesData) {
        return {
          success: false,
          error: `Site integration ${request.siteIntegrationId} does not implement offscreen series resolution`,
        }
      }

      const document = new DOMParser().parseFromString(
        request.html,
        "text/html"
      )
      if (!document.body || document.body.childElementCount === 0) {
        return {
          success: false,
          error: "Parsed series HTML document is empty",
        }
      }

      const rateLimitService = this.createRateLimitService(
        request.rateLimitSettings
      )

      const result = await integration.series.resolveSeriesData({
        requestId: request.requestId,
        seriesUrl: request.seriesUrl,
        html: request.html,
        document,
        language: request.language,
        signal: controller.signal,
        rateLimitService,
      })
      return {
        success: true,
        seriesMetadata: result.seriesMetadata,
        chapterList: result.chapterList,
        metadataError: result.metadataError,
        chapterListError: result.chapterListError,
        chapterListNotice: result.chapterListNotice,
      }
    } finally {
      if (
        this.seriesResolutionControllers.get(request.requestId) === controller
      ) {
        this.seriesResolutionControllers.delete(request.requestId)
      }
    }
  }

  cancelSeriesHtml(requestId: string): boolean {
    const controller = this.seriesResolutionControllers.get(requestId)
    if (!controller) {
      this.canceledSeriesResolutionRequests.add(requestId)
      while (
        this.canceledSeriesResolutionRequests.size >
        MAX_CANCELED_SERIES_RESOLUTION_REQUESTS
      ) {
        const oldest = this.canceledSeriesResolutionRequests
          .values()
          .next().value
        if (typeof oldest !== "string") break
        this.canceledSeriesResolutionRequests.delete(oldest)
      }
      return true
    }
    controller.abort(new Error("Series resolution was superseded"))
    return true
  }
}
