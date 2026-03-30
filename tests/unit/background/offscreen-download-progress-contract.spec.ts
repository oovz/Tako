import { beforeEach, describe, expect, it, vi } from 'vitest'

import { normalizeActiveTaskProgress } from '@/entrypoints/sidepanel/hooks/useActiveTaskProgress'
import { createTaskSettingsSnapshot } from '@/entrypoints/background/settings-snapshot'
import { DEFAULT_SETTINGS } from '@/src/storage/default-settings'
import { NotificationService } from '@/entrypoints/background/notification-service'
import { OffscreenMessageSchema } from '@/src/runtime/message-schemas'
import type { DownloadTaskState } from '@/src/types/queue-state'

vi.mock('@/src/runtime/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock('@/src/site-integrations/manifest', () => ({
  getSiteIntegrationDisplayName: vi.fn(() => 'MangaDex'),
}))

function makeTask(overrides: Partial<DownloadTaskState> = {}): DownloadTaskState {
  const now = Date.now()
  const siteIntegrationId = overrides.siteIntegrationId ?? 'mangadex'
  return {
    id: overrides.id ?? 'task-1',
    siteIntegrationId,
    mangaId: overrides.mangaId ?? 'mangadex:series-1',
    seriesTitle: overrides.seriesTitle ?? 'Series 1',
    chapters: overrides.chapters ?? [],
    status: overrides.status ?? 'completed',
    created: overrides.created ?? now,
    completed: overrides.completed ?? now,
    settingsSnapshot: overrides.settingsSnapshot ?? createTaskSettingsSnapshot(DEFAULT_SETTINGS, siteIntegrationId),
  }
}

describe('OFFSCREEN_DOWNLOAD_PROGRESS contracts (behavior-based)', () => {
  const notificationsCreate = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()

    vi.stubGlobal('chrome', {
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

  it('normalizes and aggregates concurrent chapter snapshots for active progress display', () => {
    const normalized = normalizeActiveTaskProgress({
      taskId: 'task-1',
      imagesProcessed: 1,
      totalImages: 4,
      activeChapterCount: 1,
      activeChapters: [
        { chapterId: 'ch-1', chapterTitle: 'A', imagesProcessed: 2, totalImages: 8 },
        { chapterId: 'ch-2', chapterTitle: 'B', imagesProcessed: 3, totalImages: 12 },
      ],
      status: 'downloading',
    })

    expect(normalized).toEqual(
      expect.objectContaining({
        activeChapterCount: 2,
        imagesProcessed: 5,
        totalImages: 20,
      }),
    )
  })

  it('rejects non-canonical waiting status in progress message schema', () => {
    const parsed = OffscreenMessageSchema.safeParse({
      type: 'OFFSCREEN_DOWNLOAD_PROGRESS',
      payload: {
        taskId: 'task-1',
        chapterId: 'chapter-1',
        status: 'waiting',
      },
    })

    expect(parsed.success).toBe(false)
  })

  it('dispatches one completion notification call per completion event', () => {
    const service = new NotificationService()
    const task = makeTask({
      chapters: [
        {
          id: 'ch-1',
          url: 'https://example.com/ch-1',
          title: 'Chapter 1',
          index: 1,
          status: 'completed',
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

