import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createArchive, type ArchiveRequest } from '@/entrypoints/offscreen/archive-creator'

vi.mock('@/src/runtime/logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

type MockWorkerResponse = {
  success: boolean
  buffer: ArrayBuffer
  filename: string
  size: number
  imageCount: number
  format: string
  error?: string
}

class MockWorker {
  static nextResponse: MockWorkerResponse = {
    success: true,
    buffer: new ArrayBuffer(4),
    filename: 'chapter.cbz',
    size: 4,
    imageCount: 1,
    format: 'cbz',
  }

  onmessage: ((event: MessageEvent<MockWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null

  terminate(): void {
    // no-op
  }

  postMessage(): void {
    queueMicrotask(() => {
      this.onmessage?.({ data: MockWorker.nextResponse } as MessageEvent<MockWorkerResponse>)
    })
  }
}

function makeRequest(overrides: Partial<ArchiveRequest> = {}): ArchiveRequest {
  const format = overrides.format ?? 'cbz'
  return {
    taskId: 'task-1',
    chapterId: 'ch-6',
    chapterTitle: 'Chapter 6',
    images: [{ filename: '001.jpg', data: [1, 2, 3] }],
    format,
    resolvedPath: overrides.resolvedPath ?? `TMD/Hunter x Hunter/Chapter 6.${format}`,
    downloadMode: 'browser',
    ...overrides,
  }
}

describe('download filename behavior contract', () => {
  const sendMessage = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    MockWorker.nextResponse = {
      success: true,
      buffer: new ArrayBuffer(8),
      filename: 'chapter.cbz',
      size: 8,
      imageCount: 1,
      format: 'cbz',
    }

    vi.stubGlobal('Worker', MockWorker as unknown as typeof Worker)

    sendMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === 'OFFSCREEN_DOWNLOAD_API_REQUEST') {
        return { success: true, downloadId: 101 }
      }
      return { success: true }
    })

    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage,
      },
    })

    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:mock-url')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('normalizes leading dots/slashes and windows separators in resolvedPath before browser download request', async () => {
    await createArchive(
      makeRequest({
        format: 'cbz',
        resolvedPath: '.\\\\TMD\\\\Hunter x Hunter\\\\Chapter 6.cbz',
      }),
      () => {
        // progress callback noop
      },
    )

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'OFFSCREEN_DOWNLOAD_API_REQUEST',
        payload: expect.objectContaining({
          filename: 'TMD/Hunter x Hunter/Chapter 6.cbz',
        }),
      }),
    )
  })

  it('keeps cbz extension in OFFSCREEN_DOWNLOAD_API_REQUEST filename payload', async () => {
    await createArchive(makeRequest({ format: 'cbz', resolvedPath: '/Library/Series/Chapter.extra.cbz' }), () => {
      // progress callback noop
    })

    const requestCall = sendMessage.mock.calls
      .map(([message]) => message as { type?: string; payload?: { filename?: string } })
      .find((message) => message.type === 'OFFSCREEN_DOWNLOAD_API_REQUEST')

    expect(requestCall?.payload?.filename).toBe('Library/Series/Chapter.extra.cbz')
    expect(requestCall?.payload?.filename?.endsWith('.cbz')).toBe(true)
    expect(requestCall?.payload?.filename?.endsWith('.zip')).toBe(false)
  })

  it('keeps zip extension in OFFSCREEN_DOWNLOAD_API_REQUEST filename payload', async () => {
    MockWorker.nextResponse = {
      success: true,
      buffer: new ArrayBuffer(8),
      filename: 'chapter.zip',
      size: 8,
      imageCount: 1,
      format: 'zip',
    }

    await createArchive(makeRequest({ format: 'zip', resolvedPath: '/Library/Series/Chapter 6.zip' }), () => {
      // progress callback noop
    })

    const requestCall = sendMessage.mock.calls
      .map(([message]) => message as { type?: string; payload?: { filename?: string } })
      .find((message) => message.type === 'OFFSCREEN_DOWNLOAD_API_REQUEST')

    expect(requestCall?.payload?.filename).toBe('Library/Series/Chapter 6.zip')
    expect(requestCall?.payload?.filename?.endsWith('.zip')).toBe(true)
  })
})

