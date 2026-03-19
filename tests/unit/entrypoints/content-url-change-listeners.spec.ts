import { beforeEach, describe, expect, it, vi } from 'vitest'

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

describe('content entrypoint exports', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not expose the removed installUrlChangeListeners helper', async () => {
    const contentModule = await import('@/entrypoints/content')

    expect('installUrlChangeListeners' in contentModule).toBe(false)
  })
})

