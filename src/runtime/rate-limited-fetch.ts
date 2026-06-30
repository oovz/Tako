import type { RateScope } from '@/src/runtime/rate-limit'
import { rateLimitedFetchByUrlScope as coreRateLimitedFetchByUrlScope } from '@/src/runtime/rate-limit'

export async function rateLimitedFetchByUrlScope(
  url: string,
  scope: RateScope,
  init?: RequestInit,
): Promise<Response> {
  return coreRateLimitedFetchByUrlScope(url, scope, init)
}

