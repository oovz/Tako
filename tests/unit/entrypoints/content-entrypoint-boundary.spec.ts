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

vi.mock('@/entrypoints/content/content-runtime', () => {
  throw new Error('content-runtime should not be loaded while importing content helper exports')
})

describe('content entrypoint helper exports', () => {
  it('can be imported without evaluating the browser runtime module', async () => {
    const contentEntrypoint = await import('@/entrypoints/content')

    expect(contentEntrypoint.resolveContentTabId).toEqual(expect.any(Function))
    expect(contentEntrypoint.resolveInitializeTabPayload).toEqual(expect.any(Function))
    expect(contentEntrypoint.scheduleInitialContentInitialization).toEqual(expect.any(Function))
  })
})
