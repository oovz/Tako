import {
  fetchImageWithStallDetection as fetchImageWithStallDetectionCore,
  type FetchImageWithStallDetectionCoreOptions,
} from '@/src/runtime/fetch-image-core'
import { rateLimitedFetchByUrlScope, type EffectivePolicy } from '@/src/runtime/rate-limit'

export interface FetchImageWithStallDetectionOptions extends FetchImageWithStallDetectionCoreOptions {
  rateLimitPolicy?: EffectivePolicy
  skipRateLimit?: boolean
}

export async function fetchImageWithStallDetection(
  imageUrl: string,
  options: FetchImageWithStallDetectionOptions = {},
): Promise<{ data: ArrayBuffer; mimeType: string }> {
  const { rateLimitPolicy, skipRateLimit, fetcher, ...coreOptions } = options
  const effectiveFetcher = fetcher ?? ((url: string, init: RequestInit) => (
    skipRateLimit
      ? fetch(url, init)
      : rateLimitedFetchByUrlScope(url, 'image', init, rateLimitPolicy)
  ))

  return fetchImageWithStallDetectionCore(imageUrl, {
    ...coreOptions,
    fetcher: effectiveFetcher,
  })
}
