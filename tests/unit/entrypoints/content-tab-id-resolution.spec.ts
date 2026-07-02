import { afterEach, describe, expect, it, vi } from 'vitest'

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

describe('resolveContentTabId', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the tab id from a successful response', async () => {
    const { resolveContentTabId } = await import('@/entrypoints/content')

    await expect(
      resolveContentTabId(async () => ({ success: true, tabId: 42 })),
    ).resolves.toBe(42)
  })

  it('preserves zero as a valid tab id', async () => {
    const { resolveContentTabId } = await import('@/entrypoints/content')

    await expect(
      resolveContentTabId(async () => ({ success: true, tabId: 0 })),
    ).resolves.toBe(0)
  })

  it('returns null when the response does not include a tab id', async () => {
    const { resolveContentTabId } = await import('@/entrypoints/content')

    await expect(
      resolveContentTabId(async () => ({ success: false, error: 'Tab ID not found' })),
    ).resolves.toBeNull()
  })

  it('returns null when the tab-id request throws', async () => {
    const { resolveContentTabId } = await import('@/entrypoints/content')

    await expect(
      resolveContentTabId(async () => {
        throw new Error('boom')
      }),
    ).resolves.toBeNull()
  })

  // W3 regression: schema-drift / malformed responses must fail closed.
  it('returns null for a negative tabId (fails integer.nonnegative)', async () => {
    const { resolveContentTabId } = await import('@/entrypoints/content')

    await expect(
      resolveContentTabId(async () => ({ success: true, tabId: -1 }) as never),
    ).resolves.toBeNull()
  })

  it('returns null when success is true but tabId is missing', async () => {
    const { resolveContentTabId } = await import('@/entrypoints/content')

    await expect(
      resolveContentTabId(async () => ({ success: true }) as never),
    ).resolves.toBeNull()
  })

  it('returns null for a non-boolean success field', async () => {
    const { resolveContentTabId } = await import('@/entrypoints/content')

    await expect(
      resolveContentTabId(async () => ({ success: 'true', tabId: 5 }) as never),
    ).resolves.toBeNull()
  })
})

