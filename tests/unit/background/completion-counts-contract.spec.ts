import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createTaskSettingsSnapshot } from '@/entrypoints/background/settings-snapshot'
import { NotificationManager } from '@/entrypoints/background/notification-manager'
import { DEFAULT_SETTINGS } from '@/src/storage/default-settings'
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

describe('completion notification chapter counts', () => {
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

  it('falls back to total chapter count when completed count is zero', () => {
    const task = makeTask({
      chapters: [
        {
          id: 'ch-1',
          url: 'https://example.com/ch-1',
          title: 'Chapter 1',
          index: 1,
          status: 'failed',
          lastUpdated: Date.now(),
        },
        {
          id: 'ch-2',
          url: 'https://example.com/ch-2',
          title: 'Chapter 2',
          index: 2,
          status: 'failed',
          lastUpdated: Date.now(),
        },
      ],
    })

    const manager = new NotificationManager()
    manager.notifyTaskCompleted({ task, notificationsEnabled: true })

    expect(notificationsCreate).toHaveBeenCalledWith(
      `task_complete_${task.id}`,
      expect.objectContaining({
        message: `${task.seriesTitle}: 2/2 chapters saved`,
      }),
    )
  })
})

