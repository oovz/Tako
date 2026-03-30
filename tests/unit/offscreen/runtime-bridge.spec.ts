import { beforeEach, describe, expect, it, vi } from 'vitest'

import { registerOffscreenRuntime } from '@/entrypoints/offscreen/runtime-bridge'

const loggerMocks = vi.hoisted(() => ({
  debug: vi.fn(),
  error: vi.fn(),
}))

vi.mock('@/src/runtime/logger', () => ({
  default: {
    debug: loggerMocks.debug,
    info: vi.fn(),
    warn: vi.fn(),
    error: loggerMocks.error,
  },
}))

describe('registerOffscreenRuntime', () => {
  const addListener = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()

    vi.stubGlobal('chrome', {
      runtime: {
        onMessage: {
          addListener,
        },
      },
    } as unknown as typeof chrome)
  })

  it('rejects malformed OFFSCREEN_CONTROL messages instead of treating them as successful no-ops', async () => {
    const worker = {
      initialize: vi.fn(async () => undefined),
      processDownloadChapter: vi.fn(),
      cancelTask: vi.fn(() => true),
      getActiveJobCount: vi.fn(() => 0),
    }

    registerOffscreenRuntime(worker)
    await Promise.resolve()

    const listener = addListener.mock.calls[0]?.[0] as (
      message: { type: string; payload?: unknown },
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: { success: boolean; error?: string }) => void,
    ) => boolean

    const sendResponse = vi.fn()
    const handled = listener(
      {
        type: 'OFFSCREEN_CONTROL',
        payload: { taskId: '', action: 'cancel' },
      },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    )

    expect(handled).toBe(true)
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: 'Invalid OFFSCREEN_CONTROL payload',
    })
    expect(worker.cancelTask).not.toHaveBeenCalled()
  })

  it('rejects malformed REVOKE_BLOB_URL messages before touching URL.revokeObjectURL', async () => {
    const worker = {
      initialize: vi.fn(async () => undefined),
      processDownloadChapter: vi.fn(),
      cancelTask: vi.fn(() => true),
      getActiveJobCount: vi.fn(() => 0),
    }
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', {
      revokeObjectURL,
    } as unknown as typeof URL)

    registerOffscreenRuntime(worker)
    await Promise.resolve()

    const listener = addListener.mock.calls[0]?.[0] as (
      message: { type: string; payload?: unknown },
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: { success: boolean; error?: string }) => void,
    ) => boolean

    const sendResponse = vi.fn()
    const handled = listener(
      {
        type: 'REVOKE_BLOB_URL',
        payload: { blobUrl: '' },
      },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    )

    expect(handled).toBe(true)
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: 'Invalid REVOKE_BLOB_URL payload',
    })
    expect(revokeObjectURL).not.toHaveBeenCalled()
  })
})
