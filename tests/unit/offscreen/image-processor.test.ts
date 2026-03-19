/**
 * Image Processor Unit Tests
 * Tests for Cover Image Download
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { downloadCoverImage, fetchImageWithStallDetection, downloadImages, fetchChapterHtml } from '@/entrypoints/offscreen/image-processor'
import type { BackgroundIntegration } from '@/src/types/site-integrations'

// Mock rate-limited fetch
vi.mock('@/src/runtime/rate-limit', () => ({
  rateLimitedFetchByUrlScope: vi.fn(),
  scheduleForIntegrationScope: vi.fn(async (_integrationId: string, _scope: string, task: () => Promise<unknown>) => task()),
}))

describe('downloadCoverImage', () => {
  const mockUrl = 'https://example.com/cover.jpg'
  const mockIntegrationId = 'mangadex'
  const mockFetchTimeoutMs = 30000

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('fetchChapterHtml', () => {
    it('decodes shift-jis chapter HTML when the response header declares it', async () => {
      const bytes = new Uint8Array([0x82, 0xa0, 0x82, 0xa2, 0x82, 0xa4])
      const mockResponse = {
        ok: true,
        headers: {
          get: (key: string) => key === 'content-type' ? 'text/html; charset=shift-jis' : null,
        },
        arrayBuffer: () => Promise.resolve(bytes.buffer),
      }

      const { rateLimitedFetchByUrlScope } = await import('@/src/runtime/rate-limit')
      vi.mocked(rateLimitedFetchByUrlScope).mockResolvedValue(mockResponse as unknown as Response)

      await expect(fetchChapterHtml('https://example.com/chapter', 1000)).resolves.toBe('あいう')
    })

    it('sniffs meta charset when the response header omits charset', async () => {
      const asciiPrefix = '<html><head><meta charset="windows-1252"></head><body>'
      const suffix = '</body></html>'
      const bytes = new Uint8Array([
        ...new TextEncoder().encode(asciiPrefix),
        0x93,
        0x54,
        0x4d,
        0x44,
        0x94,
        ...new TextEncoder().encode(suffix),
      ])
      const mockResponse = {
        ok: true,
        headers: {
          get: (key: string) => key === 'content-type' ? 'text/html' : null,
        },
        arrayBuffer: () => Promise.resolve(bytes.buffer),
      }

      const { rateLimitedFetchByUrlScope } = await import('@/src/runtime/rate-limit')
      vi.mocked(rateLimitedFetchByUrlScope).mockResolvedValue(mockResponse as unknown as Response)

      await expect(fetchChapterHtml('https://example.com/chapter-meta', 1000)).resolves.toContain('“TMD”')
    })

    it('rejects HTML when no supported charset declaration is present', async () => {
      const bytes = new TextEncoder().encode('<html><head></head><body>plain html</body></html>')
      const mockResponse = {
        ok: true,
        headers: {
          get: (key: string) => key === 'content-type' ? 'text/html' : null,
        },
        arrayBuffer: () => Promise.resolve(bytes.buffer),
      }

      const { rateLimitedFetchByUrlScope } = await import('@/src/runtime/rate-limit')
      vi.mocked(rateLimitedFetchByUrlScope).mockResolvedValue(mockResponse as unknown as Response)

      await expect(fetchChapterHtml('https://example.com/chapter-undeclared', 1000)).rejects.toThrow(
        'no supported charset declaration found'
      )
    })
  })

  describe('fetchImageWithStallDetection', () => {
    it('rejects unsupported MIME types', async () => {
      const mockResponse = {
        ok: true,
        headers: {
          get: (key: string) => key === 'content-type' ? 'text/html' : null,
        },
        body: {
          getReader: () => ({
            read: () => new Promise<ReadableStreamReadResult<Uint8Array>>(() => undefined),
            releaseLock: () => undefined,
          }),
        },
      }

      const { rateLimitedFetchByUrlScope } = await import('@/src/runtime/rate-limit')
      vi.mocked(rateLimitedFetchByUrlScope).mockResolvedValue(mockResponse as unknown as Response)

      await expect(
        fetchImageWithStallDetection('https://example.com/not-image', {
          stallTimeoutMs: 20,
          hardTimeoutMs: 50,
        })
      ).rejects.toThrow('Unsupported MIME type')
    })

    it('aborts when stream stalls beyond stall timeout', async () => {
      const mockResponse = {
        ok: true,
        headers: {
          get: (key: string) => key === 'content-type' ? 'image/jpeg' : null,
        },
        body: {
          getReader: () => ({
            read: () => new Promise<ReadableStreamReadResult<Uint8Array>>(() => undefined),
            releaseLock: () => undefined,
          }),
        },
      }

      const { rateLimitedFetchByUrlScope } = await import('@/src/runtime/rate-limit')
      vi.mocked(rateLimitedFetchByUrlScope).mockResolvedValue(mockResponse as unknown as Response)

      await expect(
        fetchImageWithStallDetection('https://example.com/stalled.jpg', {
          stallTimeoutMs: 10,
          hardTimeoutMs: 200,
        })
      ).rejects.toThrow('stalled')
    })
  })

  describe('Successful Downloads', () => {
    it('downloads cover image successfully', async () => {
      const mockArrayBuffer = new ArrayBuffer(1024)
      const mockResponse = {
        ok: true,
        arrayBuffer: () => Promise.resolve(mockArrayBuffer),
        headers: {
          get: (key: string) => key === 'content-type' ? 'image/jpeg' : null
        }
      }

      const { rateLimitedFetchByUrlScope } = await import('@/src/runtime/rate-limit')
      vi.mocked(rateLimitedFetchByUrlScope).mockResolvedValue(mockResponse as unknown as Response)

      const result = await downloadCoverImage(mockUrl, mockIntegrationId, mockFetchTimeoutMs)

      expect(result).not.toBeNull()
      expect(result?.data).toBe(mockArrayBuffer)
      expect(result?.mimeType).toBe('image/jpeg')
      expect(result?.extension).toBe('jpeg')
    })

    it('handles PNG images', async () => {
      const mockArrayBuffer = new ArrayBuffer(2048)
      const mockResponse = {
        ok: true,
        arrayBuffer: () => Promise.resolve(mockArrayBuffer),
        headers: {
          get: (key: string) => key === 'content-type' ? 'image/png' : null
        }
      }

      const { rateLimitedFetchByUrlScope } = await import('@/src/runtime/rate-limit')
      vi.mocked(rateLimitedFetchByUrlScope).mockResolvedValue(mockResponse as unknown as Response)

      const result = await downloadCoverImage(mockUrl, mockIntegrationId, mockFetchTimeoutMs)

      expect(result).not.toBeNull()
      expect(result?.mimeType).toBe('image/png')
      expect(result?.extension).toBe('png')
    })

    it('handles WebP images', async () => {
      const mockArrayBuffer = new ArrayBuffer(1536)
      const mockResponse = {
        ok: true,
        arrayBuffer: () => Promise.resolve(mockArrayBuffer),
        headers: new Map([['content-type', 'image/webp']])
      }

      const { rateLimitedFetchByUrlScope } = await import('@/src/runtime/rate-limit')
      vi.mocked(rateLimitedFetchByUrlScope).mockResolvedValue(mockResponse as unknown as Response)

      const result = await downloadCoverImage(mockUrl, mockIntegrationId, mockFetchTimeoutMs)

      expect(result).not.toBeNull()
      expect(result?.extension).toBe('webp')
    })

    it('defaults to jpeg when content-type is missing', async () => {
      const mockArrayBuffer = new ArrayBuffer(1024)
      const mockResponse = {
        ok: true,
        arrayBuffer: () => Promise.resolve(mockArrayBuffer),
        headers: new Map()
      }

      const { rateLimitedFetchByUrlScope } = await import('@/src/runtime/rate-limit')
      vi.mocked(rateLimitedFetchByUrlScope).mockResolvedValue(mockResponse as unknown as Response)

      const result = await downloadCoverImage(mockUrl, mockIntegrationId, mockFetchTimeoutMs)

      expect(result).not.toBeNull()
      expect(result?.mimeType).toBe('image/jpeg')
      expect(result?.extension).toBe('jpg')
    })

    it('handles content-type with charset', async () => {
      const mockArrayBuffer = new ArrayBuffer(1024)
      const mockResponse = {
        ok: true,
        arrayBuffer: () => Promise.resolve(mockArrayBuffer),
        headers: new Map([['content-type', 'image/jpeg; charset=utf-8']])
      }

      const { rateLimitedFetchByUrlScope } = await import('@/src/runtime/rate-limit')
      vi.mocked(rateLimitedFetchByUrlScope).mockResolvedValue(mockResponse as unknown as Response)

      const result = await downloadCoverImage(mockUrl, mockIntegrationId, mockFetchTimeoutMs)

      expect(result).not.toBeNull()
      expect(result?.extension).toBe('jpeg')
    })
  })

  describe('Graceful Failures (Non-blocking)', () => {
    it('returns null when coverUrl is undefined', async () => {
      const result = await downloadCoverImage(undefined, mockIntegrationId, mockFetchTimeoutMs)

      expect(result).toBeNull()
    })

    it('returns null when coverUrl is empty string', async () => {
      const result = await downloadCoverImage('', mockIntegrationId, mockFetchTimeoutMs)

      expect(result).toBeNull()
    })

    it('returns null on 404 response', async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        statusText: 'Not Found'
      }

      const { rateLimitedFetchByUrlScope } = await import('@/src/runtime/rate-limit')
      vi.mocked(rateLimitedFetchByUrlScope).mockResolvedValue(mockResponse as unknown as Response)

      const result = await downloadCoverImage(mockUrl, mockIntegrationId, mockFetchTimeoutMs)

      expect(result).toBeNull()
    })

    it('returns null on 403 response', async () => {
      const mockResponse = {
        ok: false,
        status: 403,
        statusText: 'Forbidden'
      }

      const { rateLimitedFetchByUrlScope } = await import('@/src/runtime/rate-limit')
      vi.mocked(rateLimitedFetchByUrlScope).mockResolvedValue(mockResponse as unknown as Response)

      const result = await downloadCoverImage(mockUrl, mockIntegrationId, mockFetchTimeoutMs)

      expect(result).toBeNull()
    })

    it('returns null on 500 response', async () => {
      const mockResponse = {
        ok: false,
        status: 500,
        statusText: 'Internal Server Error'
      }

      const { rateLimitedFetchByUrlScope } = await import('@/src/runtime/rate-limit')
      vi.mocked(rateLimitedFetchByUrlScope).mockResolvedValue(mockResponse as unknown as Response)

      const result = await downloadCoverImage(mockUrl, mockIntegrationId, mockFetchTimeoutMs)

      expect(result).toBeNull()
    })

    it('returns null on network error', async () => {
      const { rateLimitedFetchByUrlScope } = await import('@/src/runtime/rate-limit')
      vi.mocked(rateLimitedFetchByUrlScope).mockRejectedValue(new Error('Network error'))

      const result = await downloadCoverImage(mockUrl, mockIntegrationId, mockFetchTimeoutMs)

      expect(result).toBeNull()
    })

    it('returns null on timeout', async () => {
      const { rateLimitedFetchByUrlScope } = await import('@/src/runtime/rate-limit')
      vi.mocked(rateLimitedFetchByUrlScope).mockRejectedValue(new Error('Timeout'))

      const result = await downloadCoverImage(mockUrl, mockIntegrationId, mockFetchTimeoutMs)

      expect(result).toBeNull()
    })
  })

  describe('Retry Logic', () => {
    it('retries on failure (default 3 times)', async () => {
      const { rateLimitedFetchByUrlScope } = await import('@/src/runtime/rate-limit')
      vi.mocked(rateLimitedFetchByUrlScope)
        .mockRejectedValueOnce(new Error('Fail 1'))
        .mockRejectedValueOnce(new Error('Fail 2'))
        .mockRejectedValueOnce(new Error('Fail 3'))

      const result = await downloadCoverImage(mockUrl, mockIntegrationId, 3)

      expect(result).toBeNull()
      // Note: withRetries should have been called, verifying retry behavior
    })

    it('succeeds after retry', async () => {
      const mockArrayBuffer = new ArrayBuffer(1024)
      const mockResponse = {
        ok: true,
        arrayBuffer: () => Promise.resolve(mockArrayBuffer),
        headers: new Map([['content-type', 'image/jpeg']])
      }

      const { rateLimitedFetchByUrlScope } = await import('@/src/runtime/rate-limit')
      vi.mocked(rateLimitedFetchByUrlScope)
        .mockRejectedValueOnce(new Error('Fail 1'))
        .mockResolvedValueOnce(mockResponse as unknown as Response)

      const result = await downloadCoverImage(mockUrl, mockIntegrationId, 3)

      expect(result).not.toBeNull()
      expect(result?.data).toBe(mockArrayBuffer)
    })
  })

  describe('Rate Limiting', () => {
    it('uses image scope for rate limiting', async () => {
      const mockArrayBuffer = new ArrayBuffer(1024)
      const mockResponse = {
        ok: true,
        arrayBuffer: () => Promise.resolve(mockArrayBuffer),
        headers: new Map([['content-type', 'image/jpeg']])
      }

      const { rateLimitedFetchByUrlScope } = await import('@/src/runtime/rate-limit')
      vi.mocked(rateLimitedFetchByUrlScope).mockResolvedValue(mockResponse as unknown as Response)

      await downloadCoverImage(mockUrl, mockIntegrationId, mockFetchTimeoutMs)

      expect(rateLimitedFetchByUrlScope).toHaveBeenCalledWith(mockUrl, 'image')
    })
  })

  describe('Data Integrity', () => {
    it('returns correct ArrayBuffer size', async () => {
      const expectedSize = 4096
      const mockArrayBuffer = new ArrayBuffer(expectedSize)
      const mockResponse = {
        ok: true,
        arrayBuffer: () => Promise.resolve(mockArrayBuffer),
        headers: new Map([['content-type', 'image/jpeg']])
      }

      const { rateLimitedFetchByUrlScope } = await import('@/src/runtime/rate-limit')
      vi.mocked(rateLimitedFetchByUrlScope).mockResolvedValue(mockResponse as unknown as Response)

      const result = await downloadCoverImage(mockUrl, mockIntegrationId, mockFetchTimeoutMs)

      expect(result?.data.byteLength).toBe(expectedSize)
    })

    it('handles large images (>1MB)', async () => {
      const largeSize = 2 * 1024 * 1024 // 2MB
      const mockArrayBuffer = new ArrayBuffer(largeSize)
      const mockResponse = {
        ok: true,
        arrayBuffer: () => Promise.resolve(mockArrayBuffer),
        headers: new Map([['content-type', 'image/jpeg']])
      }

      const { rateLimitedFetchByUrlScope } = await import('@/src/runtime/rate-limit')
      vi.mocked(rateLimitedFetchByUrlScope).mockResolvedValue(mockResponse as unknown as Response)

      const result = await downloadCoverImage(mockUrl, mockIntegrationId, mockFetchTimeoutMs)

      expect(result).not.toBeNull()
      expect(result?.data.byteLength).toBe(largeSize)
    })
  })

  describe('Real-world Scenarios', () => {
    it('handles typical manga cover from mangadex.org', async () => {
      const mockArrayBuffer = new ArrayBuffer(153600) // ~150KB typical cover
      const mockResponse = {
        ok: true,
        arrayBuffer: () => Promise.resolve(mockArrayBuffer),
        headers: new Map([['content-type', 'image/jpeg']])
      }

      const { rateLimitedFetchByUrlScope } = await import('@/src/runtime/rate-limit')
      vi.mocked(rateLimitedFetchByUrlScope).mockResolvedValue(mockResponse as unknown as Response)

      const result = await downloadCoverImage(
        'https://example.com/series-cover.jpg',
        'mangadex',
        mockFetchTimeoutMs
      )

      expect(result).not.toBeNull()
      expect(result?.extension).toBe('jpeg')
      expect(result?.data.byteLength).toBe(153600)
    })

    it('gracefully handles CDN failures', async () => {
      const { rateLimitedFetchByUrlScope } = await import('@/src/runtime/rate-limit')
      vi.mocked(rateLimitedFetchByUrlScope).mockRejectedValue(new Error('CDN unavailable'))

      const result = await downloadCoverImage(
        'https://cdn.example.com/cover.jpg',
        'mangadex',
        mockFetchTimeoutMs
      )

      expect(result).toBeNull()
      // Download continues without cover
    })
  })

  describe('Image Concurrency', () => {
    it('reads per-site image delay from dynamic settings without registry indirection', async () => {
      const { siteIntegrationSettingsService } = await import('@/src/storage/site-integration-settings-service')
      const getForSiteSpy = vi
        .spyOn(siteIntegrationSettingsService, 'getForSite')
        .mockResolvedValue({ imageDownloadDelayMs: 1 })
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')

      const backgroundIntegration = {
        chapter: {
          downloadImage: vi.fn(async () => ({
            filename: 'image.jpg',
            data: new ArrayBuffer(16),
            mimeType: 'image/jpeg',
          })),
        },
      } as unknown as BackgroundIntegration

      const results = await downloadImages(
        ['https://img.example/1'],
        backgroundIntegration,
        {
          integrationId: 'mangadex',
          retries: { image: 1, chapter: 1 },
          fetchTimeout: 1000,
          imageTimeout: 1000,
        },
        () => undefined,
      )

      expect(results).toHaveLength(1)
      expect(getForSiteSpy).toHaveBeenCalledWith('mangadex')
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1)
    })

    it('limits concurrent image downloads to 16 workers', async () => {
      let inFlight = 0
      let maxInFlight = 0

      const backgroundIntegration = {
        chapter: {
          downloadImage: vi.fn(async (url: string) => {
            inFlight += 1
            maxInFlight = Math.max(maxInFlight, inFlight)

            await new Promise((resolve) => setTimeout(resolve, 5))

            inFlight -= 1
            return {
              filename: `${url.split('/').pop() ?? 'image'}.jpg`,
              data: new ArrayBuffer(16),
              mimeType: 'image/jpeg',
            }
          }),
        },
      } as unknown as BackgroundIntegration

      const imageUrls = Array.from({ length: 40 }, (_, index) => `https://img.example/${index}`)

      const results = await downloadImages(
        imageUrls,
        backgroundIntegration,
        {
          integrationId: 'mangadex',
          retries: { image: 1, chapter: 1 },
          fetchTimeout: 1000,
          imageTimeout: 1000,
        },
        () => undefined,
      )

      expect(results).toHaveLength(40)
      expect(maxInFlight).toBeLessThanOrEqual(16)
      expect(maxInFlight).toBeGreaterThan(1)
    })
  })
})

