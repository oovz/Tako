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
import type {
  OffscreenLiveResourceLease,
  OffscreenLiveResourceLedger,
} from "@/src/runtime/offscreen-live-resource-ledger"

type SharedFetchImageWithStallDetectionOptions = Omit<
  FetchImageWithStallDetectionCoreOptions,
  | "integrationId"
  | "endpointId"
  | "rateLimitPolicy"
  | "rateLimitService"
  | "skipRateLimit"
> & {
  integrationId?: never
  endpointId?: never
  rateLimitPolicy?: never
  rateLimitService?: never
  skipRateLimit?: never
  liveResourceLedger: OffscreenLiveResourceLedger
}

type IntegrationFetchImageWithStallDetectionOptions = Omit<
  FetchImageWithStallDetectionCoreOptions,
  "liveResourceLedger"
> & {
  integrationId: string
  endpointId: string
  rateLimitPolicy?: EffectivePolicy
  rateLimitService: RateLimitService
  skipRateLimit?: boolean
  liveResourceLedger: OffscreenLiveResourceLedger
}

export type FetchImageWithStallDetectionOptions =
  | SharedFetchImageWithStallDetectionOptions
  | IntegrationFetchImageWithStallDetectionOptions

export type OwnedFetchedImageData = FetchedImageData & {
  liveResourceLease: OffscreenLiveResourceLease
}

export async function fetchImageWithStallDetection(
  imageUrl: string,
  options: FetchImageWithStallDetectionOptions
): Promise<OwnedFetchedImageData> {
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

  const result = await fetchImageWithStallDetectionCore(imageUrl, {
    ...options,
    fetcher: effectiveFetcher,
  })
  if (!result.liveResourceLease) {
    throw new Error(
      "Integration image transport must return an owned live-resource lease"
    )
  }
  return result as OwnedFetchedImageData
}
