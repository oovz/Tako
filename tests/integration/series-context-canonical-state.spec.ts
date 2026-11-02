import { webcrypto } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createTabContextCache } from "@/entrypoints/background/tab-cache"
import { createTabContextResolver } from "@/entrypoints/background/tab-context-resolver"
import { TabContextStateService } from "@/entrypoints/background/tab-context-state-service"
import {
  E2E_SEED_TAB_CONTEXT_MESSAGE,
  registerE2EStateSeedListener,
} from "@/entrypoints/background/e2e-state-seed"
import { buildStartDownloadTask } from "@/entrypoints/background/download-queue-enqueue"
import { resolveDownloadPlan } from "@/entrypoints/background/queue-helpers"
import {
  canAdmitChapterDispatch,
  canSendChapterDispatch,
  createChapterDispatchMessage,
} from "@/entrypoints/background/chapter-dispatch-coordinator-context"
import { createDispatchLease } from "@/src/runtime/dispatch-lease"
import {
  groupChapters,
  normalizeStoredSeriesContext,
  deriveSeriesContextFromActiveTabContext,
} from "@/entrypoints/sidepanel/hooks/sidepanelSeriesContextHelpers"
import {
  getAllChapters,
  getBulkSelectionChange,
} from "@/entrypoints/sidepanel/hooks/useSelection-model"
import { RateLimitService } from "@/src/runtime/rate-limit"
import { MangaPageStateSchema } from "@/src/runtime/tab-state-schemas"
import { ResolvedTabContextSchema } from "@/src/runtime/resolved-tab-context-schema"
import { runtimeMessageRegistry } from "@/src/runtime/runtime-message-contracts"
import { SESSION_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import { createDefaultSettings } from "@/src/domain/settings/defaults"
import { setEnablementMap } from "@/src/site-integrations/catalog"
import { QueueRepository } from "@/src/storage/queue-repository"
import { QueueProjectionService } from "@/src/storage/queue-projection-service"
import { HistoryRepository } from "@/src/storage/history-repository"
import type { ResolvedTabReadyContext } from "@/src/types/resolved-tab-context"

const seriesId = "db692d58-4b13-4174-ae8c-30c515c0689c"
const priorSeriesId = "8f3e1818-a015-491d-bd81-3addc4d7d0a3"
const firstId = "11111111-1111-4111-8111-111111111111"
const lockedId = "22222222-2222-4222-8222-222222222222"
const oldId = "33333333-3333-4333-8333-333333333333"
const sourceUrl = `https://mangadex.org/title/${seriesId}`
const extensionId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
type SeedListener = Parameters<typeof chrome.runtime.onMessage.addListener>[0]

function jsonResponse(
  endpoint: string,
  data: unknown,
  body?: ReadableStream<Uint8Array>
) {
  const response = new Response(body ?? JSON.stringify(data), {
    headers: { "content-type": "application/json" },
  })
  Object.defineProperty(response, "url", { value: endpoint })
  return response
}

function readySeed(
  id = seriesId,
  chapterId = firstId
): ResolvedTabReadyContext {
  return {
    context: "ready",
    sourceUrl: `https://mangadex.org/title/${id}`,
    siteIntegrationId: "mangadex",
    mangaId: id,
    seriesTitle: "Prior title",
    chapters: [
      {
        id: chapterId,
        url: `https://mangadex.org/chapter/${chapterId}`,
        title: "First chapter",
        locked: false,
        chapterNumber: 2.5,
        volumeId: "volume-2",
        volumeNumber: 2,
        volumeLabel: "Volume Two",
        language: "en",
      },
      {
        id: lockedId,
        url: `https://mangadex.org/chapter/${lockedId}`,
        title: "Locked chapter",
        locked: true,
        chapterNumber: 3,
        volumeId: "volume-2",
        volumeNumber: 2,
        language: "en",
      },
    ],
    volumes: [{ id: "volume-2", title: "Volume Two" }],
  }
}

describe("canonical series state across real consumers", () => {
  let session: Record<string, unknown>
  let local: Record<string, unknown>
  let currentUrl: string
  let cache: ReturnType<typeof createTabContextCache>
  let service: TabContextStateService
  let resolver: ReturnType<typeof createTabContextResolver>
  let queue: QueueRepository
  let rates: RateLimitService
  let seedListener: SeedListener
  const fetchNetwork = vi.fn()
  const settingsReader = {
    getAll: async () => ({ mangadex: { autoReadMangaDexSettings: false } }),
    getForSite: async () => ({ autoReadMangaDexSettings: false }),
  }

  function storage(data: Record<string, unknown>) {
    return {
      get: async (keys: string | string[]) =>
        Object.fromEntries(
          [keys]
            .flat()
            .filter((key) => Object.hasOwn(data, key))
            .map((key) => [key, structuredClone(data[key])])
        ),
      set: async (values: Record<string, unknown>) =>
        Object.assign(data, structuredClone(values)),
      remove: async (keys: string | string[]) => {
        for (const key of [keys].flat()) delete data[key]
      },
      setAccessLevel: async () => undefined,
    }
  }

  function seed(
    context: ResolvedTabReadyContext
  ): Promise<{ success: boolean }> {
    return new Promise((resolve) => {
      expect(
        seedListener(
          {
            target: "e2e",
            type: E2E_SEED_TAB_CONTEXT_MESSAGE,
            payload: { tabId: 7, context },
          },
          {
            id: extensionId,
            url: `chrome-extension://${extensionId}/sidepanel.html`,
          },
          resolve
        )
      ).toBe(true)
    })
  }

  function panelContext() {
    return deriveSeriesContextFromActiveTabContext(
      normalizeStoredSeriesContext(
        session[SESSION_STORAGE_KEYS.activeTabContextByWindow],
        7,
        2,
        currentUrl
      )
    )
  }

  beforeEach(() => {
    session = {}
    local = {}
    currentUrl = sourceUrl
    setEnablementMap({ mangadex: true })
    vi.stubGlobal("crypto", webcrypto)
    vi.stubGlobal("chrome", {
      runtime: {
        id: extensionId,
        getURL: (path: string) => `chrome-extension://${extensionId}/${path}`,
        onMessage: {
          addListener: (listener: SeedListener) => {
            seedListener = listener
          },
        },
      },
      tabs: {
        get: async (id: number) => ({
          id,
          active: true,
          windowId: 2,
          url: currentUrl,
        }),
        query: async () => [
          { id: 7, active: true, windowId: 2, url: currentUrl },
        ],
      },
      action: {
        setBadgeText: async () => undefined,
        setBadgeBackgroundColor: async () => undefined,
      },
      storage: { session: storage(session), local: storage(local) },
    })
    vi.stubGlobal("fetch", fetchNetwork)
    fetchNetwork.mockReset().mockImplementation(async () => {
      throw new Error("Unexpected provider fetch")
    })
    rates = new RateLimitService({
      resolveEffectivePolicy: async () => ({ concurrency: 1, delayMs: 0 }),
    })
    cache = createTabContextCache()
    service = new TabContextStateService(cache)
    resolver = createTabContextResolver({
      tabContextCache: cache,
      getTabContextStateService: () => service,
      rateLimitService: rates,
      siteIntegrationSettingsReader: settingsReader,
    })
    queue = new QueueRepository(
      new QueueProjectionService(),
      new HistoryRepository()
    )
    registerE2EStateSeedListener({
      ensureRuntimeReady: () => service.initialize(),
      getTabContextStateService: () => service,
      cancelTabContextResolution: resolver.cancelTabContextResolution,
      queueRepository: queue,
      siteIntegrationEnablementService: { setAll: async () => undefined },
    })
  })

  afterEach(() => {
    rates.cleanupRateLimiters()
    setEnablementMap({})
    vi.unstubAllGlobals()
  })

  it.each(["initial", "same series", "different series"] as const)(
    "publishes real metadata partials with correct prior chapter ownership for %s",
    async (prior) => {
      const priorId = prior === "different series" ? priorSeriesId : seriesId
      if (prior !== "initial") {
        currentUrl = `https://mangadex.org/title/${priorId}`
        expect(
          await seed(
            readySeed(priorId, prior === "different series" ? oldId : firstId)
          )
        ).toEqual({ success: true })
        const persisted = MangaPageStateSchema.parse(session.tab_7)
        persisted.chapters[0] = {
          ...persisted.chapters[0],
          status: "completed",
          totalImages: 12,
          imagesFailed: 0,
          lastUpdated: 5,
        }
        session.tab_7 = MangaPageStateSchema.parse(persisted)
      }
      currentUrl = sourceUrl
      const delivery = Promise.withResolvers<void>()
      const feed = {
        result: "ok",
        data: [
          {
            id: firstId,
            type: "chapter",
            attributes: {
              chapter: "2.5",
              volume: "2",
              title: "First chapter",
              translatedLanguage: "en",
              pages: 2,
            },
          },
        ],
        total: 1,
        offset: 0,
        limit: 500,
      }
      fetchNetwork.mockImplementation(async (input: string | URL | Request) => {
        const endpoint = String(input)
        const path = new URL(endpoint).pathname
        if (path === `/manga/${seriesId}`)
          return jsonResponse(endpoint, {
            result: "ok",
            data: {
              id: seriesId,
              type: "manga",
              attributes: {
                title: { en: "Network title" },
                originalLanguage: "en",
              },
              relationships: [],
            },
          })
        if (path === `/statistics/manga/${seriesId}`)
          return jsonResponse(endpoint, { statistics: {} })
        if (path === `/manga/${seriesId}/feed`) {
          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              void delivery.promise.then(() => {
                controller.enqueue(
                  new TextEncoder().encode(JSON.stringify(feed))
                )
                controller.close()
              })
            },
          })
          return jsonResponse(endpoint, undefined, body)
        }
        throw new Error(`Unexpected provider endpoint: ${endpoint}`)
      })
      const pending = resolver.resolveTabContext(7, { windowId: 2 })
      try {
        await vi.waitFor(() =>
          expect(panelContext()).toMatchObject({
            mangaTitle: "Network title",
            seriesId,
            isChaptersLoading: true,
          })
        )
        const partial = MangaPageStateSchema.parse(session.tab_7)
        if (prior === "same series") {
          expect(partial.chapters.map((chapter) => chapter.id)).toEqual([
            firstId,
            lockedId,
          ])
          expect(partial.chapters[0]).toMatchObject({
            status: "completed",
            totalImages: 12,
            imagesFailed: 0,
            lastUpdated: 5,
          })
        } else expect(partial.chapters).toEqual([])
      } finally {
        delivery.resolve()
        await pending
      }
      expect(panelContext()).toMatchObject({
        mangaTitle: "Network title",
        seriesId,
        isChaptersLoading: false,
      })
      expect(
        (await cache.getCurrentSeriesContext(7, 2))?.context.chapters.map(
          (chapter) => chapter.id
        )
      ).toEqual([firstId])
    }
  )

  it("carries unlocked numeric metadata into durable tasks and a positive-ordinal offscreen request", async () => {
    expect(await seed(readySeed())).toEqual({ success: true })
    const current = await cache.getCurrentSeriesContext(7, 2)
    if (!current) throw new Error("Seed did not publish authoritative state")
    const items = groupChapters(
      current.context.chapters,
      current.context.volumes
    )
    const chapters = getAllChapters(items)
    const selectedIds = getBulkSelectionChange(chapters, chapters, true)
    expect(selectedIds).toEqual([firstId])
    const task = buildStartDownloadTask({
      context: current.context,
      selectedChapters: current.context.chapters.filter((chapter) =>
        selectedIds!.includes(chapter.id)
      ),
      settingsInputs: {
        settings: createDefaultSettings(),
        siteSettings: { autoReadMangaDexSettings: false },
        siteOverride: {},
        sitePolicyDefaults: undefined,
      },
      taskId: "canonical-task",
      now: Date.now(),
    })
    await expect(queue.enqueueDownloadTask(task)).resolves.toMatchObject({
      outcome: "applied",
    })
    await expect(
      queue.startDownloadTask({ taskId: task.id, now: Date.now() })
    ).resolves.toMatchObject({ outcome: "applied" })
    const persisted = await queue.getTask(task.id)
    if (!persisted) throw new Error("Task was not durably enqueued")
    const plan = await resolveDownloadPlan(persisted)
    expect(plan.chapters[0].comicInfo).toMatchObject({
      Number: "2.5",
      Volume: 2,
    })
    const candidate = {
      identity: {
        jobId: "canonical-job",
        attempt: 1,
        taskId: persisted.id,
        chapterId: firstId,
      },
    }
    expect(
      canAdmitChapterDispatch(
        persisted,
        await queue.getActiveDispatchLease(),
        candidate
      )
    ).toBe(true)
    const request = await createChapterDispatchMessage(
      {
        plan,
        chapter: plan.chapters[0],
        taskChapter: persisted.chapters[0],
        latestTask: persisted,
        destination: persisted.settingsSnapshot.destination,
        saveMode: "downloads-api",
      },
      candidate,
      persisted.settingsSnapshot,
      settingsReader
    )
    expect(
      runtimeMessageRegistry.OFFSCREEN_DOWNLOAD_CHAPTER.request.safeParse(
        request
      ).success
    ).toBe(true)
    expect(request.payload.chapter).toMatchObject({
      id: firstId,
      chapterNumber: 2.5,
      volumeNumber: 2,
      resolvedPath: persisted.chapters[0].requestedPath,
    })
    expect(request.payload.chapter.index).toBeGreaterThan(0)
    const lease = createDispatchLease({
      ...candidate.identity,
      fingerprint: request.payload.fingerprint,
      saveMode: "downloads-api",
      now: Date.now(),
    })
    await expect(
      queue.beginChapterDispatch({
        taskId: persisted.id,
        chapterId: firstId,
        lease,
        expectedPreviousLease: null,
        now: Date.now(),
      })
    ).resolves.toMatchObject({ outcome: "applied" })
    expect(
      canSendChapterDispatch(
        await queue.getTask(persisted.id),
        await queue.getActiveDispatchLease(),
        request
      )
    ).toBe(true)
  })

  it("rejects a schema-valid provider/source mismatch through public test seeding without changing state", async () => {
    const valid = readySeed()
    expect(await seed(valid)).toEqual({ success: true })
    const mismatched = { ...valid, siteIntegrationId: "pixiv-comic" }
    expect(ResolvedTabContextSchema.safeParse(mismatched).success).toBe(true)
    const before = structuredClone(session)
    expect(await seed(mismatched)).toMatchObject({ success: false })
    expect(session).toEqual(before)
    expect(
      (await cache.getCurrentSeriesContext(7, 2))?.context.siteIntegrationId
    ).toBe("mangadex")
    expect(fetchNetwork).not.toHaveBeenCalled()
  })
})
