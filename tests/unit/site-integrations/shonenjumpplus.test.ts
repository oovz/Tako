import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  extractImageUrlsFromEpisodeJsonScript,
} from '@/src/site-integrations/shonenjumpplus/episode-json'

vi.mock('@/src/runtime/rate-limit', () => ({
  rateLimitedFetchByUrlScope: vi.fn(async (url: string) => {
    throw new Error(`Unexpected fetch: ${url}`)
  }),
  getRateLimitPolicyFromContext: vi.fn(() => undefined),
  getRateLimitPolicyFromSnapshot: vi.fn(() => undefined),
}))

vi.mock('@/src/runtime/logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

const SERIES_AGGREGATE_ID = '4401'
const EPISODE_ID = '3269754496649675685'

function buildEpisodeJsonHtml(seriesTitle: string, pages: unknown[], thumbnailUri = ''): string {
  const payload = JSON.stringify({
    readableProduct: {
      series: {
        id: SERIES_AGGREGATE_ID,
        title: seriesTitle,
        thumbnailUri,
      },
      pageStructure: { pages },
    },
  })
  const encoded = payload
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

  return `<html><body><script id="episode-json" type="application/json" data-value="${encoded}"></script></body></html>`
}

const EPISODE_PAGES = [
  { type: 'main', src: 'https://cdn-ak-img.shonenjumpplus.com/public/page/1.jpg', contentStart: 'abcdef12' },
  { type: 'main', src: 'https://cdn-ak-img.shonenjumpplus.com/public/page/2.jpg' },
  { type: 'thumbnail', src: 'https://cdn-ak-img.shonenjumpplus.com/thumb/1.jpg' },
  { type: 'main', src: '' },
]

describe('Shonen Jump+ site integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('episode-json extraction', () => {
    it('extracts image URLs from episode-json script, filtering non-main pages', () => {
      const html = buildEpisodeJsonHtml('テスト連載', EPISODE_PAGES)
      const urls = extractImageUrlsFromEpisodeJsonScript(html)

      expect(urls).toEqual([
        'https://cdn-ak-img.shonenjumpplus.com/public/page/1.jpg',
        'https://cdn-ak-img.shonenjumpplus.com/public/page/2.jpg',
      ])
    })

    it('applies seed token to all main pages when contentStart is present', () => {
      const html = buildEpisodeJsonHtml('テスト連載', EPISODE_PAGES)
      const withSeedToken = (url: string, seed: number) => `${url}?sjpSeed=${seed}`
      const urls = extractImageUrlsFromEpisodeJsonScript(html, {
        applySeedToken: true,
        withSeedToken,
      })

      expect(urls).toHaveLength(2)
      expect(urls[0]).toContain('sjpSeed=')
      expect(urls[1]).toContain('sjpSeed=')
    })

    it('returns empty array when no episode-json script is present', () => {
      expect(extractImageUrlsFromEpisodeJsonScript('<html><body>no script</body></html>')).toEqual([])
    })

    it('returns empty array for empty input', () => {
      expect(extractImageUrlsFromEpisodeJsonScript('')).toEqual([])
    })

    it('returns empty array when pages is not an array', () => {
      const brokenPayload = `<html><body><script id="episode-json" type="application/json" data-value="${JSON.stringify({ readableProduct: { pageStructure: {} } }).replace(/"/g, '&quot;')}"></script></body></html>`
      expect(extractImageUrlsFromEpisodeJsonScript(brokenPayload)).toEqual([])
    })

    it('returns empty array when all pages are non-main type', () => {
      const html = buildEpisodeJsonHtml('テスト', [
        { type: 'thumbnail', src: 'https://example.com/thumb.jpg' },
      ])
      expect(extractImageUrlsFromEpisodeJsonScript(html)).toEqual([])
    })
  })

  describe('background integration', () => {
    it('resolves image URLs from chapter HTML via the background integration', async () => {
      const { shonenJumpPlusBackgroundIntegration } = await import('@/src/site-integrations/shonenjumpplus/index')
      const html = buildEpisodeJsonHtml('テスト連載', EPISODE_PAGES)

      const { rateLimitedFetchByUrlScope } = await import('@/src/runtime/rate-limit')
      vi.mocked(rateLimitedFetchByUrlScope).mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
        json: async () => ({}),
        text: async () => html,
        arrayBuffer: async () => new TextEncoder().encode(html).buffer,
        clone: function () { return this },
      } as Response)

      const urls = await shonenJumpPlusBackgroundIntegration.chapter.resolveImageUrls!(
        { id: EPISODE_ID, url: `https://shonenjumpplus.com/episode/${EPISODE_ID}` },
        undefined,
        undefined,
      )

      expect(urls).toHaveLength(2)
      expect(urls[0]).toContain('page/1.jpg')
      expect(urls[1]).toContain('page/2.jpg')
    })

    it('throws on invalid chapter URL', async () => {
      const { shonenJumpPlusBackgroundIntegration } = await import('@/src/site-integrations/shonenjumpplus/index')

      await expect(
        shonenJumpPlusBackgroundIntegration.chapter.resolveImageUrls!(
          { id: 'x', url: 'https://example.com/not-an-episode' },
          undefined,
          undefined,
        ),
      ).rejects.toThrow('Invalid Shonen Jump+ chapter URL')
    })

    it('parseImageUrlsFromHtml delegates to episode-json extraction', async () => {
      const { shonenJumpPlusBackgroundIntegration } = await import('@/src/site-integrations/shonenjumpplus/index')
      const html = buildEpisodeJsonHtml('テスト連載', EPISODE_PAGES)

      const urls = await shonenJumpPlusBackgroundIntegration.chapter.parseImageUrlsFromHtml!({
        chapterId: EPISODE_ID,
        chapterHtml: html,
        chapterUrl: `https://shonenjumpplus.com/episode/${EPISODE_ID}`,
      })

      expect(urls).toHaveLength(2)
    })

    it('processImageUrls filters invalid URLs', async () => {
      const { shonenJumpPlusBackgroundIntegration } = await import('@/src/site-integrations/shonenjumpplus/index')

      const urls = await shonenJumpPlusBackgroundIntegration.chapter.processImageUrls([
        'https://cdn-ak-img.shonenjumpplus.com/page1.jpg',
        'not-a-url',
      ], { id: EPISODE_ID, url: `https://shonenjumpplus.com/episode/${EPISODE_ID}` } as never)

      expect(urls).toEqual(['https://cdn-ak-img.shonenjumpplus.com/page1.jpg'])
    })

    it('passes a bounded abortable request into the offscreen image fetch path', async () => {
      const { offscreenSiteAdapter } = await import('@/src/site-integrations/shonenjumpplus/offscreen-runtime')
      const { rateLimitedFetchByUrlScope } = await import('@/src/runtime/rate-limit')
      const payload = new Uint8Array([1, 2, 3, 4]).buffer
      const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'image/jpeg' }),
        body: null,
        arrayBuffer: async () => payload,
      } as unknown as Response))
      vi.stubGlobal('fetch', fetch)

      const image = await offscreenSiteAdapter.offscreen.chapter.downloadImage(
        'https://cdn-ak.shonenjumpplus.com/pages/001.jpg',
        { signal: new AbortController().signal, context: undefined },
      )

      expect(image.filename).toBe('001.jpg')
      expect(image.mimeType).toBe('image/jpeg')

      expect(rateLimitedFetchByUrlScope).not.toHaveBeenCalled()
      const [, init] = fetch.mock.calls.at(-1) ?? []
      expect(init).toMatchObject({ credentials: 'include' })
      expect((init as RequestInit | undefined)?.signal).toBeInstanceOf(AbortSignal)
    })
  })
})
