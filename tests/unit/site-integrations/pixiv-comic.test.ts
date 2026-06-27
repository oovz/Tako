import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { parseEpisodeIdFromUrl, parseWorkId } from '@/src/site-integrations/pixiv-comic/page-context'
import {
  PIXIV_BASE_URL,
  createPixivAppHeaders,
  resolvePixivCookieHeader,
  sanitizePixivHtmlText,
} from '@/src/site-integrations/pixiv-comic/shared'

vi.mock('@/src/runtime/rate-limit', () => ({
  rateLimitedFetchByUrlScope: vi.fn(async (url: string) => {
    throw new Error(`Unexpected fetch: ${url}`)
  }),
  getRateLimitPolicyFromContext: vi.fn(() => undefined),
}))

vi.mock('@/src/runtime/logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

async function importModule() {
  return await import('@/src/site-integrations/pixiv-comic/series-api')
}

async function importChapterApi() {
  return await import('@/src/site-integrations/pixiv-comic/chapter-api')
}

const { rateLimitedFetchByUrlScope } = await import('@/src/runtime/rate-limit')

const PIXIV_WORK_ID = '9999001'
const PIXIV_WORK_V5_RESPONSE = {
  data: {
    official_work: {
      id: 9999001,
      name: 'テスト作品',
      author: 'テスト作者',
      description: 'A Pixiv Comic fixture work used by e2e tests.',
      image: {
        main: 'https://img-comic.test/works/9999001/cover_main.jpg',
        main_big: 'https://img-comic.test/works/9999001/cover_main_big.jpg',
        thumbnail: 'https://img-comic.test/works/9999001/cover_thumb.jpg',
      },
    },
  },
}

const PIXIV_EPISODES_V2_RESPONSE = {
  data: {
    episodes: [
      {
        state: 'readable',
        episode: {
          id: 70001,
          numbering_title: '第1話',
          sub_title: '出発',
          viewer_path: '/viewer/stories/70001',
          state: 'readable',
        },
      },
      {
        state: 'readable',
        episode: {
          id: 70002,
          numbering_title: '第2話',
          sub_title: '邂逅',
          viewer_path: '/viewer/stories/70002',
          state: 'readable',
        },
      },
      {
        state: 'locked',
        episode: {
          id: 70003,
          numbering_title: '第3話',
          sub_title: '嵐の夜',
          viewer_path: '/viewer/stories/70003',
          state: 'locked',
        },
      },
    ],
  },
}

function mockFetchResponse(url: string, body: unknown, status = 200): void {
  vi.mocked(rateLimitedFetchByUrlScope).mockImplementationOnce(async (reqUrl: string) => {
    if (reqUrl === url) {
      return {
        ok: true,
        status,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => body,
        text: async () => JSON.stringify(body),
        arrayBuffer: async () => new ArrayBuffer(0),
        clone: function () { return this },
      } as Response
    }
    throw new Error(`Unexpected fetch URL: ${reqUrl}`)
  })
}

describe('Pixiv Comic site integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('shared utilities', () => {
    it('exposes the correct base URL', () => {
      expect(PIXIV_BASE_URL).toBe('https://comic.pixiv.net')
    })

    it('creates app headers with required Pixiv Comic fields', () => {
      const headers = createPixivAppHeaders()
      expect(headers['x-requested-with']).toBe('pixivcomic')
      expect(headers['x-referer']).toBe(PIXIV_BASE_URL)
    })

    it('resolves a valid cookie header from context', () => {
      expect(resolvePixivCookieHeader({ cookieHeader: 'session=abc' })).toBe('session=abc')
      expect(resolvePixivCookieHeader({ cookieHeader: '  ' })).toBeUndefined()
      expect(resolvePixivCookieHeader({})).toBeUndefined()
      expect(resolvePixivCookieHeader(undefined)).toBeUndefined()
    })

    it('sanitizes HTML text by stripping tags and collapsing whitespace', () => {
      expect(sanitizePixivHtmlText('<p>Hello<br/>World</p>')).toBe('Hello World')
      expect(sanitizePixivHtmlText(undefined)).toBeUndefined()
      expect(sanitizePixivHtmlText('')).toBeUndefined()
      expect(sanitizePixivHtmlText('<div>  </div>')).toBeUndefined()
    })
  })

  describe('page-context', () => {
    it('extracts work id from /works/{id} path', () => {
      expect(parseWorkId('/works/9999001')).toBe('9999001')
      expect(parseWorkId('/works/123')).toBe('123')
      expect(parseWorkId('/viewer/stories/70001')).toBeNull()
      expect(parseWorkId('/')).toBeNull()
    })

    it('extracts episode id from viewer/stories URLs', () => {
      expect(parseEpisodeIdFromUrl('https://comic.pixiv.net/viewer/stories/70001')).toBe('70001')
      expect(parseEpisodeIdFromUrl('https://comic.pixiv.net/episodes/70002')).toBe('70002')
      expect(parseEpisodeIdFromUrl('https://comic.pixiv.net/works/9999001')).toBeNull()
    })
  })

  describe('series-api', () => {
    it('fetches series metadata from the works/v5 API', async () => {
      const apiUrl = `${PIXIV_BASE_URL}/api/app/works/v5/${PIXIV_WORK_ID}`
      mockFetchResponse(apiUrl, PIXIV_WORK_V5_RESPONSE)

      const { fetchPixivSeriesMetadata } = await importModule()
      const metadata = await fetchPixivSeriesMetadata(PIXIV_WORK_ID)

      expect(metadata.title).toBe('テスト作品')
      expect(metadata.author).toBe('テスト作者')
      expect(metadata.language).toBe('ja')
      expect(metadata.readingDirection).toBe('rtl')
      expect(metadata.coverUrl).toBe('https://img-comic.test/works/9999001/cover_main_big.jpg')
    })

    it('throws when official_work is missing from the API response', async () => {
      const apiUrl = `${PIXIV_BASE_URL}/api/app/works/v5/${PIXIV_WORK_ID}`
      mockFetchResponse(apiUrl, { data: {} })

      const { fetchPixivSeriesMetadata } = await importModule()
      await expect(fetchPixivSeriesMetadata(PIXIV_WORK_ID)).rejects.toThrow(
        'Pixiv Comic API may have changed (official_work missing)',
      )
    })

    it('fetches chapter list from episodes/v2 API with correct ordering', async () => {
      const apiUrl = `${PIXIV_BASE_URL}/api/app/works/${PIXIV_WORK_ID}/episodes/v2?order=asc`
      mockFetchResponse(apiUrl, PIXIV_EPISODES_V2_RESPONSE)

      const { fetchPixivChapterList } = await importModule()
      const result = await fetchPixivChapterList(PIXIV_WORK_ID)
      const chapters = Array.isArray(result) ? result : result.chapters

      expect(chapters).toHaveLength(3)
      expect(chapters[0]!.id).toBe('70001')
      expect(chapters[0]!.title).toBe('第1話 出発')
      expect(chapters[0]!.url).toBe('https://comic.pixiv.net/viewer/stories/70001')
      expect(chapters[0]!.locked).toBe(false)
      expect(chapters[2]!.locked).toBe(true)
      if (!Array.isArray(result)) {
        expect(result.volumes).toEqual([])
      }
    })

    it('deduplicates chapters by id, preferring unlocked over locked', async () => {
      const apiUrl = `${PIXIV_BASE_URL}/api/app/works/${PIXIV_WORK_ID}/episodes/v2?order=asc`
      const responseWithDupes = {
        data: {
          episodes: [
            {
              state: 'locked',
              episode: {
                id: 70001,
                numbering_title: '第1話',
                sub_title: '出発',
                viewer_path: '/viewer/stories/70001',
                state: 'locked',
              },
            },
            {
              state: 'readable',
              episode: {
                id: 70001,
                numbering_title: '第1話',
                sub_title: '出発',
                viewer_path: '/viewer/stories/70001',
                state: 'readable',
              },
            },
          ],
        },
      }
      mockFetchResponse(apiUrl, responseWithDupes)

      const { fetchPixivChapterList } = await importModule()
      const result = await fetchPixivChapterList(PIXIV_WORK_ID)
      const chapters = Array.isArray(result) ? result : result.chapters

      expect(chapters).toHaveLength(1)
      expect(chapters[0]!.locked).toBe(false)
    })

    it('returns empty chapter list when API returns no episodes', async () => {
      const apiUrl = `${PIXIV_BASE_URL}/api/app/works/${PIXIV_WORK_ID}/episodes/v2?order=asc`
      mockFetchResponse(apiUrl, { data: { episodes: [] } })

      const { fetchPixivChapterList } = await importModule()
      const result = await fetchPixivChapterList(PIXIV_WORK_ID)
      const chapters = Array.isArray(result) ? result : result.chapters

      expect(chapters).toEqual([])
    })
  })

  describe('chapter-api utilities', () => {
    it('parses image URLs from chapter HTML', async () => {
      const { parsePixivImageUrlsFromHtml } = await importChapterApi()
      const html = '<div><img src="https://img.pixiv.net/page1.jpg"><img src="https://img.pixiv.net/page2.png"></div>'
      const urls = await parsePixivImageUrlsFromHtml({ chapterId: '70001', chapterUrl: 'https://comic.pixiv.net/viewer/stories/70001', chapterHtml: html })
      expect(urls).toEqual([
        'https://img.pixiv.net/page1.jpg',
        'https://img.pixiv.net/page2.png',
      ])
    })

    it('returns empty array when no image URLs are found in HTML', async () => {
      const { parsePixivImageUrlsFromHtml } = await importChapterApi()
      const urls = await parsePixivImageUrlsFromHtml({ chapterId: '70001', chapterUrl: 'https://comic.pixiv.net/viewer/stories/70001', chapterHtml: '<div>no images</div>' })
      expect(urls).toEqual([])
    })

    it('filters invalid image URLs via processPixivImageUrls', async () => {
      const { processPixivImageUrls } = await importChapterApi()
      const urls = await processPixivImageUrls([
        'https://img.pixiv.net/page1.jpg',
        'not-a-url',
        'https://img.pixiv.net/page2.png',
      ])
      expect(urls).toEqual([
        'https://img.pixiv.net/page1.jpg',
        'https://img.pixiv.net/page2.png',
      ])
    })
  })
})
