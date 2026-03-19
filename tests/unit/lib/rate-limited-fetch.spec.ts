import { describe, expect, it, vi } from 'vitest'

import { rateLimitedFetchByUrlScope } from '@/src/shared/rate-limited-fetch'

vi.mock('@/src/runtime/rate-limit', () => ({
  rateLimitedFetchByUrlScope: vi.fn(),
}))

describe('rate-limited-fetch bridge', () => {
  it('delegates to core rate limiter with the same arguments', async () => {
    const coreModule = await import('@/src/runtime/rate-limit')
    const coreRateLimitedFetch = vi.mocked(coreModule.rateLimitedFetchByUrlScope)

    const response = new Response('ok', { status: 200 })
    coreRateLimitedFetch.mockResolvedValueOnce(response)

    const init: RequestInit = { method: 'GET' }
    const result = await rateLimitedFetchByUrlScope('https://example.com/image.jpg', 'image', init)

    expect(coreRateLimitedFetch).toHaveBeenCalledWith('https://example.com/image.jpg', 'image', init)
    expect(result).toBe(response)
  })
})

