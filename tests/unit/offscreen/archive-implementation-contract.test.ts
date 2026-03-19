import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createArchive, type ArchiveRequest } from '@/entrypoints/offscreen/archive-creator'

const { writeBlobToPath } = vi.hoisted(() => ({
  writeBlobToPath: vi.fn(),
}))

vi.mock('@/src/storage/fs-access', () => ({
  loadDownloadRootHandle: vi.fn(async () => ({ name: 'downloads-root' } as FileSystemDirectoryHandle)),
  verifyPermission: vi.fn(async () => true),
  writeBlobToPath,
}))

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
    chapterId: 'ch-1',
    chapterTitle: 'Chapter 1',
    images: [{ filename: '001.jpg', data: [1, 2, 3] }],
    format,
    resolvedPath: `Library/Series/Chapter 1.${format}`,
    downloadMode: 'browser',
  }
}

describe('archive creator behavior contracts', () => {
  const sendMessage = vi.fn()
  const createObjectUrl = vi.fn((object: Blob | MediaSource) => {
    capturedBlobType = object instanceof Blob ? object.type : undefined
    return 'blob:mock-url'
  })
  let capturedBlobType: string | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    capturedBlobType = undefined

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

    vi.spyOn(URL, 'createObjectURL').mockImplementation(createObjectUrl)
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('uses application/x-cbz blob MIME when format is cbz', async () => {
    MockWorker.nextResponse = {
      success: true,
      buffer: new ArrayBuffer(8),
      filename: 'chapter.cbz',
      size: 8,
      imageCount: 1,
      format: 'cbz',
    }

    const result = await createArchive(makeRequest('cbz'), () => {
      // progress callback noop
    })

    expect(result.success).toBe(true)
    expect(result.format).toBe('cbz')
    expect(capturedBlobType).toBe('application/x-cbz')
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'OFFSCREEN_DOWNLOAD_API_REQUEST',
        payload: expect.objectContaining({
          filename: 'Library/Series/Chapter 1.cbz',
        }),
      }),
    )
  })

  it('uses application/zip blob MIME when format is zip', async () => {
    MockWorker.nextResponse = {
      success: true,
      buffer: new ArrayBuffer(8),
      filename: 'chapter.zip',
      size: 8,
      imageCount: 1,
      format: 'zip',
    }

    const result = await createArchive(makeRequest('zip'), () => {
      // progress callback noop
    })

    expect(result.success).toBe(true)
    expect(result.format).toBe('zip')
    expect(capturedBlobType).toBe('application/zip')
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'OFFSCREEN_DOWNLOAD_API_REQUEST',
        payload: expect.objectContaining({
          filename: 'Library/Series/Chapter 1.zip',
        }),
      }),
    )
  })

  it('always overwrites when writing archives through FSA mode for MVP', async () => {
    MockWorker.nextResponse = {
      success: true,
      buffer: new ArrayBuffer(8),
      filename: 'chapter.cbz',
      size: 8,
      imageCount: 1,
      format: 'cbz',
    }

    const result = await createArchive(
      {
        ...makeRequest('cbz'),
        downloadMode: 'custom',
      },
      () => {
        // progress callback noop
      },
    )

    expect(result.success).toBe(true)
    expect(writeBlobToPath).toHaveBeenCalledWith(
      expect.anything(),
      'Library/Series/Chapter 1.cbz',
      expect.any(Blob),
      true,
    )
    expect(sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'OFFSCREEN_DOWNLOAD_API_REQUEST',
      }),
    )
  })
})

