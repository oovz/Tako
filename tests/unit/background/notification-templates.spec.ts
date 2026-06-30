import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createTaskSettingsSnapshot } from '@/src/runtime/settings-snapshot'
import { NotificationService } from '@/entrypoints/background/notification-service'
import { DEFAULT_SETTINGS } from '@/src/storage/default-settings'
import type { DownloadTaskState, TaskChapter } from '@/src/types/queue-state'

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

function makeChapter(overrides: Partial<TaskChapter> = {}): TaskChapter {
  return {
    id: overrides.id ?? 'ch-1',
    url: overrides.url ?? 'https://example.com/ch-1',
    title: overrides.title ?? 'Chapter 1',
    index: overrides.index ?? 1,
    status: overrides.status ?? 'completed',
    lastUpdated: overrides.lastUpdated ?? Date.now(),
  }
}

function makeTask(overrides: Partial<DownloadTaskState> = {}): DownloadTaskState {
  const now = Date.now()
  const siteIntegrationId = overrides.siteIntegrationId ?? 'mangadex'
  return {
    id: overrides.id ?? 'task-1',
    siteIntegrationId,
    mangaId: overrides.mangaId ?? 'mangadex:series-1',
    seriesTitle: overrides.seriesTitle ?? 'Test Series',
    chapters: overrides.chapters ?? [makeChapter()],
    status: overrides.status ?? 'completed',
    created: overrides.created ?? now,
    completed: overrides.completed ?? now,
    settingsSnapshot: overrides.settingsSnapshot ?? createTaskSettingsSnapshot(DEFAULT_SETTINGS, siteIntegrationId),
  }
}

describe('notification content templates', () => {
  const notificationsCreate = vi.fn()
  const onClickedAddListener = vi.fn()
  const onClosedAddListener = vi.fn()
  const runtimeGetUrl = vi.fn((path: string) => `chrome-extension://test/${path}`)

  beforeEach(() => {
    vi.clearAllMocks()

    vi.stubGlobal('chrome', {
      runtime: { getURL: runtimeGetUrl },
      storage: {
        local: { get: vi.fn().mockResolvedValue({ downloadQueue: [] }) },
      },
      downloads: { show: vi.fn() },
      notifications: {
        create: notificationsCreate,
        clear: vi.fn(),
        onClicked: { addListener: onClickedAddListener },
        onClosed: { addListener: onClosedAddListener },
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('completed task notification', () => {
    it('uses title "Download complete" with series title and chapter count', () => {
      const service = new NotificationService()
      const task = makeTask({
        seriesTitle: 'Kemutai Hanashi',
        chapters: [
          makeChapter({ id: 'ch-1', status: 'completed' }),
          makeChapter({ id: 'ch-2', status: 'completed' }),
          makeChapter({ id: 'ch-3', status: 'completed' }),
        ],
      })

      service.notifyTaskCompleted({ task, notificationsEnabled: true, chaptersCompleted: 3, chaptersTotal: 3 })

      expect(notificationsCreate).toHaveBeenCalledTimes(1)
      const [, notificationOptions] = notificationsCreate.mock.calls[0]
      expect(notificationOptions.type).toBe('basic')
      expect(notificationOptions.iconUrl).toBe('chrome-extension://test/icon/128.png')
      expect(notificationOptions.title).toBe('Download complete')
      expect(notificationOptions.message).toContain('Kemutai Hanashi')
      expect(notificationOptions.message).toContain('3')
      expect(notificationOptions.requireInteraction).toBe(false)
    })

    it('sets contextMessage to site integration display name', () => {
      const service = new NotificationService()
      const task = makeTask({ siteIntegrationId: 'mangadex' })

      service.notifyTaskCompleted({ task, notificationsEnabled: true, chaptersCompleted: 1, chaptersTotal: 1 })

      const [, options] = notificationsCreate.mock.calls[0]
      expect(options.contextMessage).toBe('MangaDex')
    })
  })

  describe('partial_success task notification', () => {
    it('uses title "Download partially complete" with failure counts', () => {
      const service = new NotificationService()
      const task = makeTask({
        seriesTitle: 'Mixed Series',
        status: 'partial_success',
        chapters: [
          makeChapter({ id: 'ch-1', status: 'completed' }),
          makeChapter({ id: 'ch-2', status: 'completed' }),
          makeChapter({ id: 'ch-3', status: 'failed' }),
        ],
      })

      service.notifyTaskFailed({ task, notificationsEnabled: true })

      expect(notificationsCreate).toHaveBeenCalledTimes(1)
      const [, options] = notificationsCreate.mock.calls[0]
      expect(options.title).toBe('Download partially complete')
      expect(options.message).toContain('Mixed Series')
      expect(options.message).toContain('1')
      expect(options.message).toContain('3')
      expect(options.requireInteraction).toBe(false)
    })
  })

  describe('failed task notification', () => {
    it('uses title "Download failed" with failure counts', () => {
      const service = new NotificationService()
      const task = makeTask({
        seriesTitle: 'Failed Series',
        status: 'failed',
        errorMessage: 'Network timeout',
        chapters: [
          makeChapter({ id: 'ch-1', status: 'failed' }),
          makeChapter({ id: 'ch-2', status: 'failed' }),
        ],
      })

      service.notifyTaskFailed({ task, notificationsEnabled: true, errorMessage: 'Network timeout' })

      expect(notificationsCreate).toHaveBeenCalledTimes(1)
      const [, options] = notificationsCreate.mock.calls[0]
      expect(options.title).toBe('Download failed')
      expect(options.message).toContain('Failed Series')
      expect(options.requireInteraction).toBe(false)
    })
  })

  describe('canceled task notification', () => {
    it('notifyTaskCompleted does not filter by task status — caller must not call it for canceled tasks', () => {
      const service = new NotificationService()
      const task = makeTask({
        status: 'canceled',
        seriesTitle: 'Canceled Series',
      })

      service.notifyTaskCompleted({ task, notificationsEnabled: true, chaptersCompleted: 0, chaptersTotal: 5 })

      expect(notificationsCreate).toHaveBeenCalledTimes(1)
      const [, options] = notificationsCreate.mock.calls[0]
      expect(options.title).toBe('Download complete')
      expect(options.message).toContain('Canceled Series')
    })

    it('notifyTaskFailed does not fire for canceled tasks when notifications are disabled', () => {
      const service = new NotificationService()
      const task = makeTask({ status: 'canceled' })

      service.notifyTaskFailed({ task, notificationsEnabled: false })

      expect(notificationsCreate).not.toHaveBeenCalled()
    })
  })

  describe('notifications disabled', () => {
    it('does not fire completed notification when notifications are disabled', () => {
      const service = new NotificationService()
      const task = makeTask({ status: 'completed' })

      service.notifyTaskCompleted({ task, notificationsEnabled: false })

      expect(notificationsCreate).not.toHaveBeenCalled()
    })

    it('does not fire failed notification when notifications are disabled', () => {
      const service = new NotificationService()
      const task = makeTask({ status: 'failed' })

      service.notifyTaskFailed({ task, notificationsEnabled: false })

      expect(notificationsCreate).not.toHaveBeenCalled()
    })
  })

  describe('all notifications use iconUrl from runtime.getURL', () => {
    it('completed notification sets iconUrl to chrome.runtime.getURL("icon/128.png")', () => {
      const service = new NotificationService()
      const task = makeTask()

      service.notifyTaskCompleted({ task, notificationsEnabled: true, chaptersCompleted: 1, chaptersTotal: 1 })

      expect(runtimeGetUrl).toHaveBeenCalledWith('icon/128.png')
      const [, options] = notificationsCreate.mock.calls[0]
      expect(options.iconUrl).toBe('chrome-extension://test/icon/128.png')
    })

    it('failed notification sets iconUrl to chrome.runtime.getURL("icon/128.png")', () => {
      const service = new NotificationService()
      const task = makeTask({ status: 'failed' })

      service.notifyTaskFailed({ task, notificationsEnabled: true })

      expect(runtimeGetUrl).toHaveBeenCalledWith('icon/128.png')
      const [, options] = notificationsCreate.mock.calls[0]
      expect(options.iconUrl).toBe('chrome-extension://test/icon/128.png')
    })

    it('partial_success notification sets iconUrl to chrome.runtime.getURL("icon/128.png")', () => {
      const service = new NotificationService()
      const task = makeTask({ status: 'partial_success' })

      service.notifyTaskFailed({ task, notificationsEnabled: true })

      expect(runtimeGetUrl).toHaveBeenCalledWith('icon/128.png')
      const [, options] = notificationsCreate.mock.calls[0]
      expect(options.iconUrl).toBe('chrome-extension://test/icon/128.png')
    })
  })

  describe('all notifications use type "basic"', () => {
    it('completed notification uses type basic', () => {
      const service = new NotificationService()
      service.notifyTaskCompleted({ task: makeTask(), notificationsEnabled: true, chaptersCompleted: 1, chaptersTotal: 1 })

      expect(notificationsCreate.mock.calls[0][1].type).toBe('basic')
    })

    it('failed notification uses type basic', () => {
      const service = new NotificationService()
      service.notifyTaskFailed({ task: makeTask({ status: 'failed' }), notificationsEnabled: true })

      expect(notificationsCreate.mock.calls[0][1].type).toBe('basic')
    })
  })

  describe('requireInteraction is false for all download notifications', () => {
    it('completed notification has requireInteraction false', () => {
      const service = new NotificationService()
      service.notifyTaskCompleted({ task: makeTask(), notificationsEnabled: true, chaptersCompleted: 1, chaptersTotal: 1 })

      expect(notificationsCreate.mock.calls[0][1].requireInteraction).toBe(false)
    })

    it('failed notification has requireInteraction false', () => {
      const service = new NotificationService()
      service.notifyTaskFailed({ task: makeTask({ status: 'failed' }), notificationsEnabled: true })

      expect(notificationsCreate.mock.calls[0][1].requireInteraction).toBe(false)
    })
  })
})
