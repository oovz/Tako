import { test, expect } from './fixtures/extension'
import { ensureOffscreenAliveForActiveQueue, setLocalState, setSessionState } from './fixtures/state-helpers'
import { createTaskSettingsSnapshot } from '../../entrypoints/background/settings-snapshot'
import { DEFAULT_SETTINGS } from '../../src/storage/default-settings'
import type { DownloadTaskState } from '../../src/types/queue-state'
import type { ChapterState } from '../../src/types/tab-state'

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

function makeTask(
  id: string,
  status: DownloadTaskState['status'],
  overrides: Partial<DownloadTaskState> = {},
): DownloadTaskState {
  const now = Date.now()
  const siteIntegrationId = overrides.siteIntegrationId ?? 'mangadex'
  return {
    id,
    siteIntegrationId,
    mangaId: overrides.mangaId ?? `series-${id}`,
    seriesTitle: overrides.seriesTitle ?? `Series ${id}`,
    chapters: overrides.chapters ?? [
      makeChapter(
        id,
        status === 'queued' ? 'queued' : status === 'downloading' ? 'downloading' : 'completed',
      ),
    ],
    status,
    created: overrides.created ?? now,
    completed:
      overrides.completed ?? (status === 'queued' || status === 'downloading' ? undefined : now),
    settingsSnapshot: overrides.settingsSnapshot ?? createTaskSettingsSnapshot(DEFAULT_SETTINGS, siteIntegrationId),
    ...overrides,
  }
}

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

test.describe('Spec options coverage', () => {
  test.describe.configure({ mode: 'serial' })

  test('Downloads tab mirrors inline cancel confirmation for active and queued tasks', async ({ page, extensionId }) => {
    const seededQueue: DownloadTaskState[] = [
      makeTask('active-spec-options', 'downloading', {
        seriesTitle: 'Active Spec Options',
      }),
      makeTask('queued-spec-options', 'queued', {
        seriesTitle: 'Queued Spec Options',
      }),
    ]

    await page.goto(`chrome-extension://${extensionId}/options.html?tab=downloads`, {
      waitUntil: 'domcontentloaded',
    })
    await expect(page.locator('#root')).toBeVisible({ timeout: 10000 })
    await seedQueueState(page, seededQueue)

    await expect(page.getByText('Active Spec Options')).toBeVisible()
    await expect(page.getByText('Queued Spec Options')).toBeVisible()

    await page.getByRole('button', { name: 'Cancel' }).first().click()
    await expect(page.getByText('Cancel this download?')).toBeVisible()
    await page.getByRole('button', { name: 'No' }).click()
    await expect(page.getByText('Cancel this download?')).toHaveCount(0)

    await page.getByRole('button', { name: 'Cancel' }).nth(1).click()
    await expect(page.getByText('Cancel this download?')).toBeVisible()
    await page.getByRole('button', { name: 'Yes' }).click()

    await expect.poll(async () => {
      const result = await page.evaluate(async () => {
        const queue = ((await chrome.storage.local.get('downloadQueue')).downloadQueue ?? []) as Array<{
          id: string
          status: string
        }>
        return queue.find((task) => task.id === 'queued-spec-options')?.status ?? null
      })
      return result
    }).toBe('canceled')
  })

  test('Downloads tab shows retried badge and terminal timestamp labels for restarted tasks', async ({ page, extensionId }) => {
    const now = Date.now()
    const seededQueue: DownloadTaskState[] = [
      makeTask('retried-canceled-options', 'canceled', {
        seriesTitle: 'Retried Canceled Options',
        created: now - 5000,
        completed: now - 1000,
        isRetried: true,
      }),
      makeTask('retried-failed-options', 'failed', {
        seriesTitle: 'Retried Failed Options',
        created: now - 7000,
        completed: now - 2000,
        isRetried: true,
        errorMessage: 'Network error',
      }),
    ]

    await page.goto(`chrome-extension://${extensionId}/options.html?tab=downloads`, {
      waitUntil: 'domcontentloaded',
    })
    await expect(page.locator('#root')).toBeVisible({ timeout: 10000 })
    await seedQueueState(page, seededQueue)

    await expect.poll(async () => {
      return await page.evaluate(async () => {
        const result = (await chrome.storage.local.get('downloadQueue')) as {
          downloadQueue?: Array<{ seriesTitle?: string; isRetried?: boolean }>
        }
        return result.downloadQueue?.filter((task) => task.isRetried).map((task) => task.seriesTitle).sort() ?? []
      })
    }).toEqual(['Retried Canceled Options', 'Retried Failed Options'])

    await expect(page.getByText('Retried Canceled Options')).toBeVisible({ timeout: 15000 })
    await expect(page.getByText('Retried Failed Options')).toBeVisible({ timeout: 15000 })
    await expect(page.getByText(/^retried$/i)).toHaveCount(2)
    await expect(page.getByText(/Canceled at/i)).toBeVisible()
    await expect(page.getByText(/Failed at/i)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Restart' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Retry failed chapters' })).toHaveCount(0)
  })

  test('Site Integrations tab renders integrations and search filters the list', async ({ page, extensionId }) => {
    await page.goto(`chrome-extension://${extensionId}/options.html?tab=integrations`, {
      waitUntil: 'domcontentloaded',
    })
    await expect(page.locator('#root')).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('button', { name: 'Site Integrations' })).toBeVisible()

    const searchInput = page.getByPlaceholder('Search site integrations by name or domain...')
    await expect(searchInput).toBeVisible()
    await expect
      .poll(async () => await page.locator('[data-testid^="site-integration-card-"]').count())
      .toBeGreaterThan(0)

    await searchInput.fill('mangadex')
    await expect(page.locator('[data-testid="site-integration-card-mangadex"]')).toBeVisible()

    await searchInput.fill('definitely-no-such-integration')
    await expect(page.getByText('No integrations found')).toBeVisible()
  })

  test('About / Debug tab persists log level changes', async ({ page, extensionId }) => {
    await page.goto(`chrome-extension://${extensionId}/options.html?tab=debug`, {
      waitUntil: 'domcontentloaded',
    })
    await expect(page.locator('#root')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Debug Settings')).toBeVisible()

    await page.getByTestId('log-level-select').click()
    await page.getByRole('option', { name: 'Debug' }).click()
    await page.getByRole('button', { name: 'Save Changes' }).click()

    await expect.poll(async () => {
      return await page.evaluate(async () => {
        const result = (await chrome.storage.local.get('settings:global')) as {
          settings?: { advanced?: { logLevel?: string } }
          'settings:global'?: { advanced?: { logLevel?: string } }
        }
        return result['settings:global']?.advanced?.logLevel ?? null
      })
    }).toBe('debug')

    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('button', { name: 'About / Debug' })).toBeVisible()
    await expect(page.getByText('Debug Settings')).toBeVisible()
    await expect(page.getByTestId('log-level-select')).toContainText('Debug')
  })
})


