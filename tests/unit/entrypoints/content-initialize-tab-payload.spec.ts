import { describe, expect, it, vi } from 'vitest'

vi.mock('wxt/utils/define-content-script', () => ({
  defineContentScript: (config: unknown) => config,
}))

vi.mock('@/src/runtime/logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/src/storage/settings-service', () => ({
  settingsService: {
    getSettings: vi.fn(async () => ({})),
  },
}))

describe('resolveInitializeTabPayload', () => {
  it('returns unsupported when no real manga id can be extracted', async () => {
    const { resolveInitializeTabPayload } = await import('@/entrypoints/content')

    const payload = resolveInitializeTabPayload({
      siteIntegrationId: 'mangadex',
      rawMangaId: null,
      chapters: [],
    })

    expect(payload).toEqual({ context: 'unsupported' })
  })

  it('returns error when extraction fails after a real manga id is known', async () => {
    const { resolveInitializeTabPayload } = await import('@/entrypoints/content')

    const payload = resolveInitializeTabPayload({
      siteIntegrationId: 'mangadex',
      rawMangaId: 'series-123',
      chapters: [],
      extractionError: new Error('Failed to extract series metadata'),
    })

    expect(payload).toEqual({
      context: 'error',
      error: 'Failed to extract series metadata',
    })
  })

  it('returns ready with canonical mangaId and no fabricated fallback title', async () => {
    const { resolveInitializeTabPayload } = await import('@/entrypoints/content')

    const payload = resolveInitializeTabPayload({
      siteIntegrationId: 'mangadex',
      rawMangaId: 'series-123',
      chapters: [
        {
          id: 'chapter-1',
          url: 'https://mangadex.org/chapter/1',
          title: 'Chapter 1',
          chapterNumber: 1,
        },
      ],
      seriesMetadata: {
        title: 'Hunter x Hunter',
        author: 'Yoshihiro Togashi',
      },
    })

    expect(payload).toEqual({
      context: 'ready',
      siteIntegrationId: 'mangadex',
      mangaId: 'series-123',
      seriesTitle: 'Hunter x Hunter',
      chapters: [
        {
          id: 'chapter-1',
          url: 'https://mangadex.org/chapter/1',
          title: 'Chapter 1',
          locked: false,
          chapterNumber: 1,
          volumeNumber: undefined,
          volumeLabel: undefined,
        },
      ],
      metadata: {
        title: 'Hunter x Hunter',
        author: 'Yoshihiro Togashi',
      },
    })
  })

  it('preserves integration-provided volumes in ready payloads', async () => {
    const { resolveInitializeTabPayload } = await import('@/entrypoints/content')

    const payload = resolveInitializeTabPayload({
      siteIntegrationId: 'shonenjumpplus',
      rawMangaId: 'series-456',
      chapters: [
        {
          id: 'chapter-1',
          url: 'https://shonenjumpplus.com/episode/1',
          title: 'Chapter 1',
          volumeNumber: 2,
          volumeLabel: 'Arc B',
        },
      ],
      volumes: [
        {
          id: 'custom-volume-b',
          title: 'Arc B',
          label: 'Arc B',
        },
        {
          id: 'custom-volume-a',
          title: 'Arc A',
          label: 'Arc A',
        },
      ],
      seriesMetadata: {
        title: 'Series With Custom Grouping',
      },
    })

    expect(payload).toEqual({
      context: 'ready',
      siteIntegrationId: 'shonenjumpplus',
      mangaId: 'series-456',
      seriesTitle: 'Series With Custom Grouping',
      chapters: [
        {
          id: 'chapter-1',
          url: 'https://shonenjumpplus.com/episode/1',
          title: 'Chapter 1',
          locked: false,
          chapterNumber: undefined,
          volumeNumber: 2,
          volumeLabel: 'Arc B',
        },
      ],
      volumes: [
        {
          id: 'custom-volume-b',
          title: 'Arc B',
          label: 'Arc B',
        },
        {
          id: 'custom-volume-a',
          title: 'Arc A',
          label: 'Arc A',
        },
      ],
      metadata: {
        title: 'Series With Custom Grouping',
      },
    })
  })

  it('returns error when extracted chapters are missing stable ids', async () => {
    const { resolveInitializeTabPayload } = await import('@/entrypoints/content')

    const payload = resolveInitializeTabPayload({
      siteIntegrationId: 'mangadex',
      rawMangaId: 'series-123',
      chapters: [
        {
          id: 'chapter-1',
          url: 'https://mangadex.org/chapter/1',
          title: 'Chapter 1',
        },
        {
          url: 'https://mangadex.org/chapter/missing-id',
          title: 'Missing id chapter',
        },
      ],
      seriesMetadata: {
        title: 'Hunter x Hunter',
      },
    })

    expect(payload).toEqual({
      context: 'error',
      error: 'Failed to extract stable chapter ids',
    })
  })
})

