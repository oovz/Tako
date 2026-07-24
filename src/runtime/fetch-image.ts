import {
  fetchImageWithStallDetection as fetchImageWithStallDetectionCore,
  type FetchImageWithStallDetectionCoreOptions,
} from "@/src/runtime/fetch-image-core"
import {
  rateLimitedFetchForIntegration,
  rateLimitedFetchByUrlScope,
  type EffectivePolicy,
} from "@/src/runtime/rate-limit"

export interface FetchImageWithStallDetectionOptions extends FetchImageWithStallDetectionCoreOptions {
  integrationId?: string
  rateLimitPolicy?: EffectivePolicy
  skipRateLimit?: boolean
}

export async function fetchImageWithStallDetection(
  imageUrl: string,
  options: FetchImageWithStallDetectionOptions = {}
): Promise<{ data: ArrayBuffer; mimeType: string }> {
  const {
    integrationId,
    rateLimitPolicy,
    skipRateLimit,
    fetcher,
    ...coreOptions
  } = options
  const effectiveFetcher =
    fetcher ??
    ((url: string, init: RequestInit) =>
      skipRateLimit
        ? fetch(url, init)
        : integrationId
          ? rateLimitedFetchForIntegration(
              integrationId,
              url,
              "image",
              init,
              rateLimitPolicy
            )
          : rateLimitedFetchByUrlScope(url, "image", init, rateLimitPolicy))

  return fetchImageWithStallDetectionCore(imageUrl, {
    ...coreOptions,
    fetcher: effectiveFetcher,
  })
}
