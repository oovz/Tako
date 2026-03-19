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

describe('bootstrapContentScript', () => {
  it('runs initialization before awaiting settings warmup', async () => {
    const { bootstrapContentScript } = await import('@/entrypoints/content')

    const order: string[] = []
    let resolveWarmSettings!: () => void

    const bootstrapPromise = bootstrapContentScript(
      () => {
        order.push('initialize')
      },
      async () => {
        order.push('warm-settings-start')
        await new Promise<void>((resolve) => {
          resolveWarmSettings = resolve
        })
        order.push('warm-settings-end')
      },
    )

    expect(order).toEqual(['initialize', 'warm-settings-start'])

    resolveWarmSettings()
    await bootstrapPromise

    expect(order).toEqual(['initialize', 'warm-settings-start', 'warm-settings-end'])
  })
})

describe('resolvePageReadyHook', () => {
  it('returns the canonical series.waitForPageReady hook when provided', async () => {
    const { resolvePageReadyHook } = await import('@/entrypoints/content')

    const canonicalHook = vi.fn(async () => {})

    const resolvedHook = resolvePageReadyHook({
      content: {
        name: 'Test Content',
        series: {
          waitForPageReady: canonicalHook,
          getSeriesId: () => 'series-1',
        },
      },
    } as never)

    expect(resolvedHook).toBe(canonicalHook)
  })
})

describe('resolveSeriesDataStrategy', () => {
  it('uses canonical background.series loaders when available', async () => {
    const { resolveSeriesDataStrategy } = await import('@/entrypoints/content')

    const backgroundFetchSeriesMetadata = vi.fn(async () => ({ title: 'Series' }))
    const backgroundFetchChapterList = vi.fn(async () => ({ chapters: [], volumes: [] }))

    const strategy = resolveSeriesDataStrategy({
      content: {
        name: 'Test Content',
        series: {
          getSeriesId: () => 'series-1',
        },
      },
      background: {
        name: 'Test Background',
        series: {
          fetchSeriesMetadata: backgroundFetchSeriesMetadata,
          fetchChapterList: backgroundFetchChapterList,
        },
        chapter: {
          processImageUrls: async (urls: string[]) => urls,
          downloadImage: async () => ({ data: new ArrayBuffer(0), filename: 'file', mimeType: 'image/png' }),
        },
      },
    } as never)

    expect(strategy.kind).toBe('background')
    if (strategy.kind !== 'background') {
      throw new Error('Expected canonical background strategy')
    }

    await expect(strategy.fetchSeriesMetadata('series-1')).resolves.toEqual({ title: 'Series' })
    await expect(strategy.fetchChapterList('series-1')).resolves.toEqual({ chapters: [], volumes: [] })
    expect(backgroundFetchSeriesMetadata).toHaveBeenCalledWith('series-1', undefined)
    expect(backgroundFetchChapterList).toHaveBeenCalledWith('series-1', undefined)
  })
})

