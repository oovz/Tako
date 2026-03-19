import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/src/runtime/logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/src/runtime/site-integration-initialization', () => ({
  initializeSiteIntegrations: vi.fn(),
}))

import { initializeSiteIntegrations } from '@/src/runtime/site-integration-initialization'

describe('offscreen entrypoint initialization failure handling', () => {
  const addListener = vi.fn()
  const removeListener = vi.fn()
  const sendMessage = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    const mockElement = {
      textContent: '',
      dataset: {},
      hidden: false,
      innerHTML: '',
    }

    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage,
        onMessage: {
          addListener,
          removeListener,
        },
      },
    } as unknown as typeof chrome)

    vi.stubGlobal('document', {
      getElementById: vi.fn().mockReturnValue(mockElement),
      addEventListener: vi.fn(),
    } as unknown as Document)

    vi.stubGlobal('window', globalThis as unknown as Window & typeof globalThis)
    vi.stubGlobal('HTMLElement', class {} as unknown as typeof HTMLElement)
    vi.stubGlobal('HTMLDivElement', class {} as unknown as typeof HTMLDivElement)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('flushes queued responses and fails closed after offscreen initialization fails', async () => {
    vi.mocked(initializeSiteIntegrations).mockRejectedValueOnce(new Error('registry init failed'))

    await import('@/entrypoints/offscreen/main')

    expect(addListener).toHaveBeenCalledTimes(1)

    const listener = addListener.mock.calls[0]?.[0] as (
      message: { type: string; payload?: unknown },
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: { success: boolean; error?: string }) => void,
    ) => boolean

    const queuedResponse = vi.fn()
    expect(
      listener(
        { type: 'REVOKE_BLOB_URL', payload: { blobUrl: 'blob:queued-before-init-failure' } },
        {} as chrome.runtime.MessageSender,
        queuedResponse,
      ),
    ).toBe(true)

    for (let attempt = 0; attempt < 5 && queuedResponse.mock.calls.length === 0; attempt += 1) {
      await Promise.resolve()
    }

    expect(queuedResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.stringContaining('registry init failed'),
      }),
    )

    const postFailureResponse = vi.fn()
    expect(
      listener(
        { type: 'REVOKE_BLOB_URL', payload: { blobUrl: 'blob:after-init-failure' } },
        {} as chrome.runtime.MessageSender,
        postFailureResponse,
      ),
    ).toBe(true)

    expect(postFailureResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.stringContaining('registry init failed'),
      }),
    )
  })
})

