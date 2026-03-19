import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createTaskSettingsSnapshot } from '@/entrypoints/background/settings-snapshot'
import { DEFAULT_SETTINGS } from '@/src/storage/default-settings'

// Mock global chrome object
const chromeMock = {
    tabs: {
        query: vi.fn(),
    },
}
vi.stubGlobal('chrome', chromeMock)

import {
    queryActiveTabInLastFocusedNormalWindow,
    isInternalUrl,
    __resolveTabUrlForSupportCheckForTests,
    __selectPreferredSeriesContextTaskForTests,
    __deriveSeriesContextFromActiveTabContextForTests,
} from '@/entrypoints/sidepanel/hooks/useSidepanelSeriesContext'
import type { DownloadTaskState } from '@/src/types/queue-state'
import { NO_MANGA_FOUND_MSG, TAB_NOT_SUPPORTED_MSG } from '@/entrypoints/sidepanel/messages'

function makeTask(overrides: Partial<DownloadTaskState>): DownloadTaskState {
    const siteIntegrationId = overrides.siteIntegrationId ?? 'mangadex'
    return {
        id: 'task-1',
        siteIntegrationId,
        mangaId: 'series-1',
        seriesTitle: 'Series 1',
        chapters: [],
        status: 'queued',
        created: 1,
        settingsSnapshot: createTaskSettingsSnapshot(DEFAULT_SETTINGS, siteIntegrationId),
        ...overrides,
    }
}

describe('queryActiveTabInLastFocusedNormalWindow', () => {
    beforeEach(() => {
        vi.resetAllMocks()
    })

    it('returns the active tab in the current window when available', async () => {
        chromeMock.tabs.query.mockImplementation(async (queryInfo: unknown) => {
            const q = queryInfo as Record<string, unknown>
            if (q.currentWindow === true && q.active === true) {
                return [{ id: 100, active: true, url: 'chrome://newtab' }]
            }
            return []
        })

        const result = await queryActiveTabInLastFocusedNormalWindow()
        expect(result?.id).toBe(100)
        expect(chromeMock.tabs.query).toHaveBeenCalled()
    })

    it('falls back to any active tab from the current window if the direct active query returns nothing', async () => {
        chromeMock.tabs.query.mockImplementation(async (queryInfo: unknown) => {
            const q = queryInfo as Record<string, unknown>
            if (q.currentWindow === true && q.active === true) {
                return []
            }
            if (q.currentWindow === true) {
                return [
                    { id: 200, active: true, url: 'https://mangadex.org/title/123' },
                    { id: 201, active: false, url: 'https://example.com/' },
                ]
            }
            return []
        })

        const result = await queryActiveTabInLastFocusedNormalWindow()
        expect(result?.id).toBe(200)
        expect(chromeMock.tabs.query).toHaveBeenCalled()
    })

    it('falls back to any non-internal tab when no active tab can be found', async () => {
        chromeMock.tabs.query.mockImplementation(async (queryInfo: unknown) => {
            const q = queryInfo as Record<string, unknown>
            if (q.currentWindow === true && q.active === true) {
                return []
            }
            if (q.currentWindow === true) {
                return [
                    { id: 300, active: false, url: 'chrome://newtab' },
                    { id: 301, active: false, url: 'https://mangadex.org/title/123' },
                ]
            }
            return []
        })

        const result = await queryActiveTabInLastFocusedNormalWindow()
        expect(result?.id).toBe(301)
    })

    it('returns null when the current window has no tabs', async () => {
        chromeMock.tabs.query.mockResolvedValue([])
        const result = await queryActiveTabInLastFocusedNormalWindow()
        expect(result).toBeNull()
    })

    it('prefers the actual active tab even when it is internal and other non-internal tabs exist', async () => {
        chromeMock.tabs.query.mockImplementation(async (queryInfo: unknown) => {
            const q = queryInfo as Record<string, unknown>
            if (q.currentWindow === true && q.active === true) {
                return [{ id: 410, active: true, url: 'about:blank' }]
            }
            if (q.currentWindow === true) {
                return [
                    { id: 410, active: true, url: 'about:blank', lastAccessed: 100 },
                    { id: 411, active: false, url: 'https://mangadex.org/title/first-tab', lastAccessed: 200 },
                ]
            }
            return []
        })

        const result = await queryActiveTabInLastFocusedNormalWindow()

        expect(result?.id).toBe(410)
    })

    it('prefers last-focused active internal tab over non-internal fallback tabs', async () => {
        chromeMock.tabs.query.mockImplementation(async (queryInfo: unknown) => {
            const q = queryInfo as Record<string, unknown>
            if (q.currentWindow === true && q.active === true) {
                return []
            }
            if (q.lastFocusedWindow === true && q.active === true) {
                return [{ id: 510, active: true, url: 'chrome://newtab' }]
            }
            if (q.currentWindow === true) {
                return [
                    { id: 511, active: false, url: 'https://mangadex.org/title/other-tab', lastAccessed: 999 },
                ]
            }
            return []
        })

        const result = await queryActiveTabInLastFocusedNormalWindow()

        expect(result?.id).toBe(510)
    })

    it('falls back to a non-internal tab across all windows when the extension page owns the current window', async () => {
        chromeMock.tabs.query.mockImplementation(async (queryInfo: unknown) => {
            const q = queryInfo as Record<string, unknown>
            if (q.currentWindow === true && q.active === true) {
                return [{ id: 610, active: true, url: 'chrome-extension://test/sidepanel.html' }]
            }
            if (q.lastFocusedWindow === true && q.active === true) {
                return [{ id: 610, active: true, url: 'chrome-extension://test/sidepanel.html' }]
            }
            if (q.currentWindow === true) {
                return [{ id: 610, active: true, url: 'chrome-extension://test/sidepanel.html' }]
            }
            if (q.lastFocusedWindow === true) {
                return [{ id: 610, active: true, url: 'chrome-extension://test/sidepanel.html' }]
            }

            return [
                { id: 611, active: false, url: 'https://mangadex.org/title/real-target', lastAccessed: 500 },
                { id: 612, active: false, url: 'about:blank', lastAccessed: 100 },
            ]
        })

        const result = await queryActiveTabInLastFocusedNormalWindow()

        expect(result?.id).toBe(611)
    })

    it('should identify internal URLs correctly', () => {
        expect(isInternalUrl('chrome://newtab')).toBe(true)
        expect(isInternalUrl('https://google.com')).toBe(false)
        expect(isInternalUrl(undefined)).toBe(true)
        expect(isInternalUrl('')).toBe(true)
    })

    it('prefers committed tab.url over pendingUrl when resolving support-check URL', () => {
        const resolved = __resolveTabUrlForSupportCheckForTests({
            url: 'https://comic.pixiv.net/works/9012',
            pendingUrl: 'https://accounts.pixiv.net/?return_to=...',
        })

        expect(resolved).toBe('https://comic.pixiv.net/works/9012')
    })

    it('falls back to pendingUrl when tab.url is unavailable', () => {
        const resolved = __resolveTabUrlForSupportCheckForTests({
            pendingUrl: 'https://comic.pixiv.net/viewer/stories/44495',
        })

        expect(resolved).toBe('https://comic.pixiv.net/viewer/stories/44495')
    })

    it('prefers pendingUrl when the committed URL is an internal placeholder', () => {
        const resolved = __resolveTabUrlForSupportCheckForTests({
            url: 'about:blank',
            pendingUrl: 'chrome-extension://test/sidepanel.html',
        })

        expect(resolved).toBe('chrome-extension://test/sidepanel.html')
    })
})

describe('series-context task selection', () => {
    it('prefers downloading tasks over queued tasks regardless of queue order', () => {
        const selected = __selectPreferredSeriesContextTaskForTests([
            makeTask({ id: 'queued-first', status: 'queued', created: 1 }),
            makeTask({ id: 'active-second', status: 'downloading', created: 2 }),
        ])

        expect(selected?.id).toBe('active-second')
    })

    it('picks the oldest created task among tasks with the same preferred status', () => {
        const selected = __selectPreferredSeriesContextTaskForTests([
            makeTask({ id: 'active-newer', status: 'downloading', created: 20 }),
            makeTask({ id: 'active-older', status: 'downloading', created: 10 }),
            makeTask({ id: 'queued-fallback', status: 'queued', created: 1 }),
        ])

        expect(selected?.id).toBe('active-older')
    })

    it('falls back to the oldest queued task when no downloading task exists', () => {
        const selected = __selectPreferredSeriesContextTaskForTests([
            makeTask({ id: 'queued-newer', status: 'queued', created: 20 }),
            makeTask({ id: 'queued-older', status: 'queued', created: 10 }),
            makeTask({ id: 'completed-task', status: 'completed', created: 1 }),
        ])

        expect(selected?.id).toBe('queued-older')
    })
})

describe('activeTabContext mapping', () => {
    it('derives series data from a MangaPageState context', () => {
        const result = __deriveSeriesContextFromActiveTabContextForTests(
            {
                siteIntegrationId: 'mangadex',
                mangaId: 'series-ctx',
                seriesTitle: 'Series Context',
                chapters: [
                    {
                        id: 'ch-1',
                        url: 'https://mangadex.org/chapter/1',
                        title: 'Chapter 1',
                        index: 1,
                        chapterNumber: 1,
                        status: 'queued',
                        lastUpdated: 1,
                    },
                ],
                volumes: [],
                metadata: {
                    author: 'Author',
                    coverUrl: 'https://example.com/cover.jpg',
                },
                lastUpdated: 1,
            },
            'CBZ',
        )

        expect(result.mangaState?.mangaId).toBe('series-ctx')
        expect(result.mangaTitle).toBe('Series Context')
        expect(result.seriesId).toBe('series-ctx')
        expect(result.siteId).toBe('mangadex')
        expect(result.author).toBe('Author')
        expect(result.coverUrl).toBe('https://example.com/cover.jpg')
        expect(result.blockingMessage).toBeUndefined()
        expect(result.isLoading).toBe(false)
        expect(result.items).toHaveLength(1)
        expect('chapters' in result.items[0]).toBe(false)
        if (!('chapters' in result.items[0])) {
            expect(result.items[0].id).toBe('ch-1')
        }
    })

    it('derives loading state from a loading context', () => {
        const result = __deriveSeriesContextFromActiveTabContextForTests({ loading: true }, 'CBZ')

        expect(result.isLoading).toBe(true)
        expect(result.blockingMessage).toBeUndefined()
        expect(result.mangaState).toBeUndefined()
    })

    it('normalizes no-manga errors into the canonical blocking message', () => {
        const result = __deriveSeriesContextFromActiveTabContextForTests({ error: 'No manga found on this page' }, 'CBZ')

        expect(result.isLoading).toBe(false)
        expect(result.blockingMessage).toBe(NO_MANGA_FOUND_MSG)
    })

    it('maps null context to the generic no-series guidance state', () => {
        const result = __deriveSeriesContextFromActiveTabContextForTests(null, 'CBZ')

        expect(result.isLoading).toBe(false)
        expect(result.blockingMessage).toBe(TAB_NOT_SUPPORTED_MSG)
        expect(result.mangaState).toBeUndefined()
        expect(result.items).toEqual([])
    })
})

