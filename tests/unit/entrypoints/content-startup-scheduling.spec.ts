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

describe('scheduleInitialContentInitialization', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('runs initialization immediately when the document is already ready', async () => {
    vi.stubGlobal('document', {
      readyState: 'complete',
      addEventListener: vi.fn(),
    })

    const { scheduleInitialContentInitialization } = await import('@/entrypoints/content')
    const initialize = vi.fn(async () => {})

    scheduleInitialContentInitialization(initialize)

    expect(initialize).toHaveBeenCalledTimes(1)
  })

  it('defers initialization until DOMContentLoaded when the document is loading', async () => {
    let domReadyHandler: (() => void) | undefined
    const addEventListener = vi.fn((event: string, handler: () => void) => {
      if (event === 'DOMContentLoaded') {
        domReadyHandler = handler
      }
    })

    vi.stubGlobal('document', {
      readyState: 'loading',
      addEventListener,
    })

    const { scheduleInitialContentInitialization } = await import('@/entrypoints/content')
    const initialize = vi.fn(async () => {})

    scheduleInitialContentInitialization(initialize)

    expect(initialize).not.toHaveBeenCalled()
    expect(addEventListener).toHaveBeenCalledWith('DOMContentLoaded', expect.any(Function), { once: true })

    domReadyHandler?.()

    expect(initialize).toHaveBeenCalledTimes(1)
  })
})

