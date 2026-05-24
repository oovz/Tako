import { describe, expect, it, vi } from 'vitest'

import {
  processArchiveFormatChapter,
  processNoneFormatChapter,
  type ChapterDownloadImageFn,
  type ChapterProcessingRuntime,
  type ProcessChapterStreamingOptions,
} from '@/entrypoints/offscreen/chapter-processing'
import { createTaskSettingsSnapshot } from '@/entrypoints/background/settings-snapshot'
import { DEFAULT_SETTINGS } from '@/src/storage/default-settings'

vi.mock('@/src/runtime/logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/entrypoints/offscreen/zip.worker.ts?worker', () => ({
  default: class MockZipWorker {
    onmessage: ((event: MessageEvent<unknown>) => void) | null = null
    onerror: ((event: ErrorEvent) => void) | null = null
    private extension: 'cbz' | 'zip' = 'cbz'

    postMessage(message: { type?: string; extension?: 'cbz' | 'zip' }) {
      if (message.type === 'init' && message.extension) {
        this.extension = message.extension
      }

      if (message.type === 'finalize') {
        this.onmessage?.({
          data: {
            success: true,
            filename: `Chapter 1.${this.extension}`,
            size: 4,
            buffer: new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer,
            imageCount: 2,
            format: this.extension,
          },
        } as MessageEvent<unknown>)
      }
    }

    terminate() {
      // no-op
    }
  },
}))

function createRuntime(): ChapterProcessingRuntime {
  return {
    withImageRetries: async (fn) => fn(),
    resolveWritableDownloadRoot: vi.fn(),
    emitFsaFallbackProgress: vi.fn(),
    requestBrowserBlobDownload: vi.fn(async () => ({ success: true })),
    retryWithBrowserDownloads: vi.fn(),
    getMemoryStats: vi.fn(() => null),
  }
}

function createDownloadImage(): ChapterDownloadImageFn {
  return vi.fn(async (url: string) => ({
    filename: url.endsWith('2.jpg') ? 'page-2.jpg' : 'page-1.jpg',
    data: new Uint8Array([1, 2, 3]).buffer,
    mimeType: 'image/jpeg',
  }))
}

function createBaseOptions<TFormat extends 'cbz' | 'zip' | 'none'>(
  format: TFormat,
): ProcessChapterStreamingOptions & { format: TFormat } {
  return {
    taskId: 'task-1',
    chapter: {
      id: 'chapter-1',
      title: 'Chapter 1',
      url: 'https://example.com/chapter-1',
      resolvedPath: `Series/Chapter 1${format === 'none' ? '' : `.${format}`}`,
      comicInfo: {},
    },
    seriesTitle: 'Series',
    format,
    includeComicInfo: false,
    downloadMode: 'browser' as const,
    overwriteExisting: false,
    comicInfoVersion: '2.0' as const,
    onProgress: vi.fn(async () => undefined),
    onArchiveProgress: vi.fn(async () => undefined),
    normalizeImageFilenames: true,
    imagePaddingDigits: 3 as const,
    settingsSnapshot: {
      ...createTaskSettingsSnapshot(DEFAULT_SETTINGS, 'test-site'),
      archiveFormat: format,
      rateLimitSettings: {
        image: { concurrency: 2, delayMs: 0 },
        chapter: { concurrency: 1, delayMs: 0 },
      },
    },
  }
}

describe('chapter processing format contracts', () => {
  it.each([
    ['cbz', 'application/x-cbz'],
    ['zip', 'application/zip'],
  ] as const)('creates one %s archive blob download with the correct filename and MIME type', async (format, mimeType) => {
    const runtime = createRuntime()

    const outcome = await processArchiveFormatChapter(runtime, {
      opts: createBaseOptions(format),
      urls: ['https://example.com/1.jpg', 'https://example.com/2.jpg'],
      integrationId: 'test-site',
      downloadImage: createDownloadImage(),
      normalizeSettings: {
        normalizeImageFilenames: true,
        imagePaddingDigits: 3,
      },
    })

    expect(outcome).toEqual({ status: 'completed' })
    expect(runtime.requestBrowserBlobDownload).toHaveBeenCalledTimes(1)
    expect(runtime.requestBrowserBlobDownload).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'task-1',
      chapterId: 'chapter-1',
      filename: `Series/Chapter 1.${format}`,
      blob: expect.any(Blob),
    }))
    const blob = vi.mocked(runtime.requestBrowserBlobDownload).mock.calls[0]?.[0].blob
    expect(blob?.type).toBe(mimeType)
  })

  it('streams no-archive browser downloads as separate image files under the chapter folder', async () => {
    const runtime = createRuntime()

    const outcome = await processNoneFormatChapter(runtime, {
      opts: createBaseOptions('none'),
      urls: ['https://example.com/1.jpg', 'https://example.com/2.jpg'],
      integrationId: 'test-site',
      downloadImage: createDownloadImage(),
      normalizeSettings: {
        normalizeImageFilenames: true,
        imagePaddingDigits: 3,
      },
    })

    expect(outcome).toEqual({ status: 'completed' })
    expect(runtime.requestBrowserBlobDownload).toHaveBeenCalledTimes(2)
    expect(vi.mocked(runtime.requestBrowserBlobDownload).mock.calls.map((call) => call[0].filename)).toEqual([
      'Series/Chapter 1/001.jpg',
      'Series/Chapter 1/002.jpg',
    ])
  })
})
