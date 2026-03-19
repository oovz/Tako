import { test, expect } from '../fixtures/extension'
import { ensureOffscreenAliveForActiveQueue, setLocalState, setSessionState } from '../fixtures/state-helpers'
import { createTaskSettingsSnapshot } from '../../../entrypoints/background/settings-snapshot'
import { DEFAULT_SETTINGS } from '../../../src/storage/default-settings'
import type { DownloadTaskState } from '../../../src/types/queue-state'
import type { ChapterState } from '../../../src/types/tab-state'

function makeChapter(id: string, status: ChapterState['status']): ChapterState {
  return {
    id,
    url: `https://example.com/${id}`,
    title: `Chapter ${id}`,
    index: 1,
    status,
    progress: status === 'queued' ? 0 : 100,
    lastUpdated: Date.now(),
  }
}

function makeTask(id: string, status: DownloadTaskState['status']): DownloadTaskState {
  const now = Date.now()
  return {
    id,
    siteIntegrationId: 'mangadex',
    mangaId: `series-${id}`,
    seriesTitle: `Series ${id}`,
    chapters: [makeChapter(id, status === 'queued' ? 'queued' : status === 'downloading' ? 'downloading' : 'completed')],
    status,
    created: now,
    completed: status === 'queued' || status === 'downloading' ? undefined : now,
    settingsSnapshot: createTaskSettingsSnapshot(DEFAULT_SETTINGS, 'mangadex'),
  }
}

test.describe('Options Downloads history management', () => {
  async function seedQueueState(
    page: import('@playwright/test').Page,
    queue: DownloadTaskState[],
  ): Promise<void> {
    if (queue.some((task) => task.status === 'downloading')) {
      await ensureOffscreenAliveForActiveQueue(page.context())
    }

    const now = Date.now()
    const existingGlobalState = await page.evaluate(async () => {
      return (await chrome.storage.session.get('global_state')) as {
        global_state?: {
          settings?: unknown
          lastActivity?: number
        }
      }
    })

    const globalState = existingGlobalState.global_state
    const seededSettings =
      globalState && typeof globalState.settings === 'object' && globalState.settings !== null
        ? globalState.settings
        : {}

    await setLocalState(page.context(), 'downloadQueue', queue)
    await setSessionState(page.context(), 'global_state', {
      downloadQueue: queue,
      settings: seededSettings,
      lastActivity: globalState?.lastActivity ?? now,
    })
    await setSessionState(page.context(), 'lastOffscreenActivity', now)
    await page.waitForTimeout(150)
  }

  test('clear all history removes only terminal tasks and keeps active/queued', async ({ page, extensionId }) => {
    const seededQueue: DownloadTaskState[] = [
      makeTask('active', 'downloading'),
      makeTask('queued', 'queued'),
      makeTask('done', 'completed'),
      makeTask('partial', 'partial_success'),
      makeTask('failed', 'failed'),
      makeTask('canceled', 'canceled'),
    ]

    await page.goto(`chrome-extension://${extensionId}/options.html?tab=downloads`, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('#root')).toBeVisible({ timeout: 10000 })

    await seedQueueState(page, seededQueue)

    await page.getByRole('button', { name: 'Downloads' }).click()

    await expect(page.getByText('Series done')).toBeVisible()
    await expect(page.getByText('Series failed')).toBeVisible()
    await expect(page.getByText('Series active')).toBeVisible()

    await page.getByRole('button', { name: 'Clear All History' }).click()
    await page.getByRole('button', { name: 'Yes, Clear All' }).click()

    await expect(page.getByText('Series done')).toHaveCount(0)
    await expect(page.getByText('Series failed')).toHaveCount(0)
    await expect(page.getByText('Series partial')).toHaveCount(0)
    await expect(page.getByText('Series canceled')).toHaveCount(0)

    await expect(page.getByText('Series active')).toBeVisible()
    await expect(page.getByText('Series queued')).toBeVisible()

    const remainingStatuses = await page.evaluate(async () => {
      const result = await chrome.storage.local.get('downloadQueue')
      const queue = (result.downloadQueue ?? []) as Array<{ status: string }>
      return queue.map((task) => task.status)
    })

    expect(remainingStatuses).toEqual(['downloading', 'queued'])
  })

  test('rejects CLEAR_ALL_HISTORY from sidepanel sender context', async ({ page, extensionId }) => {
    const seededQueue: DownloadTaskState[] = [
      makeTask('active', 'downloading'),
      makeTask('done', 'completed'),
    ]

    await page.goto(`chrome-extension://${extensionId}/options.html?tab=downloads`, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('#root')).toBeVisible({ timeout: 10000 })
    await seedQueueState(page, seededQueue)

    const sidepanelPage = await page.context().newPage()
    await sidepanelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'domcontentloaded' })

    const clearResult = await sidepanelPage.evaluate(async () => {
      return await chrome.runtime.sendMessage({ type: 'CLEAR_ALL_HISTORY', payload: {} }) as {
        success?: boolean
        error?: string
      }
    })

    await sidepanelPage.close()

    expect(clearResult.success).toBe(false)
    expect(clearResult.error).toContain('only available from Options page')

    const remainingStatuses = await page.evaluate(async () => {
      const result = await chrome.storage.local.get('downloadQueue')
      const queue = (result.downloadQueue ?? []) as Array<{ status: string }>
      return queue.map((task) => task.status)
    })

    expect(remainingStatuses).toEqual(['downloading', 'completed'])
  })
})

