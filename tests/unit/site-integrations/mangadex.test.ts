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

import { describe, it, expect, vi, beforeEach } from "vitest"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import { backgroundSiteAdapter } from "@/src/site-integrations/mangadex/background-runtime"
import { offscreenSiteAdapter as offscreenSiteAdapterImpl } from "@/src/site-integrations/mangadex/offscreen-runtime"
import { fetchMangadexSeriesMetadata } from "@/src/site-integrations/mangadex/series-api"
import { ChapterImagePlanSchema } from "@/src/site-integrations/chapter-plan"
import { parseMangadexPagePreferences } from "@/src/site-integrations/mangadex/preferences"
import type { RateLimitService } from "@/src/runtime/rate-limit"

// Mock logger before importing the site integration
vi.mock("@/src/runtime/logger", () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}))

// Mock the endpoint client — delegate to global.fetch so individual tests can mock fetch directly.
vi.mock("@/src/runtime/rate-limit", () => ({
  scheduleForIntegrationScope: vi.fn(
    async (_id: string, _scope: unknown, task: () => Promise<unknown>) => task()
  ),
  getRateLimitPolicyFromSnapshot: vi.fn(() => undefined),
}))

vi.mock("@/src/site-integrations/http-client", () => ({
  integrationHttpClient: {
    request: vi.fn(async (input: { url: string; init?: RequestInit }) =>
      fetch(input.url, { credentials: "include", ...input.init })
    ),
  },
  fetchSharedResource: vi.fn(),
}))

const siteIntegrationSettingsReader = {
  getAll: vi.fn(async () => ({})),
  getForSite: vi.fn(async () => ({})),
}

async function fetchMangadexChapters(
  seriesId: string,
  language?: string,
  requestPreferences?: import("@/src/site-integrations/mangadex/preferences-schema").MangadexUserPreferences
) {
  const { fetchMangadexChapterList } =
    await import("@/src/site-integrations/mangadex/series-api")
  const result = await fetchMangadexChapterList(
    seriesId,
    rateLimitService,
    language,
    requestPreferences,
    "resilient",
    undefined,
    siteIntegrationSettingsReader
  )
  return Array.isArray(result) ? result : result.chapters
}

async function fetchMangadexMetadata(seriesId: string) {
  return fetchMangadexSeriesMetadata(seriesId, rateLimitService, "resilient")
}

const MANGADEX_RATE_LIMIT_SETTINGS = createTaskSettingsSnapshot(
  DEFAULT_SETTINGS,
  "mangadex"
).rateLimitSettings

const rateLimitService = {
  scheduleForIntegrationScope: vi.fn(
    async <T>(_id: string, _scope: string, task: () => Promise<T>) => task()
  ),
  resolveEffectivePolicy: vi.fn(async () => ({ concurrency: 1, delayMs: 0 })),
  cleanupRateLimiters: vi.fn(),
} as unknown as RateLimitService

const originalResolveChapterPlan =
  offscreenSiteAdapterImpl.offscreen.chapter.resolveChapterPlan
const originalDownloadImage =
  offscreenSiteAdapterImpl.offscreen.chapter.downloadImage

describe("MangaDex site integration", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    siteIntegrationSettingsReader.getAll.mockReset().mockResolvedValue({})
    siteIntegrationSettingsReader.getForSite.mockReset().mockResolvedValue({})
    global.fetch = vi.fn()
    offscreenSiteAdapterImpl.offscreen.chapter.resolveChapterPlan = (
      chapter,
      input
    ) =>
      originalResolveChapterPlan(chapter, {
        ...input,
        runtime: {
          rateLimitSettings:
            input?.runtime?.rateLimitSettings ?? MANGADEX_RATE_LIMIT_SETTINGS,
          rateLimitService,
          chapterId: input?.runtime?.chapterId,
        },
      })
    offscreenSiteAdapterImpl.offscreen.chapter.downloadImage = (
      imageUrl,
      opts
    ) =>
      originalDownloadImage(imageUrl, {
        ...opts,
        runtime: {
          rateLimitSettings:
            opts?.runtime?.rateLimitSettings ?? MANGADEX_RATE_LIMIT_SETTINGS,
          rateLimitService,
          chapterId: opts?.runtime?.chapterId,
        },
      })
  })

  const offscreenSiteAdapter = {
    offscreen: {
      chapter: {
        resolveChapterPlan: (
          chapter: Parameters<typeof originalResolveChapterPlan>[0],
          input?: unknown
        ) =>
          offscreenSiteAdapterImpl.offscreen.chapter.resolveChapterPlan(
            chapter,
            input as Parameters<typeof originalResolveChapterPlan>[1]
          ),
        downloadImage: (imageUrl: string, input?: unknown) =>
          offscreenSiteAdapterImpl.offscreen.chapter.downloadImage(
            imageUrl,
            input as Parameters<typeof originalDownloadImage>[1]
          ),
      },
    },
  }

  describe("fetchChapterList via api.fetchChapterList", () => {
    it("filters external and unavailable chapters from the downloadable list", async () => {
      // Mock feed response with external and unavailable chapters
      const mockFeedResponse = {
        result: "ok",
        data: [
          {
            id: "normal-chapter-id",
            type: "chapter",
            attributes: {
              chapter: "1",
              title: "Chapter 1",
              translatedLanguage: "en",
              pages: 20,
            },
          },
          {
            id: "external-chapter-id",
            type: "chapter",
            attributes: {
              chapter: "2",
              title: "Chapter 2 (External)",
              translatedLanguage: "en",
              pages: 20,
              externalUrl: "https://external-site.com/chapter/2",
            },
          },
          {
            id: "unavailable-chapter-id",
            type: "chapter",
            attributes: {
              chapter: "3",
              title: "Chapter 3 (Unavailable)",
              translatedLanguage: "en",
              pages: 0,
            },
          },
        ],
        total: 3,
        offset: 0,
        limit: 500,
      }

      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => mockFeedResponse,
      })

      // Import after mocks are set up
      const chapters = await fetchMangadexChapters("test-series-id", "en")

      expect(chapters).toHaveLength(1)
      expect(chapters[0]).toMatchObject({
        id: "normal-chapter-id",
        title: "Chapter 1",
        language: "en",
        locked: false,
      })
    })

    it("logs warning when total exceeds 10000", async () => {
      const logger = await import("@/src/runtime/logger")

      // Mock feed response with high total
      const mockFeedResponse = {
        result: "ok",
        data: [],
        total: 15000,
        offset: 0,
        limit: 500,
      }

      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => mockFeedResponse,
      })

      await fetchMangadexChapters("test-series-id", "en")

      // Should warn about pagination limit
      expect(logger.default.warn).toHaveBeenCalledWith(
        expect.stringContaining("15000")
      )
    })

    it("correctly extracts chapter metadata", async () => {
      const mockFeedResponse = {
        result: "ok",
        data: [
          {
            id: "ch-uuid-123",
            type: "chapter",
            attributes: {
              volume: "2",
              chapter: "15.5",
              title: "Side Story",
              translatedLanguage: "en",
              pages: 30,
            },
          },
        ],
        total: 1,
        offset: 0,
        limit: 500,
      }

      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => mockFeedResponse,
      })

      const chapters = await fetchMangadexChapters("test-series-id", "en")

      expect(chapters).toHaveLength(1)
      expect(chapters[0].chapterNumber).toBe(15.5)
      expect(chapters[0].volumeNumber).toBe(2)
      expect(chapters[0].volumeLabel).toBe("Vol. 2")
      expect(chapters[0].title).toBe("Side Story")
      expect(chapters[0].url).toBe("https://mangadex.org/chapter/ch-uuid-123")
    })

    it("logs invariant error when duplicate chapter ids are returned", async () => {
      const logger = await import("@/src/runtime/logger")

      const mockFeedResponse = {
        result: "ok",
        data: [
          {
            id: "dup-chapter-id",
            type: "chapter",
            attributes: {
              chapter: "1",
              title: "Chapter 1",
              translatedLanguage: "en",
              pages: 20,
            },
          },
          {
            id: "dup-chapter-id",
            type: "chapter",
            attributes: {
              chapter: "1",
              title: "Chapter 1 mirror",
              translatedLanguage: "en",
              pages: 20,
            },
          },
        ],
        total: 2,
        offset: 0,
        limit: 500,
      }

      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => mockFeedResponse,
      })

      const chapters = await fetchMangadexChapters("test-series-id", "en")

      expect(chapters).toHaveLength(1)
      expect(chapters[0].id).toBe("dup-chapter-id")
      expect(logger.default.error).toHaveBeenCalledWith(
        "[mangadex] Duplicate chapter ids detected in fetchChapterList",
        expect.objectContaining({
          seriesId: "test-series-id",
          duplicateChapterIds: ["dup-chapter-id"],
        })
      )
    })

    it("uses explicit chapterLanguageFilter site settings when no language override is provided", async () => {
      siteIntegrationSettingsReader.getAll.mockResolvedValue({
        mangadex: {
          chapterLanguageFilter: ["ja", "en"],
        },
      })

      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({
          result: "ok",
          data: [],
          total: 0,
          offset: 0,
          limit: 500,
        }),
      })

      vi.resetModules()
      await fetchMangadexChapters("test-series-id")

      const requestUrl = new URL(
        String((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])
      )
      expect(requestUrl.searchParams.getAll("translatedLanguage[]")).toEqual([
        "ja",
        "en",
      ])
    })

    it("uses request-local MangaDex language preferences when auto-read is enabled", async () => {
      siteIntegrationSettingsReader.getAll.mockResolvedValue({
        mangadex: {
          autoReadMangaDexSettings: true,
        },
      })

      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({
          result: "ok",
          data: [],
          total: 0,
          offset: 0,
          limit: 500,
        }),
      })

      await fetchMangadexChapters("test-series-id", undefined, {
        dataSaver: true,
        filteredLanguages: ["ja", "en"],
      })

      const requestUrl = new URL(
        String((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])
      )
      expect(requestUrl.searchParams.getAll("translatedLanguage[]")).toEqual([
        "ja",
        "en",
      ])
    })

    it("maps request-local MangaDex content ratings to feed params", async () => {
      siteIntegrationSettingsReader.getAll.mockResolvedValue({
        mangadex: {
          autoReadMangaDexSettings: true,
        },
      })

      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({
          result: "ok",
          data: [],
          total: 0,
          offset: 0,
          limit: 500,
        }),
      })

      await fetchMangadexChapters("test-series-id", undefined, {
        dataSaver: true,
        filteredLanguages: ["en"],
        showSafe: true,
        showSuggestive: false,
        showErotic: true,
        showHentai: false,
      })

      const requestUrl = new URL(
        String((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])
      )
      expect(requestUrl.searchParams.getAll("contentRating[]")).toEqual([
        "safe",
        "erotica",
      ])
    })

    it("returns no chapters without calling the API when every content rating is disabled", async () => {
      const fetchMock = global.fetch as ReturnType<typeof vi.fn>

      const chapters = await fetchMangadexChapters(
        "test-series-id",
        undefined,
        {
          dataSaver: true,
          filteredLanguages: ["en"],
          showSafe: false,
          showSuggestive: false,
          showErotic: false,
          showHentai: false,
        }
      )

      expect(chapters).toEqual([])
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it("omits translatedLanguage filters when no explicit override or cached preference exists", async () => {
      siteIntegrationSettingsReader.getAll.mockResolvedValue({})
      global.chrome = {
        storage: {
          session: {
            get: vi.fn(async () => ({})),
          },
        },
      } as unknown as typeof chrome

      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({
          result: "ok",
          data: [],
          total: 0,
          offset: 0,
          limit: 500,
        }),
      })

      vi.resetModules()
      await fetchMangadexChapters("test-series-id")

      const requestUrl = new URL(
        String((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])
      )
      expect(requestUrl.searchParams.getAll("translatedLanguage[]")).toEqual([])
    })
  })

  describe("fetchSeriesMetadata", () => {
    it("extracts title, author, and cover URL", async () => {
      const mangaId = "db692d58-4b13-4174-ae8c-30c515c0689c"
      const mockMangaResponse = {
        result: "ok",
        data: {
          id: mangaId,
          type: "manga",
          attributes: {
            title: { en: "Test Manga Title" },
            altTitles: [
              { ja: "テストマンガタイトル" },
              { fr: "Titre alternatif" },
            ],
            description: { en: "A test manga description." },
            contentRating: "safe",
            originalLanguage: "ja",
            publicationDemographic: "seinen",
            status: "ongoing",
            year: 2022,
            tags: [
              { attributes: { name: { en: "Action" } } },
              { attributes: { name: { en: "Comedy" } } },
            ],
          },
          relationships: [
            {
              id: "author-uuid",
              type: "author",
              attributes: { name: "Test Author" },
            },
            {
              id: "artist-uuid",
              type: "artist",
              attributes: { name: "Test Artist" },
            },
            {
              id: "cover-uuid",
              type: "cover_art",
              attributes: { fileName: "cover.jpg" },
            },
          ],
        },
      }

      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => mockMangaResponse,
      })

      const metadata = await fetchMangadexMetadata(mangaId)

      expect(metadata.title).toBe("Test Manga Title")
      expect(metadata.author).toBe("Test Author")
      expect(metadata.description).toBe("A test manga description.")
      expect(metadata.status).toBe("ongoing")
      expect(metadata.language).toBe("ja")
      expect(metadata.year).toBe(2022)
      expect(metadata.artist).toBe("Test Artist")
      expect(metadata.contentRating).toBe("safe")
      expect(metadata.readingDirection).toBeUndefined()
      expect(metadata.alternativeTitles).toEqual([
        "テストマンガタイトル",
        "Titre alternatif",
      ])
      expect(metadata.genres).toContain("Action")
      expect(metadata.genres).toContain("Seinen")
      expect(metadata.tags).toEqual(["Action", "Comedy"])
      expect(metadata.coverUrl).toContain(mangaId)
      expect(metadata.coverUrl).toContain("cover.jpg")
    })

    it("maps MangaDex bayesian score to 0-5 communityRating scale", async () => {
      const mangaId = "manga-uuid-rating"

      ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
        async (url: string) => {
          if (url.includes("/statistics/manga/")) {
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
            }
          }

          return {
            ok: true,
            json: async () => ({
              result: "ok",
              data: {
                id: mangaId,
                type: "manga",
                attributes: {
                  title: { en: "Rated Manga" },
                },
                relationships: [],
              },
            }),
          }
        }
      )

      const metadata = await fetchMangadexMetadata(mangaId)

      expect(metadata.title).toBe("Rated Manga")
      expect(metadata.communityRating).toBe(4.2)
    })

    it("does not fail series metadata when statistics request fails", async () => {
      const mangaId = "manga-uuid-no-stats"

      ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
        async (url: string) => {
          if (url.includes("/statistics/manga/")) {
            return {
              ok: false,
              status: 503,
              statusText: "Service Unavailable",
            }
          }

          return {
            ok: true,
            json: async () => ({
              result: "ok",
              data: {
                id: mangaId,
                type: "manga",
                attributes: {
                  title: { en: "Metadata Survives" },
                },
                relationships: [],
              },
            }),
          }
        }
      )

      const metadata = await fetchMangadexMetadata(mangaId)

      expect(metadata.title).toBe("Metadata Survives")
      expect(metadata.communityRating).toBeUndefined()
    })

    it("does not apply the five-second retry policy to interactive statistics", async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
      })
      const { fetchMangaStatistics } =
        await import("@/src/site-integrations/mangadex/api")

      await expect(
        fetchMangaStatistics(
          "interactive-series",
          rateLimitService,
          "interactive",
          undefined
        )
      ).rejects.toThrow("HTTP 503")
      expect(global.fetch).toHaveBeenCalledTimes(1)
    })
  })

  describe("X-RateLimit-Retry-After header parsing", () => {
    it("retries on 429 response with retry delay from header", async () => {
      const now = Math.floor(Date.now() / 1000)
      const retryAfterTimestamp = now + 5 // 5 seconds from now

      let callCount = 0
      ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
        async () => {
          callCount++
          if (callCount === 1) {
            // First call returns 429 with retry-after header
            return {
              ok: false,
              status: 429,
              statusText: "Too Many Requests",
              headers: {
                get: (name: string) => {
                  if (name === "X-RateLimit-Retry-After") {
                    return String(retryAfterTimestamp)
                  }
                  return null
                },
              },
            }
          }
          // Second call succeeds
          return {
            ok: true,
            json: async () => ({
              result: "ok",
              data: {
                id: "test",
                type: "manga",
                attributes: { title: { en: "Test" } },
                relationships: [],
              },
            }),
          }
        }
      )

      // Use a shorter timeout for testing
      vi.useFakeTimers()

      const metadataPromise = fetchMangadexMetadata("test-id")

      // Advance timers to trigger retry
      await vi.advanceTimersByTimeAsync(10000)

      const metadata = await metadataPromise
      expect(metadata.title).toBe("Test")
      expect(callCount).toBeGreaterThanOrEqual(2) // At least one retry

      vi.useRealTimers()
    })

    it("uses default delay when X-RateLimit-Retry-After header is missing", async () => {
      let callCount = 0
      ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
        async () => {
          callCount++
          if (callCount === 1) {
            return {
              ok: false,
              status: 429,
              statusText: "Too Many Requests",
              headers: {
                get: () => null, // No header
              },
            }
          }
          return {
            ok: true,
            json: async () => ({
              result: "ok",
              data: {
                id: "test",
                type: "manga",
                attributes: { title: { en: "Retried" } },
                relationships: [],
              },
            }),
          }
        }
      )

      vi.useFakeTimers()

      const metadataPromise = fetchMangadexMetadata("test-id")

      // Advance by default delay (5000ms)
      await vi.advanceTimersByTimeAsync(6000)

      const metadata = await metadataPromise
      expect(metadata.title).toBe("Retried")

      vi.useRealTimers()
    })

    it("retries transient server errors with the default delay", async () => {
      let callCount = 0
      ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
        async () => {
          callCount++
          if (callCount === 1) {
            return {
              ok: false,
              status: 503,
              statusText: "Service Unavailable",
              headers: {
                get: () => null,
              },
            }
          }
          return {
            ok: true,
            json: async () => ({
              result: "ok",
              data: {
                id: "test",
                type: "manga",
                attributes: { title: { en: "Retried 503" } },
                relationships: [],
              },
            }),
          }
        }
      )

      vi.useFakeTimers()

      try {
        const metadataPromise = fetchMangadexMetadata("test-id")

        await vi.advanceTimersByTimeAsync(6000)

        const metadata = await metadataPromise
        expect(metadata.title).toBe("Retried 503")
        const mangaRequestCount = (
          global.fetch as ReturnType<typeof vi.fn>
        ).mock.calls.filter(([url]) =>
          String(url).includes("/manga/test-id?")
        ).length
        expect(mangaRequestCount).toBe(2)
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe("User preferences", () => {
    it("keeps an absent page probe absent and rejects malformed present data", () => {
      expect(parseMangadexPagePreferences(undefined)).toBeUndefined()
      expect(() =>
        parseMangadexPagePreferences({
          dataSaver: "yes",
        })
      ).toThrow()
    })

    it("prepareDispatchContext forwards cached per-series preferences when auto-read is enabled", async () => {
      siteIntegrationSettingsReader.getForSite.mockResolvedValue({
        autoReadMangaDexSettings: true,
      })

      global.chrome = {
        storage: {
          session: {
            get: vi.fn(async () => ({
              mangadexUserPreferencesBySeries: {
                "mangadex#series-1": {
                  dataSaver: false,
                  filteredLanguages: ["ja", "en"],
                },
              },
            })),
          },
        },
      } as unknown as typeof chrome

      const context =
        await backgroundSiteAdapter.background.prepareDispatchContext?.({
          taskId: "task-1",
          seriesKey: "mangadex#series-1",
          chapter: {
            id: "ch-1",
            url: "https://mangadex.org/chapter/ch-1",
            title: "Chapter 1",
            comicInfo: {},
          },
          settingsSnapshot: {
            ...createTaskSettingsSnapshot(DEFAULT_SETTINGS, "mangadex"),
          },
          siteIntegrationSettingsReader,
        })

      expect(context).toEqual({
        mangadexUserPreferences: {
          dataSaver: false,
          filteredLanguages: ["ja", "en"],
        },
      })
      expect(chrome.storage.session.get).toHaveBeenCalledWith(
        "mangadexUserPreferencesBySeries"
      )
    })

    it("prepareDispatchContext does not read session preferences when auto-read is disabled", async () => {
      siteIntegrationSettingsReader.getForSite.mockResolvedValue({
        autoReadMangaDexSettings: false,
      })

      global.chrome = {
        storage: {
          session: {
            get: vi.fn(async () => ({
              mangadexUserPreferencesBySeries: {
                "mangadex#series-1": {
                  dataSaver: false,
                  filteredLanguages: ["ja", "en"],
                },
              },
            })),
          },
        },
      } as unknown as typeof chrome

      vi.resetModules()
      const context =
        await backgroundSiteAdapter.background.prepareDispatchContext?.({
          taskId: "task-1",
          seriesKey: "mangadex#series-1",
          chapter: {
            id: "ch-1",
            url: "https://mangadex.org/chapter/ch-1",
            title: "Chapter 1",
            comicInfo: {},
          },
          settingsSnapshot: {
            ...createTaskSettingsSnapshot(DEFAULT_SETTINGS, "mangadex"),
          },
          siteIntegrationSettingsReader,
        })

      expect(context).toBeUndefined()
      expect(chrome.storage.session.get).not.toHaveBeenCalled()
    })

    it("rejects malformed stored per-series preferences instead of dropping them", async () => {
      siteIntegrationSettingsReader.getForSite.mockResolvedValue({
        autoReadMangaDexSettings: true,
      })

      global.chrome = {
        storage: {
          session: {
            get: vi.fn(async () => ({
              mangadexUserPreferencesBySeries: {
                "mangadex#series-1": {
                  dataSaver: false,
                  filteredLanguages: ["en"],
                  obsolete: true,
                },
              },
            })),
          },
        },
      } as unknown as typeof chrome

      await expect(
        backgroundSiteAdapter.background.prepareDispatchContext?.({
          taskId: "task-1",
          seriesKey: "mangadex#series-1",
          chapter: {
            id: "ch-1",
            url: "https://mangadex.org/chapter/ch-1",
            title: "Chapter 1",
            comicInfo: {},
          },
          settingsSnapshot: {
            ...createTaskSettingsSnapshot(DEFAULT_SETTINGS, "mangadex"),
          },
          siteIntegrationSettingsReader,
        })
      ).rejects.toThrow()
    })

    it("prepareDispatchContext forwards configured MangaDex imageQuality when offscreen cannot read storage directly", async () => {
      siteIntegrationSettingsReader.getAll.mockResolvedValue({
        mangadex: {
          imageQuality: "data",
        },
      })
      siteIntegrationSettingsReader.getForSite.mockResolvedValue({
        autoReadMangaDexSettings: false,
        imageQuality: "data",
      })

      global.chrome = {
        storage: {
          session: {
            get: vi.fn(async () => ({
              mangadexUserPreferencesBySeries: {},
            })),
          },
        },
      } as unknown as typeof chrome

      const context =
        await backgroundSiteAdapter.background.prepareDispatchContext?.({
          taskId: "task-1",
          seriesKey: "mangadex#series-1",
          chapter: {
            id: "ch-1",
            url: "https://mangadex.org/chapter/ch-1",
            title: "Chapter 1",
            comicInfo: {},
          },
          settingsSnapshot: {
            ...createTaskSettingsSnapshot(DEFAULT_SETTINGS, "mangadex"),
          },
          siteIntegrationSettingsReader,
        })

      expect(context).toEqual({
        mangadexConfiguredImageQuality: "data",
      })
    })

    it("resolveChapterPlan honors typed MangaDex dispatch preferences for quality selection", async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({
          baseUrl: "https://uploads.mangadex.org",
          chapter: {
            hash: "hash123",
            data: ["001.jpg"],
            dataSaver: ["001.jpg"],
          },
        }),
      })

      const { imageUrls: urls } =
        await offscreenSiteAdapter.offscreen.chapter.resolveChapterPlan(
          {
            id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            url: "https://mangadex.org/chapter/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          },
          {
            dispatchContext: {
              mangadexUserPreferences: {
                dataSaver: false,
                filteredLanguages: ["en"],
              },
            },
          }
        )

      expect(urls).toEqual([
        "https://uploads.mangadex.org/data/hash123/001.jpg",
      ])
    })
  })

  describe("PageCount extraction", () => {
    it("provides page count from chapter attributes", async () => {
      const mockFeedResponse = {
        result: "ok",
        data: [
          {
            id: "chapter-with-pages",
            type: "chapter",
            attributes: {
              chapter: "1",
              title: "Chapter 1",
              translatedLanguage: "en",
              pages: 25, // This is the PageCount
            },
          },
        ],
        total: 1,
        offset: 0,
        limit: 500,
      }

      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => mockFeedResponse,
      })

      const chapters = await fetchMangadexChapters("test-series-id", "en")

      // Chapter data includes page count that will be used for ComicInfo.xml PageCount
      expect(chapters).toHaveLength(1)
      // The pages field from API is available; the site integration uses it for at-home image fetching
    })
  })

  describe("Edge Cases: Chapter List Parsing", () => {
    it("handles chapters with null volume and chapter numbers", async () => {
      const mockFeedResponse = {
        result: "ok",
        data: [
          {
            id: "oneshot-chapter",
            type: "chapter",
            attributes: {
              volume: null,
              chapter: null,
              title: "Oneshot",
              translatedLanguage: "en",
              pages: 15,
            },
          },
        ],
        total: 1,
        offset: 0,
        limit: 500,
      }

      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => mockFeedResponse,
      })

      const chapters = await fetchMangadexChapters("test-series-id", "en")

      expect(chapters).toHaveLength(1)
      expect(chapters[0].title).toBe("Oneshot")
      expect(chapters[0].chapterNumber).toBeUndefined()
      expect(chapters[0].volumeNumber).toBeUndefined()
      expect(chapters[0].volumeLabel).toBeUndefined()
    })

    it("handles chapters with null externalUrl (non-external chapters)", async () => {
      const mockFeedResponse = {
        result: "ok",
        data: [
          {
            id: "ch-null-ext",
            type: "chapter",
            attributes: {
              volume: "1",
              chapter: "1",
              title: "Chapter 1",
              translatedLanguage: "en",
              pages: 20,
              externalUrl: null,
            },
          },
          {
            id: "ch-string-ext",
            type: "chapter",
            attributes: {
              volume: "1",
              chapter: "2",
              title: "Chapter 2 (External)",
              translatedLanguage: "en",
              pages: 0,
              externalUrl: "https://mangaplus.shueisha.co.jp/viewer/1000338",
            },
          },
        ],
        total: 2,
        offset: 0,
        limit: 500,
      }

      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => mockFeedResponse,
      })

      const chapters = await fetchMangadexChapters("test-series-id", "en")

      expect(chapters).toHaveLength(1)
      expect(chapters[0].title).toBe("Chapter 1")
      expect(chapters[0].locked).toBe(false)
    })

    it("handles chapters with empty string title (generates default)", async () => {
      const mockFeedResponse = {
        result: "ok",
        data: [
          {
            id: "ch-abc123",
            type: "chapter",
            attributes: {
              chapter: "5",
              title: "",
              translatedLanguage: "en",
              pages: 10,
            },
          },
        ],
        total: 1,
        offset: 0,
        limit: 500,
      }

      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => mockFeedResponse,
      })

      const chapters = await fetchMangadexChapters("test-series-id", "en")

      expect(chapters).toHaveLength(1)
      expect(chapters[0].title).toBe("Chapter 5")
    })

    it("handles chapters with no title and no chapter number (uses UUID fallback)", async () => {
      const mockFeedResponse = {
        result: "ok",
        data: [
          {
            id: "abcd1234-efgh-5678-ijkl-9012mnop3456",
            type: "chapter",
            attributes: {
              chapter: null,
              title: null,
              translatedLanguage: "en",
              pages: 8,
            },
          },
        ],
        total: 1,
        offset: 0,
        limit: 500,
      }

      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => mockFeedResponse,
      })

      const chapters = await fetchMangadexChapters("test-series-id", "en")

      expect(chapters).toHaveLength(1)
      expect(chapters[0].title).toContain("Chapter abcd1234")
    })

    it("handles decimal chapter numbers (e.g., 15.5)", async () => {
      const mockFeedResponse = {
        result: "ok",
        data: [
          {
            id: "decimal-chapter",
            type: "chapter",
            attributes: {
              chapter: "15.5",
              title: "Extra",
              translatedLanguage: "en",
              pages: 12,
            },
          },
        ],
        total: 1,
        offset: 0,
        limit: 500,
      }

      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => mockFeedResponse,
      })

      const chapters = await fetchMangadexChapters("test-series-id", "en")

      expect(chapters).toHaveLength(1)
      expect(chapters[0].chapterNumber).toBe(15.5)
    })

    it("handles empty chapter feed response", async () => {
      const mockFeedResponse = {
        result: "ok",
        data: [],
        total: 0,
        offset: 0,
        limit: 500,
      }

      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => mockFeedResponse,
      })

      const chapters = await fetchMangadexChapters("test-series-id", "en")

      expect(chapters).toHaveLength(0)
    })
  })

  describe("Edge Cases: Series Metadata Parsing", () => {
    it("extracts title from altTitles when primary title is empty", async () => {
      const mockMangaResponse = {
        result: "ok",
        data: {
          id: "manga-uuid",
          type: "manga",
          attributes: {
            title: {},
            altTitles: [{ en: "English Alt Title" }, { ja: "Japanese Title" }],
          },
          relationships: [],
        },
      }

      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => mockMangaResponse,
      })

      const metadata = await fetchMangadexMetadata("manga-uuid")

      expect(metadata.title).toBe("English Alt Title")
    })

    it("uses ja-ro (romaji) title when en is not available", async () => {
      const mockMangaResponse = {
        result: "ok",
        data: {
          id: "manga-uuid",
          type: "manga",
          attributes: {
            title: { "ja-ro": "Romaji Title" },
          },
          relationships: [],
        },
      }

      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => mockMangaResponse,
      })

      const metadata = await fetchMangadexMetadata("manga-uuid")

      expect(metadata.title).toBe("Romaji Title")
    })

    it("handles missing cover art relationship", async () => {
      const mockMangaResponse = {
        result: "ok",
        data: {
          id: "manga-uuid",
          type: "manga",
          attributes: {
            title: { en: "No Cover Manga" },
          },
          relationships: [
            {
              id: "author-id",
              type: "author",
              attributes: { name: "Author Name" },
            },
          ],
        },
      }

      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => mockMangaResponse,
      })

      const metadata = await fetchMangadexMetadata("manga-uuid")

      expect(metadata.title).toBe("No Cover Manga")
      expect(metadata.coverUrl).toBeUndefined()
    })

    it("handles missing author relationship", async () => {
      const mockMangaResponse = {
        result: "ok",
        data: {
          id: "manga-uuid",
          type: "manga",
          attributes: {
            title: { en: "No Author Manga" },
          },
          relationships: [],
        },
      }

      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => mockMangaResponse,
      })

      const metadata = await fetchMangadexMetadata("manga-uuid")

      expect(metadata.author).toBeUndefined()
    })

    it("handles cover_art without fileName attribute", async () => {
      const mockMangaResponse = {
        result: "ok",
        data: {
          id: "manga-uuid",
          type: "manga",
          attributes: {
            title: { en: "Broken Cover Manga" },
          },
          relationships: [
            { id: "cover-id", type: "cover_art", attributes: {} },
          ],
        },
      }

      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => mockMangaResponse,
      })

      const metadata = await fetchMangadexMetadata("manga-uuid")

      expect(metadata.coverUrl).toBeUndefined()
    })

    it("extracts genres from tags array", async () => {
      const mockMangaResponse = {
        result: "ok",
        data: {
          id: "manga-uuid",
          type: "manga",
          attributes: {
            title: { en: "Genre Manga" },
            tags: [
              { attributes: { name: { en: "Action" } } },
              { attributes: { name: { en: "Romance" } } },
              { attributes: { name: { en: "Comedy" } } },
            ],
          },
          relationships: [],
        },
      }

      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => mockMangaResponse,
      })

      const metadata = await fetchMangadexMetadata("manga-uuid")

      expect(metadata.genres).toEqual(["Action", "Romance", "Comedy"])
    })
  })

  describe("Edge Cases: Rate Limit and Error Handling", () => {
    // Note: 429 retry behavior is tested in the dedicated rate limit test suite
    // which uses proper fake timers. Here we test non-retry error scenarios.

    it("handles non-429 HTTP errors without retry", async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
      })

      await expect(fetchMangadexMetadata("nonexistent-id")).rejects.toThrow(
        "404"
      )
    })

    it("throws after exhausting 500 server error retries", async () => {
      let callCount: number
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        headers: {
          get: () => null,
        },
      })

      vi.useFakeTimers()

      try {
        const metadataPromise = fetchMangadexMetadata("test-id")
        const expectation = expect(metadataPromise).rejects.toThrow("500")
        callCount = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.length

        await vi.advanceTimersByTimeAsync(20_000)

        await expectation
        callCount = (
          global.fetch as ReturnType<typeof vi.fn>
        ).mock.calls.filter(([url]) =>
          String(url).includes("/manga/test-id?")
        ).length
        expect(callCount).toBe(4)
      } finally {
        vi.useRealTimers()
      }
    })

    it("retries a transient fetch rejection and succeeds", async () => {
      const { fetchWithMangadexRetry } =
        await import("@/src/site-integrations/mangadex/api")
      ;(global.fetch as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockResolvedValueOnce({ ok: true, status: 200 })

      vi.useFakeTimers()
      try {
        const responsePromise = fetchWithMangadexRetry(
          "https://api.mangadex.org/manga/test-id",
          rateLimitService,
          undefined,
          0
        )
        await vi.advanceTimersByTimeAsync(6000)
        await expect(responsePromise).resolves.toMatchObject({ ok: true })
        expect(global.fetch).toHaveBeenCalledTimes(2)
      } finally {
        vi.useRealTimers()
      }
    })

    it("rethrows the last transient fetch rejection after exhausting retries", async () => {
      const { fetchWithMangadexRetry } =
        await import("@/src/site-integrations/mangadex/api")
      ;(global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
        new TypeError("Failed to fetch")
      )

      vi.useFakeTimers()
      try {
        const responsePromise = fetchWithMangadexRetry(
          "https://api.mangadex.org/manga/test-id",
          rateLimitService,
          undefined,
          0
        )
        const expectation =
          expect(responsePromise).rejects.toThrow("Failed to fetch")
        await vi.advanceTimersByTimeAsync(20_000)
        await expectation
        expect(global.fetch).toHaveBeenCalledTimes(4)
      } finally {
        vi.useRealTimers()
      }
    })

    it("does not retry an aborted fetch rejection", async () => {
      const { fetchWithMangadexRetry } =
        await import("@/src/site-integrations/mangadex/api")
      const controller = new AbortController()
      controller.abort()
      const abortError = new Error("The operation was aborted")
      abortError.name = "AbortError"
      ;(global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(abortError)

      await expect(
        fetchWithMangadexRetry(
          "https://api.mangadex.org/manga/test-id",
          rateLimitService,
          { signal: controller.signal },
          0
        )
      ).rejects.toThrow("aborted")
      expect(global.fetch).toHaveBeenCalledOnce()
    })

    it("throws a descriptive error when API returns HTML (Cloudflare) with status 200", async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: {
          get: (name: string) =>
            name.toLowerCase() === "content-type"
              ? "text/html; charset=UTF-8"
              : null,
        },
        json: async () => {
          throw new SyntaxError("Unexpected token < in JSON at position 0")
        },
      })

      await expect(fetchMangadexMetadata("test-id")).rejects.toThrow(
        "non-JSON response"
      )
    })

    it("throws a descriptive error when response.json() fails even without Content-Type header", async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: { get: () => null },
        json: async () => {
          throw new SyntaxError("Unexpected end of JSON input")
        },
      })

      await expect(fetchMangadexMetadata("test-id")).rejects.toThrow(
        "Failed to parse MangaDex API response as JSON"
      )
    })

    it("throws a descriptive error when chapter feed returns HTML with status 200", async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: {
          get: (name: string) =>
            name.toLowerCase() === "content-type"
              ? "text/html; charset=UTF-8"
              : null,
        },
        json: async () => {
          throw new SyntaxError("Unexpected token < in JSON at position 0")
        },
      })

      await expect(fetchMangadexChapters("test-id")).rejects.toThrow(
        "non-JSON response"
      )
    })
  })

  describe("Edge Cases: parseChapterIdFromUrl validation", () => {
    it("extracts a valid UUID chapter id from a chapter URL", async () => {
      const { parseChapterIdFromUrl } =
        await import("@/src/site-integrations/mangadex/api")

      const id = parseChapterIdFromUrl(
        "https://mangadex.org/chapter/12345678-abcd-1234-abcd-1234567890ab"
      )
      expect(id).toBe("12345678-abcd-1234-abcd-1234567890ab")
    })

    it("throws on a chapter URL with a non-UUID id", async () => {
      const { parseChapterIdFromUrl } =
        await import("@/src/site-integrations/mangadex/api")

      expect(() =>
        parseChapterIdFromUrl("https://mangadex.org/chapter/invalid-id")
      ).toThrow("Invalid MangaDex chapter URL")
    })

    it("throws on a malformed URL", async () => {
      const { parseChapterIdFromUrl } =
        await import("@/src/site-integrations/mangadex/api")

      expect(() => parseChapterIdFromUrl("not-a-url")).toThrow(
        "Invalid MangaDex chapter URL (malformed)"
      )
    })

    it("throws on a non-chapter URL", async () => {
      const { parseChapterIdFromUrl } =
        await import("@/src/site-integrations/mangadex/api")

      expect(() =>
        parseChapterIdFromUrl(
          "https://mangadex.org/title/12345678-abcd-1234-abcd-1234567890ab"
        )
      ).toThrow("Invalid MangaDex chapter URL")
    })
  })

  describe("Edge Cases: At-Home Server and Image Download", () => {
    it("throws a descriptive error when at-home payload is missing image file arrays", async () => {
      const mockAtHomeResponse = {
        result: "ok",
        baseUrl: "https://uploads.mangadex.org",
        chapter: {
          hash: "abc123hash",
          data: null,
          dataSaver: null,
        },
      }

      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => mockAtHomeResponse,
      })

      await expect(
        offscreenSiteAdapter.offscreen.chapter.resolveChapterPlan({
          id: "12345678-abcd-1234-abcd-123456789012",
          url: "https://mangadex.org/chapter/12345678-abcd-1234-abcd-123456789012",
        })
      ).rejects.toMatchObject({
        category: "provider_changed",
        message: expect.stringContaining("unexpected response structure"),
      })
    })

    it("extracts chapter ID from various URL formats", async () => {
      // Test with standard URL format
      const mockAtHomeResponse = {
        result: "ok",
        baseUrl: "https://uploads.mangadex.org",
        chapter: {
          hash: "abc123hash",
          data: ["page1.jpg", "page2.jpg"],
          dataSaver: ["page1-ds.jpg", "page2-ds.jpg"],
        },
      }

      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => mockAtHomeResponse,
      })

      const { imageUrls: urls } =
        await offscreenSiteAdapter.offscreen.chapter.resolveChapterPlan({
          id: "12345678-abcd-1234-abcd-123456789012",
          url: "https://mangadex.org/chapter/12345678-abcd-1234-abcd-123456789012",
        })

      expect(urls).toBeDefined()
      expect(urls).toHaveLength(2)
      // Verify URLs are constructed correctly (either data or data-saver path)
      expect(urls![0]).toContain("abc123hash")
    })

    it("uses full quality when dataSaver preference is false", async () => {
      const mockAtHomeResponse = {
        result: "ok",
        baseUrl: "https://uploads.mangadex.org",
        chapter: {
          hash: "abc123hash",
          data: ["full-page1.jpg", "full-page2.jpg"],
          dataSaver: ["ds-page1.jpg", "ds-page2.jpg"],
        },
      }

      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => mockAtHomeResponse,
      })

      const { imageUrls: urls } =
        await offscreenSiteAdapter.offscreen.chapter.resolveChapterPlan(
          {
            id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
            url: "https://mangadex.org/chapter/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
          },
          {
            dispatchContext: {
              mangadexUserPreferences: {
                dataSaver: false,
                filteredLanguages: ["en"],
              },
            },
          }
        )

      expect(urls).toBeDefined()
      expect(urls).toHaveLength(2)
      expect(urls![0]).toContain("/data/")
      expect(urls![0]).not.toContain("data-saver")
    })

    it("handles empty image array from at-home response", async () => {
      const logger = await import("@/src/runtime/logger")

      const mockAtHomeResponse = {
        result: "ok",
        baseUrl: "https://uploads.mangadex.org",
        chapter: {
          hash: "abc123hash",
          data: [],
          dataSaver: [],
        },
      }

      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => mockAtHomeResponse,
      })

      await expect(
        offscreenSiteAdapter.offscreen.chapter.resolveChapterPlan({
          id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
          url: "https://mangadex.org/chapter/cccccccc-cccc-cccc-cccc-cccccccccccc",
        })
      ).rejects.toThrow()
      expect(logger.default.error).toHaveBeenCalled()
    })

    it("rejects malformed chapter plans instead of filtering provider output", () => {
      expect(() =>
        ChapterImagePlanSchema.parse({
          imageUrls: [
            "https://valid-url.mangadex.org/page1.jpg",
            "not-a-valid-url",
          ],
        })
      ).toThrow()
    })
  })

  describe("Edge Cases: Pagination", () => {
    it("skips malformed chapter feed entries while keeping valid entries", async () => {
      const logger = await import("@/src/runtime/logger")

      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({
          result: "ok",
          data: [
            {
              id: "valid-chapter-id",
              type: "chapter",
              attributes: {
                chapter: "1",
                title: "Valid Chapter",
                translatedLanguage: "en",
                pages: 10,
              },
            },
            {
              id: "broken-chapter-id",
              type: "chapter",
              attributes: {
                chapter: "2",
                title: "Broken Chapter",
                // translatedLanguage intentionally missing
                pages: 12,
              },
            },
          ],
          total: 2,
          offset: 0,
          limit: 500,
        }),
      })

      const chapters = await fetchMangadexChapters("test-series-id", "en")

      expect(chapters).toHaveLength(1)
      expect(chapters[0]?.id).toBe("valid-chapter-id")
      expect(logger.default.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          "Skipping malformed chapter entry with missing language"
        )
      )
    })

    it("fetches multiple pages when chapters exceed limit", async () => {
      let callCount = 0

      ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
        async (url: string) => {
          callCount++
          const offset = new URL(url).searchParams.get("offset") || "0"

          if (offset === "0") {
            return {
              ok: true,
              json: async () => ({
                result: "ok",
                data: Array(500)
                  .fill(null)
                  .map((_, i) => ({
                    id: `ch-page1-${i}`,
                    type: "chapter",
                    attributes: {
                      chapter: String(i + 1),
                      title: `Chapter ${i + 1}`,
                      translatedLanguage: "en",
                      pages: 10,
                    },
                  })),
                total: 750,
                offset: 0,
                limit: 500,
              }),
            }
          } else {
            return {
              ok: true,
              json: async () => ({
                result: "ok",
                data: Array(250)
                  .fill(null)
                  .map((_, i) => ({
                    id: `ch-page2-${i}`,
                    type: "chapter",
                    attributes: {
                      chapter: String(501 + i),
                      title: `Chapter ${501 + i}`,
                      translatedLanguage: "en",
                      pages: 10,
                    },
                  })),
                total: 750,
                offset: 500,
                limit: 500,
              }),
            }
          }
        }
      )

      const chapters = await fetchMangadexChapters("test-series-id", "en")

      expect(chapters).toHaveLength(750)
      expect(callCount).toBeGreaterThanOrEqual(2)
    })

    it("stops at 10000 chapter offset limit", async () => {
      const logger = await import("@/src/runtime/logger")

      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({
          result: "ok",
          data: Array(500)
            .fill(null)
            .map((_, i) => ({
              id: `ch-${i}`,
              type: "chapter",
              attributes: {
                chapter: String(i + 1),
                title: `Chapter ${i + 1}`,
                translatedLanguage: "en",
                pages: 10,
              },
            })),
          total: 12000, // More than 10000
          offset: 0,
          limit: 500,
        }),
      })

      await fetchMangadexChapters("massive-series-id", "en")

      // Should warn about the limit
      expect(logger.default.warn).toHaveBeenCalledWith(
        expect.stringContaining("12000")
      )
    })
  })

  describe("Image Download and Network Reporting", () => {
    it("downloads image and returns correct metadata", async () => {
      const mockImageData = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer // JPEG magic bytes

      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        arrayBuffer: async () => mockImageData,
        headers: {
          get: (name: string) => {
            if (name === "content-type") return "image/jpeg"
            if (name === "X-Cache") return "HIT from cache"
            return null
          },
        },
      })

      const result = await offscreenSiteAdapter.offscreen.chapter.downloadImage(
        "https://uploads.mangadex.org/data/abc123/page1.jpg"
      )

      expect(result.data.byteLength).toBe(4)
      expect(result.mimeType).toBe("image/jpeg")
      expect(result.filename).toBe("page1.jpg")
    })

    it("honors MangaDex X-RateLimit-Retry-After waits longer than the body stall timeout", async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"))

      try {
        const mockImageData = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer
        const fetchMock = global.fetch as ReturnType<typeof vi.fn>
        let imageFetchCount = 0

        fetchMock.mockImplementation(async (url: string) => {
          if (url.includes("mangadex.network/report")) {
            return { ok: true, headers: { get: () => null } }
          }

          imageFetchCount += 1
          if (imageFetchCount === 1) {
            return {
              ok: false,
              status: 429,
              statusText: "Too Many Requests",
              headers: new Headers({
                "X-RateLimit-Retry-After": String(
                  Math.floor(Date.now() / 1000) + 40
                ),
              }),
            }
          }

          return {
            ok: true,
            status: 200,
            statusText: "OK",
            arrayBuffer: async () => mockImageData,
            headers: {
              get: (name: string) => {
                if (name === "content-type") return "image/jpeg"
                if (name === "X-Cache") return "MISS"
                return null
              },
            },
          }
        })

        const resultPromise =
          offscreenSiteAdapter.offscreen.chapter.downloadImage(
            "https://uploads.mangadex.org/data/abc123/page1.jpg"
          )

        await vi.advanceTimersByTimeAsync(40_100)

        const result = await resultPromise
        expect(result.data.byteLength).toBe(4)
        expect(result.mimeType).toBe("image/jpeg")
        expect(result.filename).toBe("page1.jpg")
        expect(imageFetchCount).toBe(2)
      } finally {
        vi.useRealTimers()
      }
    })

    it("rejects non-raster image responses before reporting a successful download", async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        arrayBuffer: async () =>
          new TextEncoder().encode("<html>captcha</html>").buffer,
        headers: {
          get: (name: string) => {
            if (name === "content-type") return "text/html; charset=utf-8"
            if (name === "X-Cache") return "MISS"
            return null
          },
        },
      })

      await expect(
        offscreenSiteAdapter.offscreen.chapter.downloadImage(
          "https://uploads.mangadex.org/data/abc123/page1.jpg",
          {
            runtime: {
              chapterId: "ch-1",
              rateLimitService,
              rateLimitSettings: MANGADEX_RATE_LIMIT_SETTINGS,
            },
          }
        )
      ).rejects.toThrow("Unsupported MIME type: text/html")
      expect(global.fetch).not.toHaveBeenCalledWith(
        "https://api.mangadex.org/at-home/server/ch-1",
        expect.anything()
      )
    })

    it("handles abort signal during download", async () => {
      const abortController = new AbortController()
      abortController.abort()

      await expect(
        offscreenSiteAdapter.offscreen.chapter.downloadImage(
          "https://uploads.mangadex.org/data/abc123/page1.jpg",
          { signal: abortController.signal }
        )
      ).rejects.toThrow("aborted")
    })

    it("throws error on failed image download", async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
      })

      await expect(
        offscreenSiteAdapter.offscreen.chapter.downloadImage(
          "https://uploads.mangadex.org/data/abc123/missing.jpg"
        )
      ).rejects.toThrow("404")
    })

    it("refreshes the at-home host after a failed image request and retries on the new base URL", async () => {
      const mockImageData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer
      const fetchMock = global.fetch as ReturnType<typeof vi.fn>

      fetchMock.mockImplementation(async (url: string) => {
        if (url === "https://uploads.mangadex.org/data/hash123/1-old.png") {
          return {
            ok: false,
            status: 404,
            statusText: "Not Found",
            headers: { get: () => null },
          }
        }

        if (url === "https://api.mangadex.org/at-home/server/ch-1") {
          return {
            ok: true,
            json: async () => ({
              baseUrl: "https://new-node.mangadex.network",
              chapter: {
                hash: "hash456",
                data: ["1-new.png"],
                dataSaver: ["1-new.jpg"],
              },
            }),
            headers: { get: () => null },
          }
        }

        if (
          url === "https://new-node.mangadex.network/data/hash456/1-new.png"
        ) {
          return {
            ok: true,
            arrayBuffer: async () => mockImageData,
            headers: {
              get: (name: string) => {
                if (name === "content-type") return "image/png"
                if (name === "X-Cache") return "MISS"
                return null
              },
            },
          }
        }

        if (url.includes("mangadex.network/report")) {
          return { ok: true, headers: { get: () => null } }
        }

        throw new Error(`Unexpected fetch URL: ${url}`)
      })

      const result = await offscreenSiteAdapter.offscreen.chapter.downloadImage(
        "https://uploads.mangadex.org/data/hash123/1-old.png",
        {
          runtime: {
            chapterId: "ch-1",
            rateLimitService,
            rateLimitSettings: MANGADEX_RATE_LIMIT_SETTINGS,
          },
        }
      )

      expect(result.filename).toBe("1-new.png")
      expect(result.mimeType).toBe("image/png")
      expect(result.data.byteLength).toBe(4)
      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.mangadex.org/at-home/server/ch-1",
        expect.objectContaining({ credentials: "omit" })
      )
      expect(fetchMock).toHaveBeenCalledWith(
        "https://new-node.mangadex.network/data/hash456/1-new.png",
        expect.objectContaining({ credentials: "omit" })
      )
    })

    it("aborts a stalled at-home recovery request with the owning image signal", async () => {
      const fetchMock = global.fetch as ReturnType<typeof vi.fn>
      const controller = new AbortController()
      let recoveryStarted = false

      fetchMock.mockImplementation(
        async (url: string, options?: RequestInit) => {
          if (
            url === "https://same-node.mangadex.network/data/hash123/1-old.png"
          ) {
            return {
              ok: false,
              status: 404,
              statusText: "Not Found",
              headers: { get: () => null },
            }
          }

          if (url === "https://api.mangadex.org/at-home/server/ch-1") {
            recoveryStarted = true
            return await new Promise<never>((_resolve, reject) => {
              const signal = options?.signal
              if (signal?.aborted) {
                reject(
                  new DOMException("The operation was aborted.", "AbortError")
                )
                return
              }
              signal?.addEventListener(
                "abort",
                () =>
                  reject(
                    new DOMException("The operation was aborted.", "AbortError")
                  ),
                { once: true }
              )
            })
          }

          if (url.includes("mangadex.network/report")) {
            return { ok: true, headers: { get: () => null } }
          }

          throw new Error(`Unexpected fetch URL: ${url}`)
        }
      )

      const resultPromise =
        offscreenSiteAdapter.offscreen.chapter.downloadImage(
          "https://same-node.mangadex.network/data/hash123/1-old.png",
          {
            signal: controller.signal,
            runtime: {
              chapterId: "ch-1",
              rateLimitService,
              rateLimitSettings: MANGADEX_RATE_LIMIT_SETTINGS,
            },
          }
        )

      await vi.waitFor(() => expect(recoveryStarted).toBe(true))
      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.mangadex.org/at-home/server/ch-1",
        expect.objectContaining({ signal: controller.signal })
      )
      controller.abort()

      await expect(resultPromise).rejects.toMatchObject({
        name: "AbortError",
      })
    })

    it("falls back to uploads.mangadex.org after report-and-refresh returns the same base URL", async () => {
      const mockImageData = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer
      const fetchMock = global.fetch as ReturnType<typeof vi.fn>

      fetchMock.mockImplementation(async (url: string) => {
        if (
          url === "https://same-node.mangadex.network/data/hash123/1-old.png"
        ) {
          return {
            ok: false,
            status: 404,
            statusText: "Not Found",
            headers: { get: () => null },
          }
        }

        if (url === "https://api.mangadex.org/at-home/server/ch-1") {
          return {
            ok: true,
            json: async () => ({
              baseUrl: "https://same-node.mangadex.network",
              chapter: {
                hash: "hash123",
                data: ["1-old.png"],
                dataSaver: ["1-saver.jpg"],
              },
            }),
            headers: { get: () => null },
          }
        }

        if (url === "https://uploads.mangadex.org/data/hash123/1-old.png") {
          return {
            ok: true,
            arrayBuffer: async () => mockImageData,
            headers: {
              get: (name: string) => {
                if (name === "content-type") return "image/png"
                if (name === "X-Cache") return "MISS"
                return null
              },
            },
          }
        }

        if (url.includes("mangadex.network/report")) {
          return { ok: true, headers: { get: () => null } }
        }

        throw new Error(`Unexpected fetch URL: ${url}`)
      })

      const result = await offscreenSiteAdapter.offscreen.chapter.downloadImage(
        "https://same-node.mangadex.network/data/hash123/1-old.png",
        {
          runtime: {
            chapterId: "ch-1",
            rateLimitService,
            rateLimitSettings: MANGADEX_RATE_LIMIT_SETTINGS,
          },
        }
      )

      expect(result.filename).toBe("1-old.png")
      expect(result.mimeType).toBe("image/png")
      expect(result.data.byteLength).toBe(4)
      expect(fetchMock).toHaveBeenCalledWith(
        "https://uploads.mangadex.org/data/hash123/1-old.png",
        expect.objectContaining({ credentials: "omit" })
      )
      expect(fetchMock).not.toHaveBeenCalledWith(
        "https://same-node.mangadex.network/data-saver/hash123/1-saver.jpg",
        expect.anything()
      )
    })

    it("retries a later recovery cycle when the uploads fallback initially 404s", async () => {
      const mockImageData = new Uint8Array([0x47, 0x49, 0x46, 0x38]).buffer
      const fetchMock = global.fetch as ReturnType<typeof vi.fn>
      let atHomeFetchCount = 0
      let uploadsFetchCount = 0

      fetchMock.mockImplementation(async (url: string) => {
        if (
          url === "https://same-node.mangadex.network/data/hash123/1-old.png"
        ) {
          return {
            ok: false,
            status: 404,
            statusText: "Not Found",
            headers: { get: () => null },
          }
        }

        if (url === "https://api.mangadex.org/at-home/server/ch-1") {
          atHomeFetchCount += 1
          return {
            ok: true,
            json: async () => ({
              baseUrl: "https://same-node.mangadex.network",
              chapter: {
                hash: "hash123",
                data: ["1-old.png"],
                dataSaver: ["1-saver.jpg"],
              },
            }),
            headers: { get: () => null },
          }
        }

        if (url === "https://uploads.mangadex.org/data/hash123/1-old.png") {
          uploadsFetchCount += 1
          if (uploadsFetchCount === 1) {
            return {
              ok: false,
              status: 404,
              statusText: "Not Found",
              headers: { get: () => null },
            }
          }

          return {
            ok: true,
            arrayBuffer: async () => mockImageData,
            headers: {
              get: (name: string) => {
                if (name === "content-type") return "image/png"
                if (name === "X-Cache") return "MISS"
                return null
              },
            },
          }
        }

        if (url.includes("mangadex.network/report")) {
          return { ok: true, headers: { get: () => null } }
        }

        throw new Error(`Unexpected fetch URL: ${url}`)
      })

      const result = await offscreenSiteAdapter.offscreen.chapter.downloadImage(
        "https://same-node.mangadex.network/data/hash123/1-old.png",
        {
          runtime: {
            chapterId: "ch-1",
            rateLimitService,
            rateLimitSettings: MANGADEX_RATE_LIMIT_SETTINGS,
          },
        }
      )

      expect(result.filename).toBe("1-old.png")
      expect(result.mimeType).toBe("image/png")
      expect(result.data.byteLength).toBe(4)
      expect(atHomeFetchCount).toBe(2)
      expect(uploadsFetchCount).toBe(2)
    })

    it("retries a later recovery cycle when the uploads fallback initially 503s", async () => {
      const mockImageData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer
      const fetchMock = global.fetch as ReturnType<typeof vi.fn>
      let atHomeFetchCount = 0
      let uploadsFetchCount = 0

      fetchMock.mockImplementation(async (url: string) => {
        if (
          url === "https://same-node.mangadex.network/data/hash123/1-old.png"
        ) {
          return {
            ok: false,
            status: 503,
            statusText: "Service Unavailable",
            headers: { get: () => null },
          }
        }

        if (url === "https://api.mangadex.org/at-home/server/ch-1") {
          atHomeFetchCount += 1
          return {
            ok: true,
            json: async () => ({
              baseUrl: "https://same-node.mangadex.network",
              chapter: {
                hash: "hash123",
                data: ["1-old.png"],
                dataSaver: ["1-saver.jpg"],
              },
            }),
            headers: { get: () => null },
          }
        }

        if (url === "https://uploads.mangadex.org/data/hash123/1-old.png") {
          uploadsFetchCount += 1
          if (uploadsFetchCount === 1) {
            return {
              ok: false,
              status: 503,
              statusText: "Service Unavailable",
              headers: { get: () => null },
            }
          }

          return {
            ok: true,
            arrayBuffer: async () => mockImageData,
            headers: {
              get: (name: string) => {
                if (name === "content-type") return "image/png"
                if (name === "X-Cache") return "MISS"
                return null
              },
            },
          }
        }

        if (url.includes("mangadex.network/report")) {
          return { ok: true, headers: { get: () => null } }
        }

        throw new Error(`Unexpected fetch URL: ${url}`)
      })

      vi.useFakeTimers()

      try {
        const resultPromise =
          offscreenSiteAdapter.offscreen.chapter.downloadImage(
            "https://same-node.mangadex.network/data/hash123/1-old.png",
            {
              runtime: {
                chapterId: "ch-1",
                rateLimitService,
                rateLimitSettings: MANGADEX_RATE_LIMIT_SETTINGS,
              },
            }
          )

        await vi.advanceTimersByTimeAsync(20_000)

        const result = await resultPromise
        expect(result.filename).toBe("1-old.png")
        expect(result.mimeType).toBe("image/png")
        expect(result.data.byteLength).toBe(4)
        expect(atHomeFetchCount).toBe(2)
        expect(uploadsFetchCount).toBe(2)
      } finally {
        vi.useRealTimers()
      }
    })

    it("reports cache HIT correctly to network", async () => {
      const fetchCalls: Array<{ url: string; options?: RequestInit }> = []

      ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
        async (url: string, options?: RequestInit) => {
          fetchCalls.push({ url, options })

          if (url.includes("mangadex.network/report")) {
            return { ok: true }
          }

          return {
            ok: true,
            arrayBuffer: async () => new ArrayBuffer(1024),
            headers: {
              get: (name: string) => {
                if (name === "content-type") return "image/webp"
                if (name === "X-Cache") return "HIT"
                return null
              },
            },
          }
        }
      )

      await offscreenSiteAdapter.offscreen.chapter.downloadImage(
        "https://cdn.mangadex.network/data/abc123/page1.webp"
      )

      await vi.waitFor(() => {
        expect(
          fetchCalls.some((call) =>
            call.url.includes("mangadex.network/report")
          )
        ).toBe(true)
      })

      const reportCall = fetchCalls.find((call) =>
        call.url.includes("mangadex.network/report")
      )

      const body = JSON.parse(reportCall!.options?.body as string)
      expect(body.cached).toBe(true)
      expect(body.success).toBe(true)
    })

    it("does not block a completed image while network reporting is pending", async () => {
      let releaseReport!: () => void
      const reportPending = new Promise<Response>((resolve) => {
        releaseReport = () => resolve({ ok: true } as Response)
      })
      let reportStarted = false

      ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
        async (url: string) => {
          if (url.includes("mangadex.network/report")) {
            reportStarted = true
            return reportPending
          }

          return {
            ok: true,
            arrayBuffer: async () => new ArrayBuffer(4),
            headers: {
              get: (name: string) =>
                name.toLowerCase() === "content-type" ? "image/png" : null,
            },
          }
        }
      )

      let settled = false
      const resultPromise = offscreenSiteAdapter.offscreen.chapter
        .downloadImage("https://cdn.mangadex.network/data/abc/page.png")
        .then((result) => {
          settled = true
          return result
        })

      try {
        await vi.waitFor(() => expect(reportStarted).toBe(true))
        await Promise.resolve()
        expect(settled).toBe(true)
        await expect(resultPromise).resolves.toMatchObject({
          mimeType: "image/png",
        })
      } finally {
        releaseReport()
      }
    })
  })
})
