import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationService } from '@/entrypoints/background/notification-service'

interface ChromeNotificationsMock {
  create: ReturnType<typeof vi.fn>
  clear: ReturnType<typeof vi.fn>
  onButtonClicked: { addListener: ReturnType<typeof vi.fn> }
  onClicked: { addListener: ReturnType<typeof vi.fn> }
  onClosed: { addListener: ReturnType<typeof vi.fn> }
}

describe('NotificationService icon usage', () => {
  let notifications: ChromeNotificationsMock
  let getUrl: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    notifications = {
      create: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(true),
      onButtonClicked: { addListener: vi.fn() },
      onClicked: { addListener: vi.fn() },
      onClosed: { addListener: vi.fn() },
    }

    getUrl = vi.fn().mockImplementation((path: string) => `chrome-extension://test/${path}`)

    ;(globalThis as any).chrome = {
      runtime: {
        getURL: getUrl,
      },
      notifications,
      downloads: {
        showDefaultFolder: vi.fn().mockResolvedValue(undefined),
      },
    }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('uses extension icon for download complete notifications', async () => {
    const svc = new NotificationService()

    const data = {
      seriesTitle: 'Test Series',
      chaptersCompleted: 3,
      chaptersTotal: 3,
      taskId: 'task-1',
      downloadPath: undefined,
    };

    await svc.showDownloadCompleteNotification(data)

    expect(notifications.create).toHaveBeenCalled()
    const [, options] = notifications.create.mock.calls[0] as [string, chrome.notifications.NotificationOptions<true>]
    expect(options.iconUrl).toBe('chrome-extension://test/icon/128.png')

    await vi.advanceTimersByTimeAsync(10_000)
    expect(notifications.clear).not.toHaveBeenCalled()
  })

  it('uses extension icon for download error notifications', async () => {
    const svc = new NotificationService()

    await svc.showDownloadErrorNotification({
      seriesTitle: 'Test Series',
      errorMessage: 'Network error',
      taskId: 'task-2',
      chaptersFailed: 1,
      chaptersTotal: 5,
    })

    const [, options] = notifications.create.mock.calls[0] as [string, chrome.notifications.NotificationOptions<true>]
    expect(options.iconUrl).toBe('chrome-extension://test/icon/128.png')
  })

  it('uses extension icon for chapter complete notifications', async () => {
    const svc = new NotificationService()

    await svc.showChapterCompleteNotification({
      seriesTitle: 'Test Series',
      chapterTitle: 'Ch. 1',
      chapterNumber: 1,
      totalChapters: 10,
    })

    const [, options] = notifications.create.mock.calls[0] as [string, chrome.notifications.NotificationOptions<true>]
    expect(options.iconUrl).toBe('chrome-extension://test/icon/128.png')

    await vi.advanceTimersByTimeAsync(5_000)
    expect(notifications.clear).not.toHaveBeenCalled()
  })

  it('showNotification falls back to extension icon when none provided', async () => {
    const svc = new NotificationService()

    await svc.showNotification('test-generic', {
      title: 'Hello',
      message: 'World',
    })

    const [, options] = notifications.create.mock.calls[0] as [string, chrome.notifications.NotificationOptions<true>]
    expect(options.iconUrl).toBe('chrome-extension://test/icon/128.png')
  })
})

