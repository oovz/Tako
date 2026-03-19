import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/src/runtime/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

import { ensureOffscreenDocumentReady, scheduleOffscreenCloseIfIdle } from '@/entrypoints/background/offscreen-lifecycle'

afterEach(() => {
  vi.useRealTimers()
})

describe('ensureOffscreenDocumentReady', () => {
  const getContexts = vi.fn()
  const createDocument = vi.fn()
  const getURL = vi.fn(() => 'chrome-extension://test/offscreen.html')

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()

    vi.stubGlobal('chrome', {
      runtime: {
        getURL,
        getContexts,
      },
      offscreen: {
        createDocument,
        Reason: {
          BLOBS: 'BLOBS',
          WORKERS: 'WORKERS',
        },
      },
    })
  })

  it('creates the offscreen document when it does not already exist without polling readiness', async () => {
    getContexts.mockResolvedValue([])
    createDocument.mockResolvedValue(undefined)

    await ensureOffscreenDocumentReady()

    expect(createDocument).toHaveBeenCalledTimes(1)
  })

  it('reuses an existing offscreen document without polling readiness', async () => {
    getContexts.mockResolvedValue([{}])

    await ensureOffscreenDocumentReady()

    expect(createDocument).not.toHaveBeenCalled()
  })

  it('surfaces creation failures and allows a later retry', async () => {
    getContexts.mockResolvedValue([])
    createDocument
      .mockRejectedValueOnce(new Error('offscreen create failed'))
      .mockResolvedValueOnce(undefined)

    await expect(ensureOffscreenDocumentReady()).rejects.toThrow('offscreen create failed')
    await expect(ensureOffscreenDocumentReady()).resolves.toBeUndefined()

    expect(createDocument).toHaveBeenCalledTimes(2)
  })
})

describe('scheduleOffscreenCloseIfIdle', () => {
  const getContexts = vi.fn()
  const createDocument = vi.fn()
  const sendMessage = vi.fn()
  const closeDocument = vi.fn()
  const getURL = vi.fn(() => 'chrome-extension://test/offscreen.html')

  beforeEach(() => {
    vi.clearAllMocks()

    vi.stubGlobal('chrome', {
      runtime: {
        getURL,
        getContexts,
        sendMessage,
      },
      offscreen: {
        createDocument,
        closeDocument,
        Reason: {
          BLOBS: 'BLOBS',
          WORKERS: 'WORKERS',
        },
      },
    })
  })

  it('does not close the offscreen document when pending native downloads still exist', async () => {
    getContexts.mockResolvedValue([{}])
    sendMessage.mockResolvedValue({ success: true, isInitialized: true, activeJobCount: 0 })

    const pendingDownloadsStore = {
      snapshot: vi.fn(() => new Map<number, string>([[101, 'blob:chapter-101']])),
    }

    await scheduleOffscreenCloseIfIdle(
      {} as never,
      pendingDownloadsStore as never,
    )

    expect(closeDocument).not.toHaveBeenCalled()
  })

  it('closes the offscreen document when there are no active jobs and no pending native downloads', async () => {
    getContexts.mockResolvedValue([{}])
    sendMessage.mockResolvedValue({ success: true, isInitialized: true, activeJobCount: 0 })

    const pendingDownloadsStore = {
      snapshot: vi.fn(() => new Map<number, string>()),
    }

    await scheduleOffscreenCloseIfIdle(
      {} as never,
      pendingDownloadsStore as never,
    )

    expect(closeDocument).toHaveBeenCalledTimes(1)
  })
})

