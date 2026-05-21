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
  it('uses a background message loader when content extraction hooks are absent', async () => {
    const { resolveSeriesDataStrategy } = await import('@/entrypoints/content')

    const requestBackgroundSeriesData = vi.fn(async () => ({
      seriesMetadata: { title: 'Series' },
      chapterList: { chapters: [], volumes: [] },
    }))

    const strategy = resolveSeriesDataStrategy({
      id: 'test-site',
      content: {
        name: 'Test Content',
        series: {
          getSeriesId: () => 'series-1',
        },
      },
    }, requestBackgroundSeriesData)

    expect(strategy.kind).toBe('background-message')
    if (strategy.kind !== 'background-message') {
      throw new Error('Expected background message strategy')
    }

    await expect(strategy.fetchSeriesData('series-1')).resolves.toEqual({
      seriesMetadata: { title: 'Series' },
      chapterList: { chapters: [], volumes: [] },
    })
    expect(requestBackgroundSeriesData).toHaveBeenCalledWith('test-site', 'series-1', undefined)
  })
})

