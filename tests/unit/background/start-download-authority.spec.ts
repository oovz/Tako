import { beforeEach, describe, expect, it, vi } from "vitest"

import { createBackgroundQueueMessageHandlers } from "@/entrypoints/background/background-queue-message-handlers"
import type { BackgroundRuntimeHandlerDependencies } from "@/entrypoints/background/background-runtime-handler-dependencies"
import { QueueApplicationCommands } from "@/entrypoints/background/queue-application-commands"
import type { DownloadTaskCancellationCoordinator } from "@/entrypoints/background/download-task-cancellation-coordinator"
import type { QueueScheduler } from "@/entrypoints/background/queue-scheduler"
import type { NativeOutputCoordinator } from "@/entrypoints/background/native-output-coordinator"
import {
  createTabContextCache,
  type CurrentSeriesContext,
} from "@/entrypoints/background/tab-cache"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import type { QueueRepository } from "@/src/storage/queue-repository"
import type { RuntimeMessageRequest } from "@/src/runtime/runtime-message-contracts"
import { StartDownloadRejectedError } from "@/src/runtime/start-download-errors"
import { SESSION_STORAGE_KEYS } from "@/src/runtime/storage-keys"

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  getSiteOverrides: vi.fn(),
  getSiteSettings: vi.fn(),
  processDownloadQueue: vi.fn(async () => undefined),
}))

vi.mock("@/src/runtime/logger", () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

const payload: RuntimeMessageRequest<"START_DOWNLOAD">["payload"] = {
  sourceWindowId: 7,
  sourceTabId: 11,
  sourceUrl: "https://mangadex.org/title/series-1",
  siteIntegrationId: "mangadex",
  seriesId: "series-1",
  seriesRevision: 4,
  selectedChapterIds: ["chapter-1"],
}

function makeChapter(overrides: Record<string, unknown> = {}) {
  return {
    id: "chapter-1",
    url: "https://mangadex.org/chapter/chapter-1",
    title: "Chapter 1",
    index: 0,
    status: "queued" as const,
    lastUpdated: 1,
    ...overrides,
  }
}

function makeCurrent(
  overrides: Omit<Partial<CurrentSeriesContext>, "context"> & {
    context?: Partial<CurrentSeriesContext["context"]>
  } = {}
): CurrentSeriesContext {
  return {
    windowId: overrides.windowId ?? payload.sourceWindowId,
    revision: overrides.revision ?? payload.seriesRevision,
    context: {
      sourceUrl: payload.sourceUrl,
      siteIntegrationId: payload.siteIntegrationId,
      mangaId: payload.seriesId,
      seriesTitle: "Canonical Series",
      chapters: [makeChapter()],
      volumes: [],
      lastUpdated: 1,
      ...overrides.context,
    },
  }
}

describe("START_DOWNLOAD background authority", () => {
  const enqueueDownloadTask = vi.fn()
  const getCurrentSeriesContext = vi.fn()
  let commands: QueueApplicationCommands

  const createCommands = (
    resolveCurrentSeriesContext: typeof getCurrentSeriesContext,
    enablementService: {
      getAll: () => Promise<Record<string, boolean>>
    } = {
      getAll: vi.fn(async () => ({ mangadex: true })),
    }
  ) =>
    new QueueApplicationCommands({
      startDownloadSettings: {
        settingsRepository: { getSettings: mocks.getSettings },
        siteOverridesService: { getAll: mocks.getSiteOverrides },
        siteIntegrationSettingsService: {
          getForSite: mocks.getSiteSettings,
        },
      },
      queueRepository: { enqueueDownloadTask } as unknown as QueueRepository,
      nativeOutputCoordinator: {} as NativeOutputCoordinator,
      cancellationCoordinator: {} as DownloadTaskCancellationCoordinator,
      queueScheduler: {
        activate: mocks.processDownloadQueue,
      } as unknown as QueueScheduler,
      destinationService: {} as never,
      siteIntegrationEnablementService: enablementService,
      getCurrentSeriesContext: resolveCurrentSeriesContext,
    })

  const createAuthorityCache = (
    getTab: (tabId: number) => Promise<
      | (Pick<chrome.tabs.Tab, "url" | "pendingUrl"> & {
          active?: boolean
          windowId?: number
        })
      | undefined
    >
  ): ReturnType<typeof createTabContextCache> => {
    const sessionState = {
      [SESSION_STORAGE_KEYS.activeTabContextByWindow]: {
        [payload.sourceWindowId]: {
          windowId: payload.sourceWindowId,
          activeTabId: payload.sourceTabId,
          revision: payload.seriesRevision,
          timestamp: 1,
          context: makeCurrent().context,
        },
      },
    }
    return createTabContextCache({
      readSession: vi.fn(async (keys: string[]) =>
        Object.fromEntries(
          keys.flatMap((key) =>
            key in sessionState
              ? [[key, sessionState[key as keyof typeof sessionState]]]
              : []
          )
        )
      ),
      writeSession: vi.fn(async () => undefined),
      queryActiveTabs: vi.fn(async () => [
        { id: payload.sourceTabId, windowId: payload.sourceWindowId },
      ]),
      getTab,
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSettings.mockResolvedValue(DEFAULT_SETTINGS)
    mocks.getSiteOverrides.mockResolvedValue({})
    mocks.getSiteSettings.mockResolvedValue({})
    getCurrentSeriesContext.mockResolvedValue(makeCurrent())
    enqueueDownloadTask.mockImplementation(async (task) => ({
      outcome: "applied",
      task,
    }))
    vi.stubGlobal("chrome", {
      permissions: { contains: vi.fn(async () => true) },
    } as unknown as typeof chrome)

    commands = createCommands(getCurrentSeriesContext)
  })

  it("reconstructs canonical task data from the second authoritative read", async () => {
    const first = makeCurrent({
      context: {
        seriesTitle: "First title",
        chapters: [makeChapter({ title: "First chapter", url: "first" })],
      },
    })
    const second = makeCurrent({
      context: {
        seriesTitle: " Canonical title ",
        chapters: [
          makeChapter({
            title: " Canonical chapter ",
            url: "https://mangadex.org/chapter/canonical",
            chapterLabel: " Ch. 1 ",
          }),
        ],
        metadata: {
          author: "Author",
          coverUrl: "https://example.com/cover.jpg",
        },
      },
    })
    getCurrentSeriesContext
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second)

    const result = await commands.startDownload(payload, "command-start")

    expect(result.taskId).toEqual(expect.any(String))
    expect(getCurrentSeriesContext).toHaveBeenNthCalledWith(1, 11, 7)
    expect(getCurrentSeriesContext).toHaveBeenNthCalledWith(2, 11, 7)
    expect(enqueueDownloadTask).toHaveBeenCalledTimes(1)
    expect(enqueueDownloadTask.mock.calls[0]?.[0]).toMatchObject({
      id: result.taskId,
      siteIntegrationId: "mangadex",
      mangaId: "series-1",
      seriesTitle: "Canonical title",
      seriesCoverUrl: "https://example.com/cover.jpg",
      chapters: [
        {
          id: "chapter-1",
          title: "Canonical chapter",
          url: "https://mangadex.org/chapter/canonical",
          chapterLabel: "Ch. 1",
          status: "queued",
        },
      ],
      settingsSnapshot: {
        comicInfo: {
          author: "Author",
          coverUrl: "https://example.com/cover.jpg",
        },
      },
    })
    expect(mocks.processDownloadQueue).toHaveBeenCalledTimes(1)
  })

  it.each([
    ["missing session projection", undefined],
    ["inactive or moved tab", undefined],
    ["cross-window projection", makeCurrent({ windowId: 8 })],
    ["stale revision", makeCurrent({ revision: 5 })],
    [
      "stale URL",
      makeCurrent({ context: { sourceUrl: "https://example.com/other" } }),
    ],
    [
      "stale provider",
      makeCurrent({ context: { siteIntegrationId: "pixiv-comic" } }),
    ],
    ["stale series", makeCurrent({ context: { mangaId: "series-2" } })],
    [
      "partial chapter context",
      makeCurrent({ context: { chaptersLoading: true } }),
    ],
    [
      "duplicate authoritative chapter IDs",
      makeCurrent({
        context: {
          chapters: [
            makeChapter(),
            makeChapter({ url: "https://mangadex.org/chapter/duplicate" }),
          ],
        },
      }),
    ],
  ])("rejects %s before loading settings", async (_label, current) => {
    getCurrentSeriesContext.mockResolvedValue(current)

    await expect(
      commands.startDownload(payload, "command-start")
    ).rejects.toThrow(
      "Series context is stale; refresh the page before downloading"
    )

    expect(mocks.getSettings).not.toHaveBeenCalled()
    expect(enqueueDownloadTask).not.toHaveBeenCalled()
    expect(mocks.processDownloadQueue).not.toHaveBeenCalled()
  })

  it.each([
    ["duplicate selected IDs", ["chapter-1", "chapter-1"], makeCurrent()],
    ["unknown selected ID", ["unknown"], makeCurrent()],
    [
      "locked selected chapter",
      ["chapter-1"],
      makeCurrent({ context: { chapters: [makeChapter({ locked: true })] } }),
    ],
  ])("rejects %s before loading settings", async (_label, ids, current) => {
    getCurrentSeriesContext.mockResolvedValue(current)

    await expect(
      commands.startDownload(
        { ...payload, selectedChapterIds: ids },
        "command-start"
      )
    ).rejects.toThrow("Selected chapters are not valid for the current series")

    expect(mocks.getSettings).not.toHaveBeenCalled()
    expect(enqueueDownloadTask).not.toHaveBeenCalled()
    expect(mocks.processDownloadQueue).not.toHaveBeenCalled()
  })

  it("rejects a navigation supersession after settings load without enqueue or activation", async () => {
    let releaseSettings!: () => void
    const settingsPaused = new Promise<void>((resolve) => {
      releaseSettings = resolve
    })
    mocks.getSettings.mockImplementation(async () => {
      await settingsPaused
      return DEFAULT_SETTINGS
    })
    getCurrentSeriesContext
      .mockResolvedValueOnce(makeCurrent())
      .mockResolvedValueOnce(undefined)

    const result = commands.startDownload(payload, "command-start")
    await vi.waitFor(() => expect(mocks.getSettings).toHaveBeenCalledTimes(1))
    expect(getCurrentSeriesContext).toHaveBeenCalledTimes(1)

    releaseSettings()

    await expect(result).rejects.toThrow(
      "Series context is stale; refresh the page before downloading"
    )
    expect(getCurrentSeriesContext).toHaveBeenCalledTimes(2)
    expect(enqueueDownloadTask).not.toHaveBeenCalled()
    expect(mocks.processDownloadQueue).not.toHaveBeenCalled()
  })

  it("does not load settings when the real tab authority observes a pending navigation", async () => {
    const getTab = vi.fn(async () => ({
      url: payload.sourceUrl,
      pendingUrl: "https://mangadex.org/title/series-2",
      active: true,
      windowId: payload.sourceWindowId,
    }))
    const cache = createAuthorityCache(getTab)
    commands = createCommands(vi.fn(cache.getCurrentSeriesContext.bind(cache)))

    await expect(
      commands.startDownload(payload, "command-start")
    ).rejects.toThrow(
      "Series context is stale; refresh the page before downloading"
    )
    expect(mocks.getSettings).not.toHaveBeenCalled()
    expect(enqueueDownloadTask).not.toHaveBeenCalled()
    expect(mocks.processDownloadQueue).not.toHaveBeenCalled()
  })

  it("rejects when the real tab authority observes a pending reload during settings", async () => {
    const tabState: { pendingUrl?: string } = {}
    const getTab = vi.fn(async () => ({
      url: payload.sourceUrl,
      pendingUrl: tabState.pendingUrl,
      active: true,
      windowId: payload.sourceWindowId,
    }))
    const cache = createAuthorityCache(getTab)
    commands = createCommands(vi.fn(cache.getCurrentSeriesContext.bind(cache)))
    let releaseSettings!: () => void
    const settingsPaused = new Promise<void>((resolve) => {
      releaseSettings = resolve
    })
    mocks.getSettings.mockImplementation(async () => {
      await settingsPaused
      return DEFAULT_SETTINGS
    })

    const result = commands.startDownload(payload, "command-start")
    await vi.waitFor(() => expect(mocks.getSettings).toHaveBeenCalledTimes(1))
    tabState.pendingUrl = payload.sourceUrl
    releaseSettings()

    await expect(result).rejects.toThrow(
      "Series context is stale; refresh the page before downloading"
    )
    expect(getTab).toHaveBeenCalledTimes(2)
    expect(enqueueDownloadTask).not.toHaveBeenCalled()
    expect(mocks.processDownloadQueue).not.toHaveBeenCalled()
  })

  it("waits for the durable enqueue before activation", async () => {
    let commitTask: unknown
    let releaseCommit!: () => void
    const commitPaused = new Promise<void>((resolve) => {
      releaseCommit = resolve
    })
    enqueueDownloadTask.mockImplementation(async (task) => {
      commitTask = task
      await commitPaused
      return { outcome: "applied", task }
    })

    const result = commands.startDownload(payload, "command-start")
    await vi.waitFor(() => expect(enqueueDownloadTask).toHaveBeenCalledTimes(1))
    expect(commitTask).toBeDefined()
    expect(mocks.processDownloadQueue).not.toHaveBeenCalled()

    releaseCommit()

    await expect(result).resolves.toEqual({ taskId: expect.any(String) })
    expect(mocks.processDownloadQueue).toHaveBeenCalledTimes(1)
  })

  it("does not activate when durable enqueue fails", async () => {
    enqueueDownloadTask.mockRejectedValue(new Error("storage failed"))

    await expect(
      commands.startDownload(payload, "command-start")
    ).rejects.toThrow("storage failed")
    expect(mocks.processDownloadQueue).not.toHaveBeenCalled()
  })

  it("rejects with a typed code when the integration is disabled", async () => {
    const enablement = {
      getAll: vi.fn(async () => ({ mangadex: false })),
    }
    commands = createCommands(getCurrentSeriesContext, enablement)

    await expect(
      commands.startDownload(payload, "command-start")
    ).rejects.toMatchObject({
      name: "StartDownloadRejectedError",
      code: "integration_disabled",
    })
    expect(enqueueDownloadTask).not.toHaveBeenCalled()
  })

  it("rejects with a typed code when required host permission is absent", async () => {
    vi.stubGlobal("chrome", {
      permissions: { contains: vi.fn(async () => false) },
    } as unknown as typeof chrome)

    await expect(
      commands.startDownload(payload, "command-start")
    ).rejects.toMatchObject({
      name: "StartDownloadRejectedError",
      code: "host_permission_required",
    })
    expect(enqueueDownloadTask).not.toHaveBeenCalled()
  })

  it("keeps the START handler as a thin payload delegation", async () => {
    const startDownload = vi.fn(async () => ({ taskId: "task-1" }))
    const handlers = createBackgroundQueueMessageHandlers({
      queueApplicationCommands: { startDownload },
    } as unknown as BackgroundRuntimeHandlerDependencies)
    const message: RuntimeMessageRequest<"START_DOWNLOAD"> = {
      target: "background",
      type: "START_DOWNLOAD",
      commandId: "command-1",
      issuedAt: 1,
      payload,
    }

    await expect(
      handlers.START_DOWNLOAD(message, {} as chrome.runtime.MessageSender)
    ).resolves.toEqual({ success: true, taskId: "task-1" })
    expect(startDownload).toHaveBeenCalledWith(payload, "command-1")
    expect(startDownload).toHaveBeenCalledTimes(1)
  })

  it("maps a rejected start to the typed failure response", async () => {
    const startDownload = vi.fn(async () => {
      throw new StartDownloadRejectedError(
        "integration_disabled",
        "Site integration mangadex is disabled"
      )
    })
    const handlers = createBackgroundQueueMessageHandlers({
      queueApplicationCommands: { startDownload },
    } as unknown as BackgroundRuntimeHandlerDependencies)
    const message: RuntimeMessageRequest<"START_DOWNLOAD"> = {
      target: "background",
      type: "START_DOWNLOAD",
      commandId: "command-1",
      issuedAt: 1,
      payload,
    }

    await expect(
      handlers.START_DOWNLOAD(message, {} as chrome.runtime.MessageSender)
    ).resolves.toEqual({
      success: false,
      error: "Site integration mangadex is disabled",
      code: "integration_disabled",
    })
  })
})
