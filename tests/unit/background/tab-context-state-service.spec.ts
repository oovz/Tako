import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  TabContextStateService,
  type TabContextStateProjection,
} from "@/entrypoints/background/tab-context-state-service"
import { createTabContextCache } from "@/entrypoints/background/tab-cache"
import type { ResolvedTabContext } from "@/src/types/resolved-tab-context"

const matchUrl = vi.hoisted(() => vi.fn())
vi.mock("@/src/site-integrations/url-matcher", () => ({ matchUrl }))

describe("TabContextStateService", () => {
  const session: Record<string, unknown> = {}
  const set = vi.fn(async (values: Record<string, unknown>) => {
    Object.assign(session, values)
  })
  const remove = vi.fn(async (keys: string | string[]) => {
    for (const key of typeof keys === "string" ? [keys] : keys) {
      delete session[key]
    }
  })
  const setAccessLevel = vi.fn(async () => undefined)

  const projection: TabContextStateProjection = {
    commitTabContextMutation: vi.fn(async (_tabId, _options, mutation) => {
      await mutation()
      return true
    }),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    for (const key of Object.keys(session)) delete session[key]
    matchUrl.mockReturnValue({ integrationId: "mangadex" })
    vi.stubGlobal("chrome", {
      storage: {
        session: {
          get: vi.fn(async (keys: string | string[]) => {
            const requested = typeof keys === "string" ? [keys] : keys
            return Object.fromEntries(
              requested
                .filter((key) =>
                  Object.prototype.hasOwnProperty.call(session, key)
                )
                .map((key) => [key, session[key]])
            )
          }),
          set,
          remove,
          setAccessLevel,
        },
      },
    } as unknown as typeof chrome)
  })

  it("rejects a ready payload without chapters without changing existing state", async () => {
    const existingState = {
      sourceUrl: "https://mangadex.org/title/series-1",
      siteIntegrationId: "mangadex",
      mangaId: "series-1",
      seriesTitle: "Existing Series",
      chapters: [],
      volumes: [],
      lastUpdated: 5,
    }
    session.tab_7 = existingState
    session.seriesContextError_7 = "existing error"
    const service = new TabContextStateService(projection)

    const result = await service.commitResolvedTabContext(
      {
        context: "ready",
        sourceUrl: existingState.sourceUrl,
        siteIntegrationId: existingState.siteIntegrationId,
        mangaId: existingState.mangaId,
        seriesTitle: existingState.seriesTitle,
      } as unknown as ResolvedTabContext,
      7
    )

    expect(result).toEqual({ success: false })
    expect(session.tab_7).toEqual(existingState)
    expect(session.seriesContextError_7).toBe("existing error")
    expect(projection.commitTabContextMutation).not.toHaveBeenCalled()
  })

  it("initializes access and merges chapter progress for the same series", async () => {
    session.tab_7 = {
      sourceUrl: "https://mangadex.org/title/series-1",
      siteIntegrationId: "mangadex",
      mangaId: "series-1",
      seriesTitle: "Old title",
      chapters: [
        {
          id: "chapter-1",
          url: "https://mangadex.org/chapter/1",
          title: "Chapter 1",
          index: 1,
          status: "completed",
          errorMessage: "old error",
          lastUpdated: 5,
        },
      ],
      volumes: [],
      lastUpdated: 5,
    }
    const service = new TabContextStateService(projection)
    await service.initialize()
    const result = await service.commitResolvedTabContext(
      {
        context: "ready",
        sourceUrl: "https://mangadex.org/title/series-1",
        siteIntegrationId: "mangadex",
        mangaId: "series-1",
        seriesTitle: "New title",
        chapters: [
          {
            id: "chapter-1",
            url: "https://mangadex.org/chapter/1",
            title: "Chapter 1",
          },
        ],
      },
      7
    )

    expect(result.success).toBe(true)
    expect(session.tab_7).toMatchObject({
      seriesTitle: "New title",
      chapters: [
        {
          id: "chapter-1",
          status: "completed",
          errorMessage: "old error",
        },
      ],
    })
    expect(setAccessLevel).toHaveBeenCalledWith({
      accessLevel: "TRUSTED_CONTEXTS",
    })
  })

  it("clears a partial loading flag when the final ready payload omits it", async () => {
    session.tab_7 = {
      sourceUrl: "https://mangadex.org/title/series-1",
      siteIntegrationId: "mangadex",
      mangaId: "series-1",
      seriesTitle: "Series",
      chapters: [],
      volumes: [],
      chaptersLoading: true,
      lastUpdated: 5,
    }
    const service = new TabContextStateService(projection)

    const result = await service.commitResolvedTabContext(
      {
        context: "ready",
        sourceUrl: "https://mangadex.org/title/series-1",
        siteIntegrationId: "mangadex",
        mangaId: "series-1",
        seriesTitle: "Series",
        chapters: [],
      },
      7
    )

    expect(result).toEqual({
      success: true,
      tabState: expect.objectContaining({ chaptersLoading: false }),
    })
    expect(session.tab_7).toMatchObject({ chaptersLoading: false })
  })

  it("clears unsupported and error projections through the serialized projection", async () => {
    const service = new TabContextStateService(projection)
    session.tab_7 = { stale: true }
    session.seriesContextError_7 = "stale"

    await expect(
      service.commitResolvedTabContext({ context: "unsupported" }, 7)
    ).resolves.toEqual({ success: true, tabState: null })
    expect(session.tab_7).toBeUndefined()
    expect(session.seriesContextError_7).toBeUndefined()

    await expect(
      service.commitResolvedTabContext({ context: "error", error: "failed" }, 7)
    ).resolves.toEqual({ success: true, tabState: { error: "failed" } })
    expect(session.seriesContextError_7).toBe("failed")
  })

  it("routes navigation invalidation through the service owner without cache key writes", async () => {
    session.tab_7 = {
      sourceUrl: "https://mangadex.org/title/series-1",
      siteIntegrationId: "mangadex",
      mangaId: "series-1",
      seriesTitle: "Series",
      chapters: [],
      volumes: [],
      lastUpdated: 1,
    }
    session.seriesContextError_7 = "stale error"

    const cache = createTabContextCache({
      readSession: async (keys) => {
        const result: Record<string, unknown> = {}
        for (const key of keys) {
          if (Object.prototype.hasOwnProperty.call(session, key)) {
            result[key] = session[key]
          }
        }
        return result
      },
      writeSession: set,
      queryActiveTabs: async () => [{ id: 7, windowId: 1 }],
      getTab: async () => ({
        id: 7,
        url: "https://example.com/unsupported",
        windowId: 1,
        active: true,
      }),
    })
    const service = new TabContextStateService(cache)

    await expect(
      service.clearTabState(7, {
        windowId: 1,
        expectedUrl: "https://example.com/unsupported",
      })
    ).resolves.toBe(true)

    expect(session.tab_7).toBeUndefined()
    expect(session.seriesContextError_7).toBeUndefined()
    expect(cache.getCachedContext(7)).toBeNull()
  })

  it("advances navigation revision before loading and preserves it on complete", async () => {
    const cache = createTabContextCache({
      readSession: async (keys) => {
        const result: Record<string, unknown> = {}
        for (const key of keys) {
          if (Object.prototype.hasOwnProperty.call(session, key)) {
            result[key] = session[key]
          }
        }
        return result
      },
      writeSession: set,
      queryActiveTabs: async () => [{ id: 7, windowId: 1 }],
      getTab: async () => ({
        id: 7,
        url: "https://mangadex.org/title/series-1",
        windowId: 1,
        active: true,
      }),
    })
    const service = new TabContextStateService(cache)
    const initial = await cache.projectLoadingForTab(7, 1)
    expect(initial).toEqual({ requestId: 1 })

    await expect(
      service.clearTabState(7, {
        windowId: 1,
        expectedUrl: "https://mangadex.org/title/series-1",
      })
    ).resolves.toBe(true)
    expect(await cache.isRequestIdCurrent(1, 1)).toBe(false)

    await cache.handleTabUpdated(7, { status: "loading" })
    const loading = await cache.projectLoadingForTab(7, 1)
    expect(loading).toEqual({ requestId: 3 })

    await cache.handleTabUpdated(7, { status: "complete" })
    expect(await cache.isRequestIdCurrent(1, 3)).toBe(true)
  })

  it("does not publish when the projection rejects a stale request", async () => {
    const staleProjection: TabContextStateProjection = {
      commitTabContextMutation: vi.fn(async () => false),
    }
    const service = new TabContextStateService(staleProjection)
    const result = await service.commitResolvedTabContext(
      {
        context: "ready",
        sourceUrl: "https://mangadex.org/title/series-1",
        siteIntegrationId: "mangadex",
        mangaId: "series-1",
        seriesTitle: "Series",
        chapters: [],
      },
      7,
      {
        requestId: 3,
        windowId: 1,
        expectedUrl: "https://mangadex.org/title/series-1",
      }
    )
    expect(result).toEqual({ success: true })
    expect(set).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
  })

  it("does not report stale unsupported or error payloads as applied", async () => {
    const staleProjection: TabContextStateProjection = {
      commitTabContextMutation: vi.fn(async () => false),
    }
    const service = new TabContextStateService(staleProjection)

    await expect(
      service.commitResolvedTabContext({ context: "unsupported" }, 7, {
        requestId: 3,
        windowId: 1,
      })
    ).resolves.toEqual({ success: true })

    await expect(
      service.commitResolvedTabContext(
        { context: "error", error: "stale error" },
        7,
        {
          requestId: 3,
          windowId: 1,
        }
      )
    ).resolves.toEqual({ success: true })

    expect(set).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
  })
})
