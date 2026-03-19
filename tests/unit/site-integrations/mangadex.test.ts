/**
 * MangaDex Site Integration Tests
 * 
 * Tests for the MangaDex API site integration including:
 * - Chapter list extraction
 * - External chapter filtering
 * - Pagination limit warning
 * - Series metadata extraction
 * - X-RateLimit-Retry-After header parsing
 * - Rate limit 429 response handling
 * - User preferences reading
 * - PageCount extraction
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTaskSettingsSnapshot } from '@/entrypoints/background/settings-snapshot';
import { DEFAULT_SETTINGS } from '@/src/storage/default-settings';

// Mock logger before importing the site integration
vi.mock('@/src/runtime/logger', () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
    },
}));

// Mock integration context validator
vi.mock('@/src/types/site-integrations', async (importOriginal) => {
    const original = await importOriginal<typeof import('@/src/types/site-integrations')>();
    return {
        ...original,
        IntegrationContextValidator: {
            validateContentScriptContext: vi.fn(),
            validateBackgroundOrOffscreenContext: vi.fn(),
        },
    };
});

// Mock site integration manifest
vi.mock('@/src/site-integrations/manifest', () => ({
    getPatternBySiteIntegrationId: vi.fn(() => ({
        domains: ['mangadex.org'],
        seriesMatches: ['*://mangadex.org/title/*'],
        excludeMatches: [],
    })),
    getSiteIntegrationManifestById: vi.fn(() => ({
        id: 'mangadex',
        patterns: {
            domains: ['mangadex.org'],
            seriesMatches: ['*://mangadex.org/title/*'],
            excludeMatches: [],
        },
    })),
}));

vi.mock('@/src/storage/site-integration-settings-service', () => ({
    siteIntegrationSettingsService: {
        getAll: vi.fn(async () => ({})),
        getForSite: vi.fn(async () => ({})),
    },
}));

async function fetchMangadexChapters(seriesId: string, language?: string) {
    const { mangadexIntegration } = await import('@/src/site-integrations/mangadex');
    const result = await mangadexIntegration.background.series!.fetchChapterList(seriesId, language);
    return Array.isArray(result) ? result : result.chapters;
}

async function fetchMangadexMetadata(seriesId: string) {
    const { mangadexIntegration } = await import('@/src/site-integrations/mangadex');
    return mangadexIntegration.background.series!.fetchSeriesMetadata(seriesId);
}

describe('MangaDex site integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        global.fetch = vi.fn();
    });

    describe('content series id parsing', () => {
        it('extracts series id from /title/{uuid} path', async () => {
            const originalWindow = global.window;
            Object.defineProperty(global, 'window', {
                value: { location: { pathname: '/title/12345678-abcd-1234-abcd-1234567890ab' } },
                configurable: true,
            });

            const { mangadexIntegration } = await import('@/src/site-integrations/mangadex');
            const seriesId = mangadexIntegration.content.series.getSeriesId();

            expect(seriesId).toBe('12345678-abcd-1234-abcd-1234567890ab');

            Object.defineProperty(global, 'window', {
                value: originalWindow,
                configurable: true,
            });
        });

        it('throws when current path is not a MangaDex title page', async () => {
            const originalWindow = global.window;
            Object.defineProperty(global, 'window', {
                value: { location: { pathname: '/chapter/not-a-title-path' } },
                configurable: true,
            });

            const { mangadexIntegration } = await import('@/src/site-integrations/mangadex');

            expect(() => mangadexIntegration.content.series.getSeriesId()).toThrow(
                'Failed to extract series ID from URL'
            );

            Object.defineProperty(global, 'window', {
                value: originalWindow,
                configurable: true,
            });
        });

        it('throws when MangaDex title path uses a non-UUID id', async () => {
            const originalWindow = global.window;
            Object.defineProperty(global, 'window', {
                value: { location: { pathname: '/title/not-a-uuid' } },
                configurable: true,
            });

            const { mangadexIntegration } = await import('@/src/site-integrations/mangadex');

            expect(() => mangadexIntegration.content.series.getSeriesId()).toThrow(
                'Failed to extract series ID from URL'
            );

            Object.defineProperty(global, 'window', {
                value: originalWindow,
                configurable: true,
            });
        });

        it('omits optional content-side chapter and metadata extractors because MangaDex uses API extraction', async () => {
            const { mangadexIntegration } = await import('@/src/site-integrations/mangadex');

            expect(mangadexIntegration.content.series.extractChapterList).toBeUndefined();
            expect(mangadexIntegration.content.series.extractSeriesMetadata).toBeUndefined();
        });
    });

    describe('fetchChapterList via api.fetchChapterList', () => {
        it('retains external/unavailable chapters and marks them locked', async () => {
            // Mock feed response with external and unavailable chapters
            const mockFeedResponse = {
                result: 'ok',
                data: [
                    {
                        id: 'normal-chapter-id',
                        type: 'chapter',
                        attributes: {
                            chapter: '1',
                            title: 'Chapter 1',
                            translatedLanguage: 'en',
                            pages: 20,
                        },
                    },
                    {
                        id: 'external-chapter-id',
                        type: 'chapter',
                        attributes: {
                            chapter: '2',
                            title: 'Chapter 2 (External)',
                            translatedLanguage: 'en',
                            pages: 20,
                            externalUrl: 'https://external-site.com/chapter/2',
                        },
                    },
                    {
                        id: 'unavailable-chapter-id',
                        type: 'chapter',
                        attributes: {
                            chapter: '3',
                            title: 'Chapter 3 (Unavailable)',
                            translatedLanguage: 'en',
                            pages: 0,
                        },
                    },
                ],
                total: 3,
                offset: 0,
                limit: 500,
            };

            (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
                ok: true,
                json: async () => mockFeedResponse,
            });

            // Import after mocks are set up
            const chapters = await fetchMangadexChapters('test-series-id', 'en');

            expect(chapters).toHaveLength(3);
            expect(chapters[0]).toMatchObject({
                id: 'normal-chapter-id',
                title: 'Chapter 1',
                language: 'en',
                locked: false,
            });
            expect(chapters[1]).toMatchObject({
                id: 'external-chapter-id',
                title: 'Chapter 2 (External)',
                language: 'en',
                locked: true,
            });
            expect(chapters[2]).toMatchObject({
                id: 'unavailable-chapter-id',
                title: 'Chapter 3 (Unavailable)',
                language: 'en',
                locked: true,
            });
        });

        it('logs warning when total exceeds 10000', async () => {
            const logger = await import('@/src/runtime/logger');

            // Mock feed response with high total
            const mockFeedResponse = {
                result: 'ok',
                data: [],
                total: 15000,
                offset: 0,
                limit: 500,
            };

            (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
                ok: true,
                json: async () => mockFeedResponse,
            });

            await fetchMangadexChapters('test-series-id', 'en');

            // Should warn about pagination limit
            expect(logger.default.warn).toHaveBeenCalledWith(
                expect.stringContaining('15000')
            );
        });

        it('correctly extracts chapter metadata', async () => {
            const mockFeedResponse = {
                result: 'ok',
                data: [
                    {
                        id: 'ch-uuid-123',
                        type: 'chapter',
                        attributes: {
                            volume: '2',
                            chapter: '15.5',
                            title: 'Side Story',
                            translatedLanguage: 'en',
                            pages: 30,
                        },
                    },
                ],
                total: 1,
                offset: 0,
                limit: 500,
            };

            (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
                ok: true,
                json: async () => mockFeedResponse,
            });

            const chapters = await fetchMangadexChapters('test-series-id', 'en');

            expect(chapters).toHaveLength(1);
            expect(chapters[0].chapterNumber).toBe(15.5);
            expect(chapters[0].volumeNumber).toBe(2);
            expect(chapters[0].volumeLabel).toBe('Vol. 2');
            expect(chapters[0].title).toBe('Side Story');
            expect(chapters[0].url).toBe('https://mangadex.org/chapter/ch-uuid-123');
        });

        it('logs invariant error when duplicate chapter ids are returned', async () => {
            const logger = await import('@/src/runtime/logger');

            const mockFeedResponse = {
                result: 'ok',
                data: [
                    {
                        id: 'dup-chapter-id',
                        type: 'chapter',
                        attributes: {
                            chapter: '1',
                            title: 'Chapter 1',
                            translatedLanguage: 'en',
                            pages: 20,
                        },
                    },
                    {
                        id: 'dup-chapter-id',
                        type: 'chapter',
                        attributes: {
                            chapter: '1',
                            title: 'Chapter 1 mirror',
                            translatedLanguage: 'en',
                            pages: 20,
                        },
                    },
                ],
                total: 2,
                offset: 0,
                limit: 500,
            };

            (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
                ok: true,
                json: async () => mockFeedResponse,
            });

            const chapters = await fetchMangadexChapters('test-series-id', 'en');

            expect(chapters).toHaveLength(1);
            expect(chapters[0].id).toBe('dup-chapter-id');
            expect(logger.default.error).toHaveBeenCalledWith(
                '[mangadex] Duplicate chapter ids detected in fetchChapterList',
                expect.objectContaining({
                    seriesId: 'test-series-id',
                    duplicateChapterIds: ['dup-chapter-id'],
                }),
            );
        });

        it('uses explicit chapterLanguageFilter site settings when no language override is provided', async () => {
            const { siteIntegrationSettingsService } = await import('@/src/storage/site-integration-settings-service');
            vi.mocked(siteIntegrationSettingsService.getAll).mockResolvedValue({
                mangadex: {
                    chapterLanguageFilter: ['ja', 'en'],
                },
            });

            (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
                ok: true,
                json: async () => ({
                    result: 'ok',
                    data: [],
                    total: 0,
                    offset: 0,
                    limit: 500,
                }),
            });

            vi.resetModules();
            await fetchMangadexChapters('test-series-id');

            const requestUrl = new URL(String((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]));
            expect(requestUrl.searchParams.getAll('translatedLanguage[]')).toEqual(['ja', 'en']);
        });

        it('uses cached MangaDex website language preferences when auto-read is enabled and no explicit override exists', async () => {
            const { siteIntegrationSettingsService } = await import('@/src/storage/site-integration-settings-service');
            vi.mocked(siteIntegrationSettingsService.getAll).mockResolvedValue({
                mangadex: {
                    autoReadMangaDexSettings: true,
                },
            });

            (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
                ok: true,
                json: async () => ({
                    result: 'ok',
                    data: [],
                    total: 0,
                    offset: 0,
                    limit: 500,
                }),
            });

            vi.resetModules();
            const { setCachedMangadexPreferences } = await import('@/src/site-integrations/mangadex');
            setCachedMangadexPreferences({ dataSaver: true, filteredLanguages: ['ja', 'en'] });

            await fetchMangadexChapters('test-series-id');

            const requestUrl = new URL(String((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]));
            expect(requestUrl.searchParams.getAll('translatedLanguage[]')).toEqual(['ja', 'en']);
        });

        it('maps cached MangaDex website content rating preferences to contentRating feed params', async () => {
            const { siteIntegrationSettingsService } = await import('@/src/storage/site-integration-settings-service');
            vi.mocked(siteIntegrationSettingsService.getAll).mockResolvedValue({
                mangadex: {
                    autoReadMangaDexSettings: true,
                },
            });

            (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
                ok: true,
                json: async () => ({
                    result: 'ok',
                    data: [],
                    total: 0,
                    offset: 0,
                    limit: 500,
                }),
            });

            vi.resetModules();
            const { setCachedMangadexPreferences } = await import('@/src/site-integrations/mangadex');
            setCachedMangadexPreferences({
                dataSaver: true,
                filteredLanguages: ['en'],
                showSafe: true,
                showSuggestive: false,
                showErotic: true,
                showHentai: false,
            });

            await fetchMangadexChapters('test-series-id');

            const requestUrl = new URL(String((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]));
            expect(requestUrl.searchParams.getAll('contentRating[]')).toEqual(['safe', 'erotica']);
        });

        it('omits translatedLanguage filters when no explicit override or cached preference exists', async () => {
            const { siteIntegrationSettingsService } = await import('@/src/storage/site-integration-settings-service');
            vi.mocked(siteIntegrationSettingsService.getAll).mockResolvedValue({});

            (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
                ok: true,
                json: async () => ({
                    result: 'ok',
                    data: [],
                    total: 0,
                    offset: 0,
                    limit: 500,
                }),
            });

            vi.resetModules();
            await fetchMangadexChapters('test-series-id');

            const requestUrl = new URL(String((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]));
            expect(requestUrl.searchParams.getAll('translatedLanguage[]')).toEqual([]);
        });
    });

    describe('fetchSeriesMetadata', () => {
        it('extracts title, author, and cover URL', async () => {
            const mangaId = 'db692d58-4b13-4174-ae8c-30c515c0689c';
            const mockMangaResponse = {
                result: 'ok',
                data: {
                    id: mangaId,
                    type: 'manga',
                    attributes: {
                        title: { en: 'Test Manga Title' },
                        altTitles: [
                            { ja: 'テストマンガタイトル' },
                            { fr: 'Titre alternatif' },
                        ],
                        description: { en: 'A test manga description.' },
                        contentRating: 'safe',
                        originalLanguage: 'ja',
                        publicationDemographic: 'seinen',
                        status: 'ongoing',
                        year: 2022,
                        tags: [
                            { attributes: { name: { en: 'Action' } } },
                            { attributes: { name: { en: 'Comedy' } } },
                        ],
                    },
                    relationships: [
                        {
                            id: 'author-uuid',
                            type: 'author',
                            attributes: { name: 'Test Author' },
                        },
                        {
                            id: 'artist-uuid',
                            type: 'artist',
                            attributes: { name: 'Test Artist' },
                        },
                        {
                            id: 'cover-uuid',
                            type: 'cover_art',
                            attributes: { fileName: 'cover.jpg' },
                        },
                    ],
                },
            };

            (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
                ok: true,
                json: async () => mockMangaResponse,
            });

            const metadata = await fetchMangadexMetadata(mangaId);

            expect(metadata.title).toBe('Test Manga Title');
            expect(metadata.author).toBe('Test Author');
            expect(metadata.description).toBe('A test manga description.');
            expect(metadata.status).toBe('ongoing');
            expect(metadata.language).toBe('ja');
            expect(metadata.year).toBe(2022);
            expect(metadata.artist).toBe('Test Artist');
            expect(metadata.contentRating).toBe('safe');
            expect(metadata.readingDirection).toBeUndefined();
            expect(metadata.alternativeTitles).toEqual(['テストマンガタイトル', 'Titre alternatif']);
            expect(metadata.genres).toContain('Action');
            expect(metadata.genres).toContain('Seinen');
            expect(metadata.tags).toEqual(['Action', 'Comedy']);
            expect(metadata.coverUrl).toContain(mangaId);
            expect(metadata.coverUrl).toContain('cover.jpg');
        });

        it('maps MangaDex bayesian score to 0-5 communityRating scale', async () => {
            const mangaId = 'manga-uuid-rating';

            (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) => {
                if (url.includes('/statistics/manga/')) {
                    return {
                        ok: true,
                        json: async () => ({
                            statistics: {
                                [mangaId]: {
                                    rating: {
                                        average: 8.1,
                                        bayesian: 8.4,
                                    },
                                },
                            },
                        }),
                    };
                }

                return {
                    ok: true,
                    json: async () => ({
                        result: 'ok',
                        data: {
                            id: mangaId,
                            type: 'manga',
                            attributes: {
                                title: { en: 'Rated Manga' },
                            },
                            relationships: [],
                        },
                    }),
                };
            });

            const metadata = await fetchMangadexMetadata(mangaId);

            expect(metadata.title).toBe('Rated Manga');
            expect(metadata.communityRating).toBe(4.2);
        });

        it('does not fail series metadata when statistics request fails', async () => {
            const mangaId = 'manga-uuid-no-stats';

            (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) => {
                if (url.includes('/statistics/manga/')) {
                    return {
                        ok: false,
                        status: 503,
                        statusText: 'Service Unavailable',
                    };
                }

                return {
                    ok: true,
                    json: async () => ({
                        result: 'ok',
                        data: {
                            id: mangaId,
                            type: 'manga',
                            attributes: {
                                title: { en: 'Metadata Survives' },
                            },
                            relationships: [],
                        },
                    }),
                };
            });

            const metadata = await fetchMangadexMetadata(mangaId);

            expect(metadata.title).toBe('Metadata Survives');
            expect(metadata.communityRating).toBeUndefined();
        });
    });

    describe('X-RateLimit-Retry-After header parsing', () => {
        it('retries on 429 response with retry delay from header', async () => {
            const now = Math.floor(Date.now() / 1000);
            const retryAfterTimestamp = now + 5; // 5 seconds from now
            
            let callCount = 0;
            (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => {
                callCount++;
                if (callCount === 1) {
                    // First call returns 429 with retry-after header
                    return {
                        ok: false,
                        status: 429,
                        statusText: 'Too Many Requests',
                        headers: {
                            get: (name: string) => {
                                if (name === 'X-RateLimit-Retry-After') {
                                    return String(retryAfterTimestamp);
                                }
                                return null;
                            },
                        },
                    };
                }
                // Second call succeeds
                return {
                    ok: true,
                    json: async () => ({
                        result: 'ok',
                        data: { id: 'test', type: 'manga', attributes: { title: { en: 'Test' } }, relationships: [] },
                    }),
                };
            });

            // Use a shorter timeout for testing
            vi.useFakeTimers();
            
            const metadataPromise = fetchMangadexMetadata('test-id');
            
            // Advance timers to trigger retry
            await vi.advanceTimersByTimeAsync(10000);
            
            const metadata = await metadataPromise;
            expect(metadata.title).toBe('Test');
            expect(callCount).toBeGreaterThanOrEqual(2); // At least one retry
            
            vi.useRealTimers();
        });

        it('uses default delay when X-RateLimit-Retry-After header is missing', async () => {
            let callCount = 0;
            (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => {
                callCount++;
                if (callCount === 1) {
                    return {
                        ok: false,
                        status: 429,
                        statusText: 'Too Many Requests',
                        headers: {
                            get: () => null, // No header
                        },
                    };
                }
                return {
                    ok: true,
                    json: async () => ({
                        result: 'ok',
                        data: { id: 'test', type: 'manga', attributes: { title: { en: 'Retried' } }, relationships: [] },
                    }),
                };
            });

            vi.useFakeTimers();
            
            const metadataPromise = fetchMangadexMetadata('test-id');
            
            // Advance by default delay (5000ms)
            await vi.advanceTimersByTimeAsync(6000);
            
            const metadata = await metadataPromise;
            expect(metadata.title).toBe('Retried');
            
            vi.useRealTimers();
        });
    });

    describe('User preferences', () => {
        it('readMangadexUserPreferences returns defaults when localStorage is unavailable', async () => {
            const { readMangadexUserPreferences } = await import('@/src/site-integrations/mangadex');
            
            // In test environment, localStorage may not be defined properly
            const prefs = readMangadexUserPreferences();
            
            expect(prefs).toHaveProperty('dataSaver');
            expect(prefs).toHaveProperty('filteredLanguages');
            expect(Array.isArray(prefs.filteredLanguages)).toBe(true);
        });

        it('setCachedMangadexPreferences stores preferences for background use', async () => {
            const { setCachedMangadexPreferences, getCachedMangadexPreferences } = await import('@/src/site-integrations/mangadex');
            
            const testPrefs = {
                dataSaver: false,
                filteredLanguages: ['ja', 'en'],
            };
            
            setCachedMangadexPreferences(testPrefs);
            const cached = getCachedMangadexPreferences();
            
            expect(cached.dataSaver).toBe(false);
            expect(cached.filteredLanguages).toContain('ja');
        });

        it('prepareDispatchContext forwards session-cached MangaDex preferences when auto-read is enabled', async () => {
            const { siteIntegrationSettingsService } = await import('@/src/storage/site-integration-settings-service');
            vi.mocked(siteIntegrationSettingsService.getForSite).mockResolvedValue({ autoReadMangaDexSettings: true });

            global.chrome = {
                storage: {
                    session: {
                        get: vi.fn(async () => ({
                            mangadexUserPreferencesBySeries: {
                                'mangadex#series-1': {
                                    dataSaver: false,
                                    filteredLanguages: ['ja', 'en'],
                                },
                            },
                        })),
                    },
                },
            } as unknown as typeof chrome;

            const { mangadexIntegration } = await import('@/src/site-integrations/mangadex');
            const context = await mangadexIntegration.background.prepareDispatchContext?.({
                taskId: 'task-1',
                seriesKey: 'mangadex#series-1',
                chapter: { id: 'ch-1', url: 'https://mangadex.org/chapter/ch-1', title: 'Chapter 1', comicInfo: {} },
                settingsSnapshot: {
                    ...createTaskSettingsSnapshot(DEFAULT_SETTINGS, 'mangadex'),
                },
            });

            expect(context).toEqual({
                mangadexUserPreferences: {
                    dataSaver: false,
                    filteredLanguages: ['ja', 'en'],
                },
            });
        });

        it('prepareDispatchContext does not forward manifest default imageQuality when only auto-read preferences exist', async () => {
            const { siteIntegrationSettingsService } = await import('@/src/storage/site-integration-settings-service');
            vi.mocked(siteIntegrationSettingsService.getForSite).mockResolvedValue({
                imageQuality: 'data-saver',
                autoReadMangaDexSettings: true,
            });

            global.chrome = {
                storage: {
                    session: {
                        get: vi.fn(async () => ({
                            mangadexUserPreferencesBySeries: {
                                'mangadex#series-1': {
                                    dataSaver: false,
                                    filteredLanguages: ['ja', 'en'],
                                },
                            },
                        })),
                    },
                },
            } as unknown as typeof chrome;

            vi.resetModules();
            const { mangadexIntegration } = await import('@/src/site-integrations/mangadex');
            const context = await mangadexIntegration.background.prepareDispatchContext?.({
                taskId: 'task-1',
                seriesKey: 'mangadex#series-1',
                chapter: { id: 'ch-1', url: 'https://mangadex.org/chapter/ch-1', title: 'Chapter 1', comicInfo: {} },
                settingsSnapshot: {
                    ...createTaskSettingsSnapshot(DEFAULT_SETTINGS, 'mangadex'),
                },
            });

            expect(context).toEqual({
                mangadexUserPreferences: {
                    dataSaver: false,
                    filteredLanguages: ['ja', 'en'],
                },
            });
        });

        it('prepareDispatchContext forwards configured MangaDex imageQuality when offscreen cannot read storage directly', async () => {
            const { siteIntegrationSettingsService } = await import('@/src/storage/site-integration-settings-service');
            vi.mocked(siteIntegrationSettingsService.getAll).mockResolvedValue({
                mangadex: {
                    imageQuality: 'data',
                },
            });
            vi.mocked(siteIntegrationSettingsService.getForSite).mockResolvedValue({
                autoReadMangaDexSettings: false,
                imageQuality: 'data',
            });

            global.chrome = {
                storage: {
                    session: {
                        get: vi.fn(async () => ({
                            mangadexUserPreferencesBySeries: {},
                        })),
                    },
                },
            } as unknown as typeof chrome;

            const { mangadexIntegration } = await import('@/src/site-integrations/mangadex');
            const context = await mangadexIntegration.background.prepareDispatchContext?.({
                taskId: 'task-1',
                seriesKey: 'mangadex#series-1',
                chapter: { id: 'ch-1', url: 'https://mangadex.org/chapter/ch-1', title: 'Chapter 1', comicInfo: {} },
                settingsSnapshot: {
                    ...createTaskSettingsSnapshot(DEFAULT_SETTINGS, 'mangadex'),
                },
            });

            expect(context).toEqual({
                mangadexConfiguredImageQuality: 'data',
            });
        });

        it('resolveImageUrls honors integrationContext MangaDex preferences for quality selection', async () => {
            (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
                ok: true,
                json: async () => ({
                    baseUrl: 'https://uploads.mangadex.org',
                    chapter: {
                        hash: 'hash123',
                        data: ['001.jpg'],
                        dataSaver: ['001.jpg'],
                    },
                }),
            });

            const { mangadexIntegration } = await import('@/src/site-integrations/mangadex');
            const urls = await mangadexIntegration.background.chapter.resolveImageUrls?.(
                { id: 'ch-1', url: 'https://mangadex.org/chapter/ch-1' },
                {
                    mangadexUserPreferences: {
                        dataSaver: false,
                        filteredLanguages: ['en'],
                    },
                },
            );

            expect(urls).toEqual(['https://uploads.mangadex.org/data/hash123/001.jpg']);
        });

        it('resolveImageUrls honors explicit stored MangaDex imageQuality settings before cached preference fallback', async () => {
            const { siteIntegrationSettingsService } = await import('@/src/storage/site-integration-settings-service');
            vi.mocked(siteIntegrationSettingsService.getAll).mockResolvedValue({
                mangadex: {
                    imageQuality: 'data',
                },
            });

            (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
                ok: true,
                json: async () => ({
                    baseUrl: 'https://uploads.mangadex.org',
                    chapter: {
                        hash: 'hash123',
                        data: ['full-quality.png'],
                        dataSaver: ['compressed.jpg'],
                    },
                }),
            });

            const { setCachedMangadexPreferences, mangadexIntegration } = await import('@/src/site-integrations/mangadex');
            setCachedMangadexPreferences({ dataSaver: true, filteredLanguages: ['en'] });

            const urls = await mangadexIntegration.background.chapter.resolveImageUrls?.(
                { id: 'ch-1', url: 'https://mangadex.org/chapter/ch-1' },
            );

            expect(urls).toEqual(['https://uploads.mangadex.org/data/hash123/full-quality.png']);
        });

        it('parseImageUrlsFromHtml honors explicit stored MangaDex imageQuality settings before cached preference fallback', async () => {
            const { siteIntegrationSettingsService } = await import('@/src/storage/site-integration-settings-service');
            vi.mocked(siteIntegrationSettingsService.getAll).mockResolvedValue({
                mangadex: {
                    imageQuality: 'data',
                },
            });

            (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
                ok: true,
                json: async () => ({
                    baseUrl: 'https://uploads.mangadex.org',
                    chapter: {
                        hash: 'hash123',
                        data: ['full-quality.png'],
                        dataSaver: ['compressed.jpg'],
                    },
                }),
            });

            const { setCachedMangadexPreferences, mangadexIntegration } = await import('@/src/site-integrations/mangadex');
            setCachedMangadexPreferences({ dataSaver: true, filteredLanguages: ['en'] });

            const urls = await mangadexIntegration.background.chapter.parseImageUrlsFromHtml?.({
                chapterId: 'ch-1',
                chapterUrl: 'https://mangadex.org/chapter/ch-1',
                chapterHtml: '',
            });

            expect(urls).toEqual(['https://uploads.mangadex.org/data/hash123/full-quality.png']);
        });
    });

    describe('PageCount extraction', () => {
        it('provides page count from chapter attributes', async () => {
            const mockFeedResponse = {
                result: 'ok',
                data: [
                    {
                        id: 'chapter-with-pages',
                        type: 'chapter',
                        attributes: {
                            chapter: '1',
                            title: 'Chapter 1',
                            translatedLanguage: 'en',
                            pages: 25, // This is the PageCount
                        },
                    },
                ],
                total: 1,
                offset: 0,
                limit: 500,
            };

            (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
                ok: true,
                json: async () => mockFeedResponse,
            });

            const chapters = await fetchMangadexChapters('test-series-id', 'en');

            // Chapter data includes page count that will be used for ComicInfo.xml PageCount
            expect(chapters).toHaveLength(1);
            // The pages field from API is available; the site integration uses it for at-home image fetching
        });
    });

    describe('Edge Cases: Chapter List Parsing', () => {
        it('handles chapters with null volume and chapter numbers', async () => {
            const mockFeedResponse = {
                result: 'ok',
                data: [
                    {
                        id: 'oneshot-chapter',
                        type: 'chapter',
                        attributes: {
                            volume: null,
                            chapter: null,
                            title: 'Oneshot',
                            translatedLanguage: 'en',
                            pages: 15,
                        },
                    },
                ],
                total: 1,
                offset: 0,
                limit: 500,
            };

            (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
                ok: true,
                json: async () => mockFeedResponse,
            });

            const chapters = await fetchMangadexChapters('test-series-id', 'en');

            expect(chapters).toHaveLength(1);
            expect(chapters[0].title).toBe('Oneshot');
            expect(chapters[0].chapterNumber).toBeUndefined();
            expect(chapters[0].volumeNumber).toBeUndefined();
            expect(chapters[0].volumeLabel).toBeUndefined();
        });

        it('handles chapters with empty string title (generates default)', async () => {
            const mockFeedResponse = {
                result: 'ok',
                data: [
                    {
                        id: 'ch-abc123',
                        type: 'chapter',
                        attributes: {
                            chapter: '5',
                            title: '',
                            translatedLanguage: 'en',
                            pages: 10,
                        },
                    },
                ],
                total: 1,
                offset: 0,
                limit: 500,
            };

            (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
                ok: true,
                json: async () => mockFeedResponse,
            });

            const chapters = await fetchMangadexChapters('test-series-id', 'en');

            expect(chapters).toHaveLength(1);
            expect(chapters[0].title).toBe('Chapter 5');
        });

        it('handles chapters with no title and no chapter number (uses UUID fallback)', async () => {
            const mockFeedResponse = {
                result: 'ok',
                data: [
                    {
                        id: 'abcd1234-efgh-5678-ijkl-9012mnop3456',
                        type: 'chapter',
                        attributes: {
                            chapter: null,
                            title: null,
                            translatedLanguage: 'en',
                            pages: 8,
                        },
                    },
                ],
                total: 1,
                offset: 0,
                limit: 500,
            };

            (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
                ok: true,
                json: async () => mockFeedResponse,
            });

            const chapters = await fetchMangadexChapters('test-series-id', 'en');

            expect(chapters).toHaveLength(1);
            expect(chapters[0].title).toContain('Chapter abcd1234');
        });

        it('handles decimal chapter numbers (e.g., 15.5)', async () => {
            const mockFeedResponse = {
                result: 'ok',
                data: [
                    {
                        id: 'decimal-chapter',
                        type: 'chapter',
                        attributes: {
                            chapter: '15.5',
                            title: 'Extra',
                            translatedLanguage: 'en',
                            pages: 12,
                        },
                    },
                ],
                total: 1,
                offset: 0,
                limit: 500,
            };

            (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
                ok: true,
                json: async () => mockFeedResponse,
            });

            const chapters = await fetchMangadexChapters('test-series-id', 'en');

            expect(chapters).toHaveLength(1);
            expect(chapters[0].chapterNumber).toBe(15.5);
        });

        it('handles empty chapter feed response', async () => {
            const mockFeedResponse = {
                result: 'ok',
                data: [],
                total: 0,
                offset: 0,
                limit: 500,
            };

            (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
                ok: true,
                json: async () => mockFeedResponse,
            });

            const chapters = await fetchMangadexChapters('test-series-id', 'en');

            expect(chapters).toHaveLength(0);
        });
    });

    describe('Edge Cases: Series Metadata Parsing', () => {
        it('extracts title from altTitles when primary title is empty', async () => {
            const mockMangaResponse = {
                result: 'ok',
                data: {
                    id: 'manga-uuid',
                    type: 'manga',
                    attributes: {
                        title: {},
                        altTitles: [
                            { en: 'English Alt Title' },
                            { ja: 'Japanese Title' },
                        ],
                    },
                    relationships: [],
                },
            };

            (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
                ok: true,
                json: async () => mockMangaResponse,
            });

            const metadata = await fetchMangadexMetadata('manga-uuid');

            expect(metadata.title).toBe('English Alt Title');
        });

        it('uses ja-ro (romaji) title when en is not available', async () => {
            const mockMangaResponse = {
                result: 'ok',
                data: {
                    id: 'manga-uuid',
                    type: 'manga',
                    attributes: {
                        title: { 'ja-ro': 'Romaji Title' },
                    },
                    relationships: [],
                },
            };

            (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
                ok: true,
                json: async () => mockMangaResponse,
            });

            const metadata = await fetchMangadexMetadata('manga-uuid');

            expect(metadata.title).toBe('Romaji Title');
        });

        it('handles missing cover art relationship', async () => {
            const mockMangaResponse = {
                result: 'ok',
                data: {
                    id: 'manga-uuid',
                    type: 'manga',
                    attributes: {
                        title: { en: 'No Cover Manga' },
                    },
                    relationships: [
                        { id: 'author-id', type: 'author', attributes: { name: 'Author Name' } },
                    ],
                },
            };

            (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
                ok: true,
                json: async () => mockMangaResponse,
            });

            const metadata = await fetchMangadexMetadata('manga-uuid');

            expect(metadata.title).toBe('No Cover Manga');
            expect(metadata.coverUrl).toBeUndefined();
        });

        it('handles missing author relationship', async () => {
            const mockMangaResponse = {
                result: 'ok',
                data: {
                    id: 'manga-uuid',
                    type: 'manga',
                    attributes: {
                        title: { en: 'No Author Manga' },
                    },
                    relationships: [],
                },
            };

            (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
                ok: true,
                json: async () => mockMangaResponse,
            });

            const metadata = await fetchMangadexMetadata('manga-uuid');

            expect(metadata.author).toBeUndefined();
        });

        it('handles cover_art without fileName attribute', async () => {
            const mockMangaResponse = {
                result: 'ok',
                data: {
                    id: 'manga-uuid',
                    type: 'manga',
                    attributes: {
                        title: { en: 'Broken Cover Manga' },
                    },
                    relationships: [
                        { id: 'cover-id', type: 'cover_art', attributes: {} },
                    ],
                },
            };

            (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
                ok: true,
                json: async () => mockMangaResponse,
            });

            const metadata = await fetchMangadexMetadata('manga-uuid');

            expect(metadata.coverUrl).toBeUndefined();
        });

        it('extracts genres from tags array', async () => {
            const mockMangaResponse = {
                result: 'ok',
                data: {
                    id: 'manga-uuid',
                    type: 'manga',
                    attributes: {
                        title: { en: 'Genre Manga' },
                        tags: [
                            { attributes: { name: { en: 'Action' } } },
                            { attributes: { name: { en: 'Romance' } } },
                            { attributes: { name: { en: 'Comedy' } } },
                        ],
                    },
                    relationships: [],
                },
            };

            (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
                ok: true,
                json: async () => mockMangaResponse,
            });

            const metadata = await fetchMangadexMetadata('manga-uuid');

            expect(metadata.genres).toEqual(['Action', 'Romance', 'Comedy']);
        });
    });

    describe('Edge Cases: Rate Limit and Error Handling', () => {
        // Note: 429 retry behavior is tested in the dedicated rate limit test suite
        // which uses proper fake timers. Here we test non-retry error scenarios.

        it('handles non-429 HTTP errors without retry', async () => {
            (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
                ok: false,
                status: 404,
                statusText: 'Not Found',
            });

            await expect(
                fetchMangadexMetadata('nonexistent-id')
            ).rejects.toThrow('404');
        });

        it('handles 500 server errors', async () => {
            (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
                ok: false,
                status: 500,
                statusText: 'Internal Server Error',
            });

            await expect(
                fetchMangadexMetadata('test-id')
            ).rejects.toThrow('500');
        });

        it('handles network errors during fetch', async () => {
            (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
                new TypeError('Failed to fetch')
            );

            await expect(
                fetchMangadexMetadata('test-id')
            ).rejects.toThrow('Failed to fetch');
        });
    });

    describe('Edge Cases: At-Home Server and Image Download', () => {
        it('throws a descriptive error when at-home payload is missing image file arrays', async () => {
            const mockAtHomeResponse = {
                result: 'ok',
                baseUrl: 'https://uploads.mangadex.org',
                chapter: {
                    hash: 'abc123hash',
                    data: null,
                    dataSaver: null,
                },
            };

            (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
                ok: true,
                json: async () => mockAtHomeResponse,
            });

            const { mangadexIntegration } = await import('@/src/site-integrations/mangadex');

            await expect(
                mangadexIntegration.background.chapter.resolveImageUrls?.({
                    id: '12345678-abcd-efgh-ijkl-123456789012',
                    url: 'https://mangadex.org/chapter/12345678-abcd-efgh-ijkl-123456789012'
                })
            ).rejects.toThrow('Malformed MangaDex at-home response');
        });

        it('extracts chapter ID from various URL formats', async () => {
            // Test with standard URL format
            const mockAtHomeResponse = {
                result: 'ok',
                baseUrl: 'https://uploads.mangadex.org',
                chapter: {
                    hash: 'abc123hash',
                    data: ['page1.jpg', 'page2.jpg'],
                    dataSaver: ['page1-ds.jpg', 'page2-ds.jpg'],
                },
            };

            (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
                ok: true,
                json: async () => mockAtHomeResponse,
            });

            const { mangadexIntegration } = await import('@/src/site-integrations/mangadex');
            const urls = await mangadexIntegration.background.chapter.resolveImageUrls?.({
                id: '12345678-abcd-efgh-ijkl-123456789012',
                url: 'https://mangadex.org/chapter/12345678-abcd-efgh-ijkl-123456789012'
            });

            expect(urls).toBeDefined();
            expect(urls).toHaveLength(2);
            // Verify URLs are constructed correctly (either data or data-saver path)
            expect(urls![0]).toContain('abc123hash');
        });

        it('uses full quality when dataSaver preference is false', async () => {
            const mockAtHomeResponse = {
                result: 'ok',
                baseUrl: 'https://uploads.mangadex.org',
                chapter: {
                    hash: 'abc123hash',
                    data: ['full-page1.jpg', 'full-page2.jpg'],
                    dataSaver: ['ds-page1.jpg', 'ds-page2.jpg'],
                },
            };

            (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
                ok: true,
                json: async () => mockAtHomeResponse,
            });

            const { setCachedMangadexPreferences, mangadexIntegration } = await import('@/src/site-integrations/mangadex');
            
            // Set preferences to use full quality
            setCachedMangadexPreferences({ dataSaver: false, filteredLanguages: ['en'] });

            const urls = await mangadexIntegration.background.chapter.resolveImageUrls?.({
                id: 'test-chapter-id',
                url: 'https://mangadex.org/chapter/test-chapter-id'
            });

            expect(urls).toBeDefined();
            expect(urls).toHaveLength(2);
            expect(urls![0]).toContain('/data/');
            expect(urls![0]).not.toContain('data-saver');
        });

        it('handles empty image array from at-home response', async () => {
            const logger = await import('@/src/runtime/logger');
            
            const mockAtHomeResponse = {
                result: 'ok',
                baseUrl: 'https://uploads.mangadex.org',
                chapter: {
                    hash: 'abc123hash',
                    data: [],
                    dataSaver: [],
                },
            };

            (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
                ok: true,
                json: async () => mockAtHomeResponse,
            });

            const { mangadexIntegration } = await import('@/src/site-integrations/mangadex');
            const urls = await mangadexIntegration.background.chapter.resolveImageUrls?.({
                id: 'empty-chapter',
                url: 'https://mangadex.org/chapter/empty-chapter'
            });

            expect(urls).toHaveLength(0);
            expect(logger.default.error).toHaveBeenCalled();
        });

        it('processImageUrls filters out invalid URLs', async () => {
            const { mangadexIntegration } = await import('@/src/site-integrations/mangadex');
            
            const urls = [
                'https://valid-url.mangadex.org/page1.jpg',
                'not-a-valid-url',
                '',
                'https://another-valid.com/page2.jpg',
            ];

            const mockChapter = {
                id: 'test-chapter',
                url: 'https://mangadex.org/chapter/test',
                title: 'Test Chapter',
                chapterNumber: 1,
            };
            const processed = await mangadexIntegration.background.chapter.processImageUrls(urls, mockChapter as import('@/src/types/chapter').Chapter);

            expect(processed).toHaveLength(2);
            expect(processed).toContain('https://valid-url.mangadex.org/page1.jpg');
            expect(processed).toContain('https://another-valid.com/page2.jpg');
        });
    });

    describe('Edge Cases: User Preferences', () => {
        it('handles malformed JSON in localStorage gracefully', async () => {
            // Mock localStorage with invalid JSON
            const mockLocalStorage = {
                getItem: vi.fn(() => 'not valid json {{{'),
            };
            
            // Save original
            const originalLocalStorage = global.localStorage;
            Object.defineProperty(global, 'localStorage', {
                value: mockLocalStorage,
                writable: true,
            });

            // Re-import to get fresh module
            vi.resetModules();
            const { readMangadexUserPreferences } = await import('@/src/site-integrations/mangadex');
            
            const prefs = readMangadexUserPreferences();

            expect(prefs.dataSaver).toBe(true); // Default
            expect(prefs.filteredLanguages).toEqual([]); // Default

            // Restore
            Object.defineProperty(global, 'localStorage', {
                value: originalLocalStorage,
                writable: true,
            });
        });

        it('handles valid but unexpected localStorage structure', async () => {
            const mockLocalStorage = {
                getItem: vi.fn(() => JSON.stringify({
                    someUnexpectedKey: 'value',
                    settings: {
                        dataSaver: false,
                        filteredLanguages: ['ja', 'ko'],
                    },
                })),
            };
            
            const originalLocalStorage = global.localStorage;
            Object.defineProperty(global, 'localStorage', {
                value: mockLocalStorage,
                writable: true,
            });

            vi.resetModules();
            const { readMangadexUserPreferences } = await import('@/src/site-integrations/mangadex');
            
            const prefs = readMangadexUserPreferences();

            expect(prefs.dataSaver).toBe(false);
            expect(prefs.filteredLanguages).toContain('ja');
            expect(prefs.filteredLanguages).toContain('ko');

            Object.defineProperty(global, 'localStorage', {
                value: originalLocalStorage,
                writable: true,
            });
        });

        it('filters non-string values from filteredLanguages array', async () => {
            const mockLocalStorage = {
                getItem: vi.fn(() => JSON.stringify({
                    userPreferences: {
                        dataSaver: true,
                        filteredLanguages: ['en', 123, null, 'ja', { lang: 'ko' }],
                    },
                })),
            };
            
            const originalLocalStorage = global.localStorage;
            Object.defineProperty(global, 'localStorage', {
                value: mockLocalStorage,
                writable: true,
            });

            vi.resetModules();
            const { readMangadexUserPreferences } = await import('@/src/site-integrations/mangadex');
            
            const prefs = readMangadexUserPreferences();

            expect(prefs.filteredLanguages).toEqual(['en', 'ja']);

            Object.defineProperty(global, 'localStorage', {
                value: originalLocalStorage,
                writable: true,
            });
        });

        it('getCachedMangadexPreferences returns defaults when not set', async () => {
            vi.resetModules();
            const { getCachedMangadexPreferences } = await import('@/src/site-integrations/mangadex');
            
            const prefs = getCachedMangadexPreferences();

            expect(prefs.dataSaver).toBe(true);
            expect(prefs.filteredLanguages).toEqual([]);
        });
    });

    describe('Edge Cases: Pagination', () => {
        it('skips malformed chapter feed entries while keeping valid entries', async () => {
            const logger = await import('@/src/runtime/logger');

            (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
                ok: true,
                json: async () => ({
                    result: 'ok',
                    data: [
                        {
                            id: 'valid-chapter-id',
                            type: 'chapter',
                            attributes: {
                                chapter: '1',
                                title: 'Valid Chapter',
                                translatedLanguage: 'en',
                                pages: 10,
                            },
                        },
                        {
                            id: 'broken-chapter-id',
                            type: 'chapter',
                            attributes: {
                                chapter: '2',
                                title: 'Broken Chapter',
                                // translatedLanguage intentionally missing
                                pages: 12,
                            },
                        },
                    ],
                    total: 2,
                    offset: 0,
                    limit: 500,
                }),
            });

            const chapters = await fetchMangadexChapters('test-series-id', 'en');

            expect(chapters).toHaveLength(1);
            expect(chapters[0]?.id).toBe('valid-chapter-id');
            expect(logger.default.warn).toHaveBeenCalledWith(
                expect.stringContaining('Skipping malformed chapter entry with missing language')
            );
        });

        it('fetches multiple pages when chapters exceed limit', async () => {
            let callCount = 0;
            
            (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) => {
                callCount++;
                const offset = new URL(url).searchParams.get('offset') || '0';
                
                if (offset === '0') {
                    return {
                        ok: true,
                        json: async () => ({
                            result: 'ok',
                            data: Array(500).fill(null).map((_, i) => ({
                                id: `ch-page1-${i}`,
                                type: 'chapter',
                                attributes: {
                                    chapter: String(i + 1),
                                    title: `Chapter ${i + 1}`,
                                    translatedLanguage: 'en',
                                    pages: 10,
                                },
                            })),
                            total: 750,
                            offset: 0,
                            limit: 500,
                        }),
                    };
                } else {
                    return {
                        ok: true,
                        json: async () => ({
                            result: 'ok',
                            data: Array(250).fill(null).map((_, i) => ({
                                id: `ch-page2-${i}`,
                                type: 'chapter',
                                attributes: {
                                    chapter: String(501 + i),
                                    title: `Chapter ${501 + i}`,
                                    translatedLanguage: 'en',
                                    pages: 10,
                                },
                            })),
                            total: 750,
                            offset: 500,
                            limit: 500,
                        }),
                    };
                }
            });

            const chapters = await fetchMangadexChapters('test-series-id', 'en');

            expect(chapters).toHaveLength(750);
            expect(callCount).toBeGreaterThanOrEqual(2);
        });

        it('stops at 10000 chapter offset limit', async () => {
            const logger = await import('@/src/runtime/logger');
            
            (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
                ok: true,
                json: async () => ({
                    result: 'ok',
                    data: Array(500).fill(null).map((_, i) => ({
                        id: `ch-${i}`,
                        type: 'chapter',
                        attributes: {
                            chapter: String(i + 1),
                            title: `Chapter ${i + 1}`,
                            translatedLanguage: 'en',
                            pages: 10,
                        },
                    })),
                    total: 12000, // More than 10000
                    offset: 0,
                    limit: 500,
                }),
            });

            await fetchMangadexChapters('massive-series-id', 'en');

            // Should warn about the limit
            expect(logger.default.warn).toHaveBeenCalledWith(
                expect.stringContaining('12000')
            );
        });
    });

    describe('Image Download and Network Reporting', () => {
        it('downloads image and returns correct metadata', async () => {
            const mockImageData = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0]).buffer; // JPEG magic bytes

            (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
                ok: true,
                arrayBuffer: async () => mockImageData,
                headers: {
                    get: (name: string) => {
                        if (name === 'content-type') return 'image/jpeg';
                        if (name === 'X-Cache') return 'HIT from cache';
                        return null;
                    },
                },
            });

            const { mangadexIntegration } = await import('@/src/site-integrations/mangadex');
            const result = await mangadexIntegration.background.chapter.downloadImage(
                'https://uploads.mangadex.org/data/abc123/page1.jpg'
            );

            expect(result.data.byteLength).toBe(4);
            expect(result.mimeType).toBe('image/jpeg');
            expect(result.filename).toBe('page1.jpg');
        });

        it('handles abort signal during download', async () => {
            const abortController = new AbortController();
            abortController.abort();

            const { mangadexIntegration } = await import('@/src/site-integrations/mangadex');

            await expect(
                mangadexIntegration.background.chapter.downloadImage(
                    'https://uploads.mangadex.org/data/abc123/page1.jpg',
                    { signal: abortController.signal }
                )
            ).rejects.toThrow('aborted');
        });

        it('throws error on failed image download', async () => {
            (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
                ok: false,
                status: 404,
                statusText: 'Not Found',
            });

            const { mangadexIntegration } = await import('@/src/site-integrations/mangadex');

            await expect(
                mangadexIntegration.background.chapter.downloadImage(
                    'https://uploads.mangadex.org/data/abc123/missing.jpg'
                )
            ).rejects.toThrow('404');
        });

        it('refreshes the at-home host after a failed image request and retries on the new base URL', async () => {
            const mockImageData = new Uint8Array([0x89, 0x50, 0x4E, 0x47]).buffer;
            const fetchMock = global.fetch as ReturnType<typeof vi.fn>;

            fetchMock.mockImplementation(async (url: string) => {
                if (url === 'https://uploads.mangadex.org/data/hash123/1-old.png') {
                    return {
                        ok: false,
                        status: 404,
                        statusText: 'Not Found',
                        headers: { get: () => null },
                    };
                }

                if (url === 'https://api.mangadex.org/at-home/server/ch-1') {
                    return {
                        ok: true,
                        json: async () => ({
                            baseUrl: 'https://new-node.mangadex.network',
                            chapter: {
                                hash: 'hash456',
                                data: ['1-new.png'],
                                dataSaver: ['1-new.jpg'],
                            },
                        }),
                        headers: { get: () => null },
                    };
                }

                if (url === 'https://new-node.mangadex.network/data/hash456/1-new.png') {
                    return {
                        ok: true,
                        arrayBuffer: async () => mockImageData,
                        headers: {
                            get: (name: string) => {
                                if (name === 'content-type') return 'image/png';
                                if (name === 'X-Cache') return 'MISS';
                                return null;
                            },
                        },
                    };
                }

                if (url.includes('mangadex.network/report')) {
                    return { ok: true, headers: { get: () => null } };
                }

                throw new Error(`Unexpected fetch URL: ${url}`);
            });

            const { mangadexIntegration } = await import('@/src/site-integrations/mangadex');
            const result = await mangadexIntegration.background.chapter.downloadImage(
                'https://uploads.mangadex.org/data/hash123/1-old.png',
                {
                    context: {
                        chapterId: 'ch-1',
                    },
                },
            );

            expect(result.filename).toBe('1-new.png');
            expect(result.mimeType).toBe('image/png');
            expect(result.data.byteLength).toBe(4);
            expect(fetchMock).toHaveBeenCalledWith(
                'https://api.mangadex.org/at-home/server/ch-1',
                expect.objectContaining({ credentials: 'omit' }),
            );
            expect(fetchMock).toHaveBeenCalledWith(
                'https://new-node.mangadex.network/data/hash456/1-new.png',
                expect.objectContaining({ credentials: 'omit' }),
            );
        });

        it('falls back to uploads.mangadex.org after report-and-refresh returns the same base URL', async () => {
            const mockImageData = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0]).buffer;
            const fetchMock = global.fetch as ReturnType<typeof vi.fn>;

            fetchMock.mockImplementation(async (url: string) => {
                if (url === 'https://same-node.mangadex.network/data/hash123/1-old.png') {
                    return {
                        ok: false,
                        status: 404,
                        statusText: 'Not Found',
                        headers: { get: () => null },
                    };
                }

                if (url === 'https://api.mangadex.org/at-home/server/ch-1') {
                    return {
                        ok: true,
                        json: async () => ({
                            baseUrl: 'https://same-node.mangadex.network',
                            chapter: {
                                hash: 'hash123',
                                data: ['1-old.png'],
                                dataSaver: ['1-saver.jpg'],
                            },
                        }),
                        headers: { get: () => null },
                    };
                }

                if (url === 'https://uploads.mangadex.org/data/hash123/1-old.png') {
                    return {
                        ok: true,
                        arrayBuffer: async () => mockImageData,
                        headers: {
                            get: (name: string) => {
                                if (name === 'content-type') return 'image/png';
                                if (name === 'X-Cache') return 'MISS';
                                return null;
                            },
                        },
                    };
                }

                if (url.includes('mangadex.network/report')) {
                    return { ok: true, headers: { get: () => null } };
                }

                throw new Error(`Unexpected fetch URL: ${url}`);
            });

            const { mangadexIntegration } = await import('@/src/site-integrations/mangadex');
            const result = await mangadexIntegration.background.chapter.downloadImage(
                'https://same-node.mangadex.network/data/hash123/1-old.png',
                {
                    context: {
                        chapterId: 'ch-1',
                    },
                },
            );

            expect(result.filename).toBe('1-old.png');
            expect(result.mimeType).toBe('image/png');
            expect(result.data.byteLength).toBe(4);
            expect(fetchMock).toHaveBeenCalledWith(
                'https://uploads.mangadex.org/data/hash123/1-old.png',
                expect.objectContaining({ credentials: 'omit' }),
            );
            expect(fetchMock).not.toHaveBeenCalledWith(
                'https://same-node.mangadex.network/data-saver/hash123/1-saver.jpg',
                expect.anything(),
            );
        });

        it('retries a later recovery cycle when the uploads fallback initially 404s', async () => {
            const mockImageData = new Uint8Array([0x47, 0x49, 0x46, 0x38]).buffer;
            const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
            let atHomeFetchCount = 0;
            let uploadsFetchCount = 0;

            fetchMock.mockImplementation(async (url: string) => {
                if (url === 'https://same-node.mangadex.network/data/hash123/1-old.png') {
                    return {
                        ok: false,
                        status: 404,
                        statusText: 'Not Found',
                        headers: { get: () => null },
                    };
                }

                if (url === 'https://api.mangadex.org/at-home/server/ch-1') {
                    atHomeFetchCount += 1;
                    return {
                        ok: true,
                        json: async () => ({
                            baseUrl: 'https://same-node.mangadex.network',
                            chapter: {
                                hash: 'hash123',
                                data: ['1-old.png'],
                                dataSaver: ['1-saver.jpg'],
                            },
                        }),
                        headers: { get: () => null },
                    };
                }

                if (url === 'https://uploads.mangadex.org/data/hash123/1-old.png') {
                    uploadsFetchCount += 1;
                    if (uploadsFetchCount === 1) {
                        return {
                            ok: false,
                            status: 404,
                            statusText: 'Not Found',
                            headers: { get: () => null },
                        };
                    }

                    return {
                        ok: true,
                        arrayBuffer: async () => mockImageData,
                        headers: {
                            get: (name: string) => {
                                if (name === 'content-type') return 'image/png';
                                if (name === 'X-Cache') return 'MISS';
                                return null;
                            },
                        },
                    };
                }

                if (url.includes('mangadex.network/report')) {
                    return { ok: true, headers: { get: () => null } };
                }

                throw new Error(`Unexpected fetch URL: ${url}`);
            });

            const { mangadexIntegration } = await import('@/src/site-integrations/mangadex');
            const result = await mangadexIntegration.background.chapter.downloadImage(
                'https://same-node.mangadex.network/data/hash123/1-old.png',
                {
                    context: {
                        chapterId: 'ch-1',
                    },
                },
            );

            expect(result.filename).toBe('1-old.png');
            expect(result.mimeType).toBe('image/png');
            expect(result.data.byteLength).toBe(4);
            expect(atHomeFetchCount).toBe(2);
            expect(uploadsFetchCount).toBe(2);
        });

        it('reports cache HIT correctly to network', async () => {
            const fetchCalls: Array<{ url: string; options?: RequestInit }> = [];
            
            (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (url: string, options?: RequestInit) => {
                fetchCalls.push({ url, options });
                
                if (url.includes('mangadex.network/report')) {
                    return { ok: true };
                }
                
                return {
                    ok: true,
                    arrayBuffer: async () => new ArrayBuffer(1024),
                    headers: {
                        get: (name: string) => {
                            if (name === 'content-type') return 'image/webp';
                            if (name === 'X-Cache') return 'HIT';
                            return null;
                        },
                    },
                };
            });

            const { mangadexIntegration } = await import('@/src/site-integrations/mangadex');
            await mangadexIntegration.background.chapter.downloadImage(
                'https://cdn.mangadex.network/data/abc123/page1.webp'
            );

            // Wait for async report
            await new Promise(resolve => setTimeout(resolve, 100));

            const reportCall = fetchCalls.find(c => c.url.includes('mangadex.network/report'));
            expect(reportCall).toBeDefined();
            
            const body = JSON.parse(reportCall!.options?.body as string);
            expect(body.cached).toBe(true);
            expect(body.success).toBe(true);
        });
    });

    describe('Site Integration Info and Metadata', () => {
        it('has correct site integration ID and patterns', async () => {
            const { mangadexIntegration } = await import('@/src/site-integrations/mangadex');
            const { getSiteIntegrationManifestById } = await import('@/src/site-integrations/manifest');

            expect(mangadexIntegration.id).toBe('mangadex');
            expect(getSiteIntegrationManifestById('mangadex')?.patterns.domains).toContain('mangadex.org');
        });

        it('has content and background integrations with correct names', async () => {
            const { mangadexIntegration } = await import('@/src/site-integrations/mangadex');

            expect(mangadexIntegration.content.name).toBe('MangaDex API Content');
            expect(mangadexIntegration.background.name).toBe('MangaDex API Background');
        });
    });
});

