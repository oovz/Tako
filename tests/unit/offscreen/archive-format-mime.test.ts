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

function makeRequest(format: 'cbz' | 'zip'): ArchiveRequest {
  return {
    taskId: 'task-1',
    chapterId: 'chapter-1',
    chapterTitle: 'Chapter 1',
    images: [{ filename: '001.jpg', data: [1, 2, 3] }],
    format,
    resolvedPath: `.\\Library\\Series\\Chapter 1.${format}`,
    downloadMode: 'browser',
  }
}

describe('archive browser download request contract', () => {
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
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:mock-url')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)

    sendMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === 'OFFSCREEN_DOWNLOAD_API_REQUEST') {
        return { success: true, id: 101 }
      }
      return { success: true }
    })

    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage,
      },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('uses OFFSCREEN_DOWNLOAD_API_REQUEST with blob URL for cbz browser downloads', async () => {
    await createArchive(makeRequest('cbz'), () => {
      // progress callback noop
    })

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'OFFSCREEN_DOWNLOAD_API_REQUEST',
        payload: expect.objectContaining({
          taskId: 'task-1',
          chapterId: 'chapter-1',
          fileUrl: 'blob:mock-url',
          filename: 'Library/Series/Chapter 1.cbz',
        }),
      }),
    )
    expect(
      sendMessage.mock.calls.some(
        ([message]) => (message as { type?: string }).type === 'OFFSCREEN_REQUEST_DOWNLOAD',
      ),
    ).toBe(false)
  })

  it('uses OFFSCREEN_DOWNLOAD_API_REQUEST with blob URL for zip browser downloads', async () => {
    MockWorker.nextResponse = {
      success: true,
      buffer: new ArrayBuffer(8),
      filename: 'chapter.zip',
      size: 8,
      imageCount: 1,
      format: 'zip',
    }

    await createArchive(makeRequest('zip'), () => {
      // progress callback noop
    })

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'OFFSCREEN_DOWNLOAD_API_REQUEST',
        payload: expect.objectContaining({
          taskId: 'task-1',
          chapterId: 'chapter-1',
          fileUrl: 'blob:mock-url',
          filename: 'Library/Series/Chapter 1.zip',
        }),
      }),
    )
  })
})

