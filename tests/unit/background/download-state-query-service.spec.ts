import { beforeEach, describe, expect, it, vi } from "vitest"

import { BackgroundDownloadStateQueryService } from "@/entrypoints/background/download-state-query-service"
import { createBackgroundDownloadStateMessageHandlers } from "@/entrypoints/background/background-download-state-message-handlers"
import { dispatchRuntimeMessage } from "@/src/runtime/runtime-message-dispatcher"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import type { DownloadTaskState } from "@/src/domain/queue/state"

function createTask(): DownloadTaskState {
  return {
    id: "task-1",
    siteIntegrationId: "mangadex",
    mangaId: "series-1",
    seriesTitle: "Series 1",
    status: "queued",
    created: 1,
    chapters: [
      {
        requestedPath: "Tako/Chapter.cbz",
        id: "chapter-1",
        url: "https://example.test/chapter-1",
        title: "Chapter 1",
        index: 1,
        status: "queued",
        lastUpdated: 1,
      },
    ],
    settingsSnapshot: createTaskSettingsSnapshot(DEFAULT_SETTINGS, "mangadex"),
  }
}

describe("BackgroundDownloadStateQueryService", () => {
  const getQueue = vi.fn()
  const getDownloadedChapters = vi.fn()
  const getBytesInUse = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    getQueue.mockResolvedValue([])
    getDownloadedChapters.mockResolvedValue([])
    getBytesInUse.mockResolvedValue(42)
    vi.stubGlobal("chrome", {
      storage: { local: { getBytesInUse } },
    })
  })

  it("returns the full queue and queue bytes for Options", async () => {
    const task = createTask()
    getQueue.mockResolvedValue([task])

    const service = new BackgroundDownloadStateQueryService(
      { getQueue } as never,
      { getDownloadedChapters } as never
    )

    await expect(service.getOptionsDownloadState()).resolves.toEqual({
      tasks: [task],
      queueStorageBytes: 42,
    })
    expect(getQueue).toHaveBeenCalledOnce()
    expect(getBytesInUse).toHaveBeenCalledWith("downloadQueue")
  })

  it("exposes query results through the exact background handlers", async () => {
    const queryService = {
      getOptionsDownloadState: vi.fn().mockResolvedValue({
        tasks: [],
        queueStorageBytes: 0,
      }),
      getSidepanelDownloadState: vi.fn().mockResolvedValue({
        downloadedChapters: [],
      }),
    }
    const handlers = createBackgroundDownloadStateMessageHandlers({
      downloadStateQueryService: queryService,
    } as never)

    await expect(
      handlers.GET_OPTIONS_DOWNLOAD_STATE({} as never, {} as never)
    ).resolves.toEqual({
      success: true,
      data: { tasks: [], queueStorageBytes: 0 },
    })
    await expect(
      handlers.GET_SIDEPANEL_DOWNLOAD_STATE({} as never, {} as never)
    ).resolves.toEqual({
      success: true,
      data: { downloadedChapters: [] },
    })
  })

  it("authorizes the Options query only for the Options principal", async () => {
    const handlers = createBackgroundDownloadStateMessageHandlers({
      downloadStateQueryService: {
        getOptionsDownloadState: vi.fn().mockResolvedValue({
          tasks: [],
          queueStorageBytes: 0,
        }),
        getSidepanelDownloadState: vi.fn().mockResolvedValue({
          downloadedChapters: [],
        }),
      },
    } as never)
    const request = {
      target: "background",
      type: "GET_OPTIONS_DOWNLOAD_STATE",
    } as const

    await expect(
      dispatchRuntimeMessage(
        request,
        {},
        {
          target: "background",
          handlers: handlers as never,
          classifySender: () => "options",
          waitForReadiness: vi.fn(async () => undefined),
        }
      )
    ).resolves.toEqual({
      success: true,
      data: { tasks: [], queueStorageBytes: 0 },
    })

    await expect(
      dispatchRuntimeMessage(
        request,
        {},
        {
          target: "background",
          handlers: handlers as never,
          classifySender: () => "sidepanel",
          waitForReadiness: vi.fn(async () => undefined),
        }
      )
    ).resolves.toEqual({
      success: false,
      error: "GET_OPTIONS_DOWNLOAD_STATE is not authorized for sidepanel",
    })
  })

  it("returns downloaded chapter results for Side Panel", async () => {
    const chapter = {
      siteIntegrationId: "mangadex",
      chapterId: "chapter-1",
      url: "https://example.test/chapter-1",
      title: "Chapter 1",
      seriesId: "series-1",
      seriesTitle: "Series 1",
      downloadedAt: 1,
      format: "none" as const,
    }
    getDownloadedChapters.mockResolvedValue([chapter])

    const service = new BackgroundDownloadStateQueryService(
      { getQueue } as never,
      { getDownloadedChapters } as never
    )

    await expect(service.getSidepanelDownloadState()).resolves.toEqual({
      downloadedChapters: [chapter],
    })
    expect(getDownloadedChapters).toHaveBeenCalledOnce()
    expect(getBytesInUse).not.toHaveBeenCalled()
  })

  it("propagates malformed queue state from the queue owner", async () => {
    getQueue.mockRejectedValue(new Error("Stored queue is invalid"))
    const service = new BackgroundDownloadStateQueryService(
      { getQueue } as never,
      { getDownloadedChapters } as never
    )

    await expect(service.getOptionsDownloadState()).rejects.toThrow(
      "Stored queue is invalid"
    )
  })
})
