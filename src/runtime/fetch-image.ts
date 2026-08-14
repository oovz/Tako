import {
  fetchImageWithStallDetection as fetchImageWithStallDetectionCore,
  type FetchedImageData,
  type FetchImageWithStallDetectionCoreOptions,
} from "@/src/runtime/fetch-image-core"
import {
  type EffectivePolicy,
  type RateLimitService,
} from "@/src/runtime/rate-limit"
import {
  fetchSharedResource,
  integrationHttpClient,
} from "@/src/site-integrations/http-client"

type SharedFetchImageWithStallDetectionOptions =
  FetchImageWithStallDetectionCoreOptions & {
    integrationId?: never
    endpointId?: never
    rateLimitPolicy?: never
    rateLimitService?: never
    skipRateLimit?: never
  }

type IntegrationFetchImageWithStallDetectionOptions =
  FetchImageWithStallDetectionCoreOptions & {
    integrationId: string
    endpointId: string
    rateLimitPolicy?: EffectivePolicy
    rateLimitService: RateLimitService
    skipRateLimit?: boolean
  }

export type FetchImageWithStallDetectionOptions =
  | SharedFetchImageWithStallDetectionOptions
  | IntegrationFetchImageWithStallDetectionOptions

export async function fetchImageWithStallDetection(
  imageUrl: string,
  options: FetchImageWithStallDetectionOptions = {}
): Promise<FetchedImageData> {
  const effectiveFetcher =
    options.fetcher ??
    ((url: string, init: RequestInit) => {
      if (options.integrationId === undefined) {
        return fetchSharedResource(url, init)
      }
      return integrationHttpClient.request({
        integrationId: options.integrationId,
        endpointId: options.endpointId,
        url,
        scope: "image",
        rateLimitService: options.rateLimitService,
        init,
        policyOverride: options.rateLimitPolicy,
        skipRateLimit: options.skipRateLimit,
      })
    })

  return fetchImageWithStallDetectionCore(imageUrl, {
    ...options,
    fetcher: effectiveFetcher,
  })
}
