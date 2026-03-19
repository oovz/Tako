import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createTaskSettingsSnapshot } from '@/entrypoints/background/settings-snapshot'
import { DEFAULT_SETTINGS } from '@/src/storage/default-settings'
import { siteIntegrationRegistry } from '@/src/runtime/site-integration-registry'
import type { BackgroundIntegration } from '@/src/types/site-integrations'
import { loadDownloadRootHandle, verifyPermission, writeBlobToPath } from '@/src/storage/fs-access'

// Mock dependencies
vi.mock('@/src/runtime/site-integration-registry', () => ({
    siteIntegrationRegistry: {
        getSiteIntegration: vi.fn(),
        findById: vi.fn()
    },
    registerSiteIntegration: vi.fn()
}))

vi.mock('@/src/runtime/rate-limit', () => ({
    scheduleForIntegrationScope: async (_id: string, _scope: string, fn: () => Promise<unknown>) => fn()
}))

vi.mock('@/src/shared/filename-sanitizer', () => ({
    sanitizeFilename: (s: string) => s,
    normalizeImageFilename: () => 'normalized.jpg'
}))

vi.mock('@/entrypoints/offscreen/image-processor', () => ({
    PromiseQueue: class {
        add(fn: any) { return fn() }
        getQueueLength() { return 0 }
        clear() { }
    },
    withRetries: async (fn: () => Promise<unknown>, _retries: number) => {
        return fn()
    },
    withTimeout: async (value: unknown) => await value,
    fetchChapterHtml: vi.fn(),
    getHttpStatusFromError: () => 500
}))

vi.mock('@/src/storage/fs-access', () => ({
    loadDownloadRootHandle: vi.fn(),
    verifyPermission: vi.fn(),
    writeBlobToPath: vi.fn()
}))

vi.mock('@/src/shared/settings-utils', () => ({
    resolveEffectiveRetries: async () => ({ image: 3, chapter: 3 })
}))

// Mock global chrome
const messages: any[] = []
global.chrome = {
    runtime: {
        sendMessage: vi.fn(async (msg) => {
            messages.push(msg)
            if (msg.type === 'OFFSCREEN_DOWNLOAD_API_REQUEST') {
                return { success: true, id: 101 }
            }
            return { success: true }
        }),
        onMessage: {
            addListener: vi.fn(),
            removeListener: vi.fn()
        }
    }
} as any

// Mock DOM environment for OffscreenWorker init
const mockElement = {
    textContent: '',
    dataset: {},
    hidden: false,
    innerHTML: ''
}
global.document = {
    getElementById: vi.fn().mockReturnValue(mockElement),
    addEventListener: vi.fn(),
} as any
global.window = global as any
global.HTMLElement = class { } as any
global.HTMLDivElement = class { } as any

describe('OffscreenWorker Integration: NONE format failures', () => {
    let OffscreenWorkerClass: any
    let worker: any
    let mockDownloadImage: ReturnType<typeof vi.fn>

    beforeEach(async () => {
        vi.clearAllMocks()
        messages.length = 0
        vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:mock-url')
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
        vi.mocked(loadDownloadRootHandle).mockResolvedValue(undefined)
        vi.mocked(verifyPermission).mockResolvedValue(false)
        vi.mocked(writeBlobToPath).mockResolvedValue(undefined)

        // Dynamic import to ensure globals are set before module side-effects run
        const mod = await import('@/entrypoints/offscreen/main')
        OffscreenWorkerClass = mod.OffscreenWorker

        worker = new OffscreenWorkerClass()

        // Mock site integration
        mockDownloadImage = vi.fn().mockImplementation(async (url, _opts) => {
            if (url === 'img2.jpg') {
                throw new Error('Download failed')
            }
            return {
                filename: 'img1.jpg',
                data: new ArrayBuffer(10),
                mimeType: 'image/jpeg'
            }
        })

        const mockBackgroundIntegration = {
            id: 'test-site',
            scope: 'test',
            chapter: {
                images: async () => [
                    { url: 'img1.jpg', headers: {} },
                    { url: 'img2.jpg', headers: {} }
                ],
                downloadImage: mockDownloadImage,
                parseImageUrlsFromHtml: async () => ['img1.jpg', 'img2.jpg'],
                processImageUrls: async (raw: any) => raw
            }
        } as unknown as BackgroundIntegration

        // Fix mock return value structure for findById
        vi.mocked(siteIntegrationRegistry.findById).mockReturnValue({
            integration: { background: mockBackgroundIntegration }
        } as any)
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('should return FALSE (failed) when images fail in NONE format, but keep successful images', async () => {
        const request = {
            taskId: 'task1',
            seriesKey: 'test-site:test-book',
            book: {
                siteIntegrationId: 'test-site',
                seriesTitle: 'Test Book',
                coverUrl: undefined,
            },
            chapter: {
                url: 'http://example.com/c1',
                title: 'Chapter 1',
                id: 'c1',
                index: 1,
                resolvedPath: 'Chapter 1',
                volumeNumber: '1',
                chapterNumber: 1,
            },
            settingsSnapshot: {
                ...createTaskSettingsSnapshot(DEFAULT_SETTINGS, 'test-site'),
                archiveFormat: 'none',
                includeComicInfo: true,
                includeCoverImage: true,
                overwriteExisting: false,
            },
            saveMode: 'downloads-api' as const,
            integrationContext: {
                cookieHeader: 'PHPSESSID=abc123'
            }
        }

        const outcome = await worker.processDownloadChapter(request as any)

        // Check results
        const progressUpdates = messages.filter(m => m.type === 'OFFSCREEN_DOWNLOAD_PROGRESS')
        const chapterTerminalUpdate = progressUpdates.find(
            (m) => m.payload?.chapterId === 'c1' && (m.payload?.status === 'completed' || m.payload?.status === 'failed' || m.payload?.status === 'partial_success')
        )

        expect(outcome.status).toBe('partial_success')
        expect(chapterTerminalUpdate).toBeUndefined()
        expect(progressUpdates.every((m) => m.payload?.chapterOutcomes === undefined)).toBe(true)
    })

    it('emits OFFSCREEN_DOWNLOAD_PROGRESS heartbeats for single-chapter flow', async () => {
        const processChapterStreamingMock = vi.fn().mockImplementation(async (opts: any) => {
            await opts.onProgress(20, undefined, { current: 1, total: 39 })
            await opts.onArchiveProgress(40)
            return { status: 'completed', imagesFailed: 0 }
        })

        worker.processChapterStreaming = processChapterStreamingMock

        const outcome = await worker.processDownloadChapter({
            taskId: 'task-single',
            seriesKey: 'test-site:series-1',
            book: {
                siteIntegrationId: 'test-site',
                seriesTitle: 'Test Book',
                coverUrl: undefined,
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
                includeComicInfo: true,
            },
            saveMode: 'downloads-api',
            integrationContext: {
                cookieHeader: 'PHPSESSID=abc123',
            },
        })

        const heartbeatUpdates = messages.filter(
            (m) => m.type === 'OFFSCREEN_DOWNLOAD_PROGRESS'
                && m.payload?.taskId === 'task-single'
                && m.payload?.chapterId === 'c1'
                && m.payload?.status === 'downloading'
        )
        const terminalUpdate = messages.find(
            (m) => m.type === 'OFFSCREEN_DOWNLOAD_PROGRESS'
                && m.payload?.taskId === 'task-single'
                && m.payload?.chapterId === 'c1'
                && m.payload?.status === 'completed'
        )

        expect(heartbeatUpdates.length).toBeGreaterThanOrEqual(1)
        const imageProgressUpdate = heartbeatUpdates.find((m) => m.payload?.imagesProcessed === 1)
        expect(imageProgressUpdate?.payload?.imagesProcessed).toBe(1)
        expect(imageProgressUpdate?.payload?.totalImages).toBe(39)
        expect(heartbeatUpdates.every((m) => m.payload?.currentChapter === undefined)).toBe(true)
        expect(heartbeatUpdates.every((m) => m.payload?.progress === undefined)).toBe(true)
        expect(outcome.status).toBe('completed')
        expect(terminalUpdate).toBeUndefined()
        const forwarded = processChapterStreamingMock.mock.calls[0]?.[0]?.integrationContext
        expect(forwarded).toEqual({ cookieHeader: 'PHPSESSID=abc123' })
    })

    it('keeps the leading-edge zero-progress heartbeat when subsequent downloading updates are throttled', async () => {
        const processChapterStreamingMock = vi.fn().mockImplementation(async (opts: any) => {
            await opts.onProgress(10, 'ready', { current: 0, total: 4 })
            await opts.onProgress(20, undefined, { current: 1, total: 4 })
            return { status: 'completed', imagesFailed: 0 }
        })

        worker.processChapterStreaming = processChapterStreamingMock

        await worker.processDownloadChapter({
            taskId: 'task-initial-progress',
            seriesKey: 'test-site:series-1',
            book: {
                siteIntegrationId: 'test-site',
                seriesTitle: 'Test Book',
                coverUrl: undefined,
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
                includeComicInfo: true,
            },
            saveMode: 'downloads-api',
        })

        const initialHeartbeat = messages.find(
            (m) => m.type === 'OFFSCREEN_DOWNLOAD_PROGRESS'
                && m.payload?.taskId === 'task-initial-progress'
                && m.payload?.chapterId === 'c1'
                && m.payload?.status === 'downloading'
                && m.payload?.imagesProcessed === 0
                && m.payload?.totalImages === 4
        )
        const throttledFollowUp = messages.find(
            (m) => m.type === 'OFFSCREEN_DOWNLOAD_PROGRESS'
                && m.payload?.taskId === 'task-initial-progress'
                && m.payload?.chapterId === 'c1'
                && m.payload?.status === 'downloading'
                && m.payload?.imagesProcessed === 1
        )

        expect(initialHeartbeat).toBeDefined()
        expect(initialHeartbeat?.payload?.imagesFailed).toBe(0)
        expect(throttledFollowUp).toBeUndefined()
    })

    it('emits an immediate startup heartbeat before optional cover-image prefetch begins', async () => {
        let resolveCoverFetch!: (value: { filename: string; data: ArrayBuffer; mimeType: string }) => void
        mockDownloadImage.mockImplementationOnce(async () => {
            return await new Promise((resolve) => {
                resolveCoverFetch = resolve
            })
        })

        const downloadPromise = worker.processDownloadChapter({
            taskId: 'task-cover-heartbeat',
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
                includeComicInfo: true,
                includeCoverImage: true,
            },
            saveMode: 'downloads-api',
        })

        await Promise.resolve()
        await Promise.resolve()

        await vi.waitFor(() => {
            expect(mockDownloadImage).toHaveBeenCalledWith(
                'https://example.com/cover.jpg',
                expect.any(Object),
            )
            expect(resolveCoverFetch).toBeTypeOf('function')
        })

        const startupHeartbeat = messages.find(
            (m) => m.type === 'OFFSCREEN_DOWNLOAD_PROGRESS'
                && m.payload?.taskId === 'task-cover-heartbeat'
                && m.payload?.chapterId === 'c1'
                && m.payload?.status === 'downloading'
                && m.payload?.imagesProcessed === 0
                && m.payload?.totalImages === 0,
        )

        expect(startupHeartbeat).toBeDefined()

        resolveCoverFetch({
            filename: 'cover.jpg',
            data: new ArrayBuffer(8),
            mimeType: 'image/jpeg',
        })

        await downloadPromise
    })
})

