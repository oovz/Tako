import { beforeEach, describe, expect, it, vi } from "vitest"

import { normalizeActiveTaskProgress } from "@/entrypoints/sidepanel/hooks/useActiveTaskProgress"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import { NotificationService } from "@/entrypoints/background/notification-service"
import { runtimeMessageRegistry } from "@/src/runtime/runtime-message-contracts"
import type { DownloadTaskState } from "@/src/domain/queue/state"

vi.mock("@/src/runtime/logger", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock("@/src/site-integrations/catalog", () => ({
  getDisplayName: vi.fn(() => "MangaDex"),
}))

function makeTask(
  overrides: Partial<DownloadTaskState> = {}
): DownloadTaskState {
  const now = Date.now()
  const siteIntegrationId = overrides.siteIntegrationId ?? "mangadex"
  return {
    id: overrides.id ?? "task-1",
    siteIntegrationId,
    mangaId: overrides.mangaId ?? "mangadex:series-1",
    seriesTitle: overrides.seriesTitle ?? "Series 1",
    chapters: overrides.chapters ?? [],
    status: overrides.status ?? "completed",
    created: overrides.created ?? now,
    completed: overrides.completed ?? now,
    settingsSnapshot:
      overrides.settingsSnapshot ??
      createTaskSettingsSnapshot(DEFAULT_SETTINGS, siteIntegrationId),
  }
}

describe("OFFSCREEN_DOWNLOAD_PROGRESS contracts (behavior-based)", () => {
  const notificationsCreate = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()

    vi.stubGlobal("chrome", {
      runtime: {
        getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
      },
      downloads: {
        show: vi.fn(),
      },
      notifications: {
        create: notificationsCreate,
        clear: vi.fn(),
        onClicked: { addListener: vi.fn() },
        onClosed: { addListener: vi.fn() },
      },
    })
  })

  it("accepts the current aggregate progress projection without synthesizing fields", () => {
    const projection = {
      generation: "generation-1",
      revision: 1,
      updatedAt: 100,
      taskId: "task-1",
      imagesProcessed: 5,
      totalImages: 20,
      activeChapterCount: 2,
      activeChapters: [
        {
          chapterId: "ch-1",
          chapterTitle: "A",
          imagesProcessed: 2,
          totalImages: 8,
          stage: "downloading",
          phaseFraction: 0.25,
          updatedAt: 99,
        },
        {
          chapterId: "ch-2",
          chapterTitle: "B",
          imagesProcessed: 3,
          totalImages: 12,
          stage: "downloading",
          phaseFraction: 0.25,
          updatedAt: 100,
        },
      ],
      stage: "downloading",
      phaseFraction: 0.25,
      outputCommitted: false,
      status: "downloading",
    } as const

    expect(normalizeActiveTaskProgress(projection)).toEqual(projection)
  })

  it("rejects non-canonical waiting status in progress message schema", () => {
    const parsed =
      runtimeMessageRegistry.OFFSCREEN_DOWNLOAD_PROGRESS.request.safeParse({
        target: "background",
        type: "OFFSCREEN_DOWNLOAD_PROGRESS",
        payload: {
          jobId: "job-1",
          attempt: 1,
          taskId: "task-1",
          chapterId: "chapter-1",
          sequence: 1,
          stage: "downloading",
          status: "waiting",
        },
      })

    expect(parsed.success).toBe(false)
  })

  it("dispatches one completion notification call per completion event", () => {
    const service = new NotificationService()
    const task = makeTask({
      chapters: [
        {
          id: "ch-1",
          url: "https://example.com/ch-1",
          title: "Chapter 1",
          index: 1,
          status: "completed",
          lastUpdated: Date.now(),
        },
      ],
    })

    service.showDownloadCompleteNotification({
      task,
      notificationsEnabled: true,
      chaptersCompleted: 1,
      chaptersTotal: 1,
    })

    expect(notificationsCreate).toHaveBeenCalledTimes(1)
  })
})
