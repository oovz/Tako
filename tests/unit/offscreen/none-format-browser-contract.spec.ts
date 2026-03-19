import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { siteIntegrationRegistry } from '@/src/runtime/site-integration-registry'
import { createTaskSettingsSnapshot } from '@/entrypoints/background/settings-snapshot'
import { DEFAULT_SETTINGS } from '@/src/storage/default-settings'
import type { BackgroundIntegration } from '@/src/types/site-integrations'
import { writeBlobToPath } from '@/src/storage/fs-access'

vi.mock('@/src/runtime/site-integration-registry', () => ({
  siteIntegrationRegistry: {
    getSiteIntegration: vi.fn(),
    findById: vi.fn(),
  },
  registerSiteIntegration: vi.fn(),
}))

vi.mock('@/src/runtime/rate-limit', () => ({
  scheduleForIntegrationScope: async (_id: string, _scope: string, fn: () => Promise<unknown>) => fn(),
}))

vi.mock('@/src/shared/filename-sanitizer', () => ({
  sanitizeFilename: (value: string) => value,
  normalizeImageFilename: () => 'normalized.jpg',
}))

vi.mock('@/entrypoints/offscreen/image-processor', () => ({
  PromiseQueue: class {
    add(fn: () => Promise<unknown>) {
      return fn()
    }
    getQueueLength() {
      return 0
    }
    clear() {
      // no-op
    }
  },
  withRetries: async (fn: () => Promise<unknown>) => fn(),
  withTimeout: async (fn: () => Promise<unknown>) => fn(),
  fetchChapterHtml: vi.fn(),
  getHttpStatusFromError: () => 500,
}))

vi.mock('@/src/storage/fs-access', () => ({
  loadDownloadRootHandle: vi.fn(),
  verifyPermission: vi.fn(),
  writeBlobToPath: vi.fn(),
}))

vi.mock('@/src/shared/settings-utils', () => ({
  resolveEffectiveRetries: async () => ({ image: 3, chapter: 3 }),
}))

const messages: unknown[] = []

global.chrome = {
  runtime: {
    sendMessage: vi.fn(async (message: { type?: string }) => {
      messages.push(message)
      if (message.type === 'OFFSCREEN_DOWNLOAD_API_REQUEST') {
        return { success: true, downloadId: 101 }
      }
      return { success: true }
    }),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
} as unknown as typeof chrome

const mockElement = {
  textContent: '',
  dataset: {},
  hidden: false,
  innerHTML: '',
}

global.document = {
  getElementById: vi.fn().mockReturnValue(mockElement),
  addEventListener: vi.fn(),
} as unknown as Document
global.window = global as unknown as Window & typeof globalThis
global.HTMLElement = class {} as unknown as typeof HTMLElement
global.HTMLDivElement = class {} as unknown as typeof HTMLDivElement

describe('NONE format + browser downloads contract (behavior-based)', () => {
  let worker: InstanceType<typeof import('@/entrypoints/offscreen/main').OffscreenWorker>
  let mockDownloadImage: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.clearAllMocks()
    messages.length = 0
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:mock-url')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)

    const module = await import('@/entrypoints/offscreen/main')
    worker = new module.OffscreenWorker()

    mockDownloadImage = vi.fn().mockImplementation(async (url: string) => ({
      filename: url.endsWith('cover.jpg')
        ? 'cover.jpg'
        : url.endsWith('2.jpg')
          ? 'img2.jpg'
          : 'img1.jpg',
      data: new ArrayBuffer(10),
      mimeType: 'image/jpeg',
    }))

    const mockBackgroundIntegration = {
      id: 'test-site',
      scope: 'test',
      chapter: {
        resolveImageUrls: async () => ['img1.jpg', 'img2.jpg'],
        downloadImage: mockDownloadImage,
        parseImageUrlsFromHtml: async () => ['img1.jpg', 'img2.jpg'],
        processImageUrls: async (raw: unknown) => raw,
      },
    } as unknown as BackgroundIntegration

    vi.mocked(siteIntegrationRegistry.findById).mockReturnValue({
      integration: { background: mockBackgroundIntegration },
    } as never)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('streams image files through OFFSCREEN_DOWNLOAD_API_REQUEST in browser mode', async () => {
    const outcome = await worker.processDownloadChapter({
      taskId: 'task-none-browser',
      seriesKey: 'test-site:series-1',
      book: {
        siteIntegrationId: 'test-site',
        seriesTitle: 'Test Book',
        coverUrl: 'https://example.com/cover.jpg',
      },
      chapter: {
        id: 'c1',
        title: 'Chapter 1',
        url: 'http://example.com/c1',
        index: 1,
        chapterNumber: 1,
        resolvedPath: 'Chapter 1',
      },
      settingsSnapshot: {
        ...createTaskSettingsSnapshot(DEFAULT_SETTINGS, 'test-site'),
        archiveFormat: 'none',
      },
      saveMode: 'downloads-api',
      integrationContext: {
        cookieHeader: 'PHPSESSID=abc123',
      },
    })

    expect(outcome.status).toBe('completed')

    const apiRequests = messages.filter(
      (message): message is { type: string; payload?: { filename?: string } } =>
        typeof message === 'object' && message !== null && (message as { type?: string }).type === 'OFFSCREEN_DOWNLOAD_API_REQUEST',
    )

    expect(apiRequests.length).toBeGreaterThanOrEqual(3)
    expect(apiRequests.some((request) => request.payload?.filename?.endsWith('000-cover.jpg'))).toBe(true)
    expect(apiRequests.some((request) => request.payload?.filename?.endsWith('ComicInfo.xml'))).toBe(true)
    expect(writeBlobToPath).not.toHaveBeenCalled()
  })
})

