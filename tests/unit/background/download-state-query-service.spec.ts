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
  const readDestinationIssues = vi.fn()
  const getBytesInUse = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    getQueue.mockResolvedValue([])
    getDownloadedChapters.mockResolvedValue([])
    readDestinationIssues.mockResolvedValue([])
    getBytesInUse.mockResolvedValue(42)
    vi.stubGlobal("chrome", {
      storage: { local: { getBytesInUse } },
    })
  })

  it("returns the full queue, current destination issue, and queue bytes for Options", async () => {
    const task = createTask()
    const issue = {
      id: "task-1::fsa_folder_missing",
      taskId: "task-1",
      kind: "fsa_folder_missing" as const,
      occurredAt: 1,
    }
    getQueue.mockResolvedValue([task])
    readDestinationIssues.mockResolvedValue([issue])

    const service = new BackgroundDownloadStateQueryService(
      { getQueue } as never,
      { getDownloadedChapters } as never,
      { getIssues: readDestinationIssues } as never
    )

    await expect(service.getOptionsDownloadState()).resolves.toEqual({
      tasks: [task],
      destinationIssue: issue,
      queueStorageBytes: 42,
    })
    expect(getQueue).toHaveBeenCalledOnce()
    expect(getBytesInUse).toHaveBeenCalledWith("downloadQueue")
  })

  it("exposes query results through the exact background handlers", async () => {
    const queryService = {
      getOptionsDownloadState: vi.fn().mockResolvedValue({
        tasks: [],
        destinationIssue: null,
        queueStorageBytes: 0,
      }),
      getSidepanelDownloadState: vi.fn().mockResolvedValue({
        downloadedChapters: [],
        destinationIssue: null,
      }),
    }
    const handlers = createBackgroundDownloadStateMessageHandlers({
      downloadStateQueryService: queryService,
    } as never)

    await expect(
      handlers.GET_OPTIONS_DOWNLOAD_STATE({} as never, {} as never)
    ).resolves.toEqual({
      success: true,
      data: { tasks: [], destinationIssue: null, queueStorageBytes: 0 },
    })
    await expect(
      handlers.GET_SIDEPANEL_DOWNLOAD_STATE({} as never, {} as never)
    ).resolves.toEqual({
      success: true,
      data: { downloadedChapters: [], destinationIssue: null },
    })
  })

  it("authorizes the Options query only for the Options principal", async () => {
    const handlers = createBackgroundDownloadStateMessageHandlers({
      downloadStateQueryService: {
        getOptionsDownloadState: vi.fn().mockResolvedValue({
          tasks: [],
          destinationIssue: null,
          queueStorageBytes: 0,
        }),
        getSidepanelDownloadState: vi.fn().mockResolvedValue({
          downloadedChapters: [],
          destinationIssue: null,
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
      data: { tasks: [], destinationIssue: null, queueStorageBytes: 0 },
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

  it("returns only downloaded chapters and destination issue for Side Panel", async () => {
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
      { getDownloadedChapters } as never,
      { getIssues: readDestinationIssues } as never
    )

    await expect(service.getSidepanelDownloadState()).resolves.toEqual({
      downloadedChapters: [chapter],
      destinationIssue: null,
    })
    expect(getDownloadedChapters).toHaveBeenCalledOnce()
    expect(getBytesInUse).not.toHaveBeenCalled()
  })

  it("rejects malformed durable destination state instead of filtering it", async () => {
    readDestinationIssues.mockRejectedValue(
      new Error("Stored destination issues are invalid")
    )
    const service = new BackgroundDownloadStateQueryService(
      { getQueue } as never,
      { getDownloadedChapters } as never,
      { getIssues: readDestinationIssues } as never
    )

    await expect(service.getOptionsDownloadState()).rejects.toThrow(
      "Stored destination issues are invalid"
    )
  })
})
