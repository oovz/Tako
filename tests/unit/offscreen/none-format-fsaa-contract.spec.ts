import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createTaskSettingsSnapshot } from '@/entrypoints/background/settings-snapshot'
import { siteIntegrationRegistry } from '@/src/runtime/site-integration-registry'
import type { BackgroundIntegration } from '@/src/types/site-integrations'
import { DEFAULT_SETTINGS } from '@/src/storage/default-settings'
import { loadDownloadRootHandle, verifyPermission, writeBlobToPath } from '@/src/storage/fs-access'

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

describe('NONE format + FSAA custom folder contract (behavior-based)', () => {
  let worker: InstanceType<typeof import('@/entrypoints/offscreen/main').OffscreenWorker>

  beforeEach(async () => {
    vi.clearAllMocks()
    messages.length = 0
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:mock-url')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)

    const module = await import('@/entrypoints/offscreen/main')
    worker = new module.OffscreenWorker()

    const mockDownloadImage = vi.fn().mockImplementation(async (url: string) => ({
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

  it('writes images and ComicInfo.xml through FS Access when custom folder permission is granted', async () => {
    vi.mocked(loadDownloadRootHandle).mockResolvedValue({} as FileSystemDirectoryHandle)
    vi.mocked(verifyPermission).mockResolvedValue(true)

    const outcome = await worker.processDownloadChapter({
      taskId: 'task-none-custom',
      seriesKey: 'test-site:series-1',
      book: {
        siteIntegrationId: 'test-site',
        seriesTitle: 'Test Book',
        coverUrl: 'https://example.com/cover.jpg',
        metadata: {
          author: 'Test Author',
          description: 'A rich summary',
          genres: ['Action', 'Drama'],
          communityRating: 4.5,
          language: 'en',
          publisher: 'Test Publisher',
        },
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
      saveMode: 'fsa',
      integrationContext: {
        cookieHeader: 'PHPSESSID=abc123',
      },
    })

    expect(outcome.status).toBe('completed')
    expect(loadDownloadRootHandle).toHaveBeenCalledTimes(1)
    expect(verifyPermission).toHaveBeenCalledWith(expect.anything(), true)
    expect(writeBlobToPath).toHaveBeenCalled()
    expect(
      vi.mocked(writeBlobToPath).mock.calls.every((call) => call[3] === true),
    ).toBe(true)
    expect(
      vi.mocked(writeBlobToPath).mock.calls.some((call) => String(call[1]).endsWith('/ComicInfo.xml')),
    ).toBe(true)
    expect(
      vi.mocked(writeBlobToPath).mock.calls.some((call) => String(call[1]).endsWith('/000-cover.jpg')),
    ).toBe(true)
    expect(messages.some((message) => (message as { type?: string }).type === 'OFFSCREEN_DOWNLOAD_API_REQUEST')).toBe(false)

    const comicInfoCall = vi.mocked(writeBlobToPath).mock.calls.find((call) => String(call[1]).endsWith('/ComicInfo.xml'))
    expect(comicInfoCall).toBeDefined()

    const comicInfoBlob = comicInfoCall?.[2]
    expect(comicInfoBlob).toBeInstanceOf(Blob)

    const comicInfoText = await comicInfoBlob!.text()
    expect(comicInfoText).toContain('<Writer>Test Author</Writer>')
    expect(comicInfoText).toContain('<Summary>A rich summary</Summary>')
    expect(comicInfoText).toContain('<Genre>Action, Drama</Genre>')
    expect(comicInfoText).toContain('<CommunityRating>4.5</CommunityRating>')
    expect(comicInfoText).toContain('<LanguageISO>en</LanguageISO>')
    expect(comicInfoText).toContain('<Publisher>Test Publisher</Publisher>')
    expect(comicInfoText).toContain('<Format>Web</Format>')
  })

  it('falls back to browser download requests when custom folder permission is missing', async () => {
    vi.mocked(loadDownloadRootHandle).mockResolvedValue({} as FileSystemDirectoryHandle)
    vi.mocked(verifyPermission).mockResolvedValue(false)

    const outcome = await worker.processDownloadChapter({
      taskId: 'task-none-custom-permission-lost',
      seriesKey: 'test-site:series-1',
      book: {
        siteIntegrationId: 'test-site',
        seriesTitle: 'Test Book',
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
      saveMode: 'fsa',
      integrationContext: {
        cookieHeader: 'PHPSESSID=abc123',
      },
    })

    expect(outcome.status).toBe('completed')
    expect(
      messages.some((message) => (message as { type?: string }).type === 'SHOW_NOTIFICATION'),
    ).toBe(false)
    expect(
      messages.some((message) => (message as { type?: string }).type === 'OFFSCREEN_DOWNLOAD_API_REQUEST'),
    ).toBe(true)
  })
})

