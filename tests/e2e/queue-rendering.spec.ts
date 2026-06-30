import { test, expect } from './fixtures/extension'
import { getTabId } from './fixtures/state-helpers'
import { buildExampleUrl } from './fixtures/test-domains'
import { makeChapter, makeTask, seedGlobalQueue } from './fixtures/queue-test-helpers'
import type { DownloadTaskState } from '../../src/types/queue-state'

const exampleRootUrl = buildExampleUrl('/')

test.describe('Queue rendering', () => {
  test.describe.configure({ mode: 'serial' })

  test('shows friendly empty state on non-manga tab with no tasks', async ({ context, extensionId, page }) => {
    await page.goto(exampleRootUrl, { waitUntil: 'domcontentloaded' })

    // Ensure globalState has an explicitly empty queue
    await seedGlobalQueue(context, [])

    await getTabId(page, context)
    const sp = await context.newPage()
    await sp.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'domcontentloaded' })

    await expect(sp.locator('#root')).toBeVisible()
    await expect(sp.getByText('No downloads yet')).toBeVisible()
  })

  test('renders projected task cover thumbnails in queue rows', async ({ context, extensionId, page }) => {
    await page.goto(exampleRootUrl, { waitUntil: 'domcontentloaded' })

    const now = Date.now()
    const coverUrl = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="12" height="18" viewBox="0 0 12 18"%3E%3Crect width="12" height="18" fill="%23111827"/%3E%3Crect x="2" y="2" width="8" height="14" fill="%2360a5fa"/%3E%3C/svg%3E'
    const tasks: DownloadTaskState[] = [
      makeTask({
        id: 'covered-task',
        seriesTitle: 'Covered Series',
        status: 'queued',
        created: now - 1000,
        seriesCoverUrl: coverUrl,
        chapters: [makeChapter(buildExampleUrl('/covered-chapter'), 'queued')],
      }),
    ]

    await seedGlobalQueue(context, tasks)

    await getTabId(page, context)
    const sp = await context.newPage()
    await sp.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'domcontentloaded' })

    await expect(sp.locator('#root')).toBeVisible()
    await expect(sp.getByText('Covered Series')).toBeVisible({ timeout: 15000 })
    await expect(sp.locator('img')).toHaveAttribute('src', coverUrl)
  })

  test('renders global queue and header summary for active and queued tasks with recent history', async ({ context, extensionId, page }) => {
    await page.goto(exampleRootUrl, { waitUntil: 'domcontentloaded' })

    const now = Date.now()
    const tasks: DownloadTaskState[] = [
      makeTask({
        id: 'active-task',
        seriesTitle: 'Active Series',
        status: 'downloading',
        created: now - 5000,
        chapters: [makeChapter(buildExampleUrl('/c1'), 'downloading')],
      }),
      makeTask({
        id: 'queued-1',
        seriesTitle: 'Queued One',
        status: 'queued',
        created: now - 4000,
        chapters: [makeChapter(buildExampleUrl('/c2'), 'queued')],
      }),
      makeTask({
        id: 'queued-2',
        seriesTitle: 'Queued Two',
        status: 'queued',
        created: now - 3000,
        chapters: [makeChapter(buildExampleUrl('/c3'), 'queued')],
      }),
      makeTask({
        id: 'completed-1',
        seriesTitle: 'Completed One',
        status: 'completed',
        created: now - 8000,
        completed: now - 7000,
        chapters: [makeChapter(buildExampleUrl('/c4'), 'completed')],
      }),
      makeTask({
        id: 'failed-1',
        seriesTitle: 'Failed One',
        status: 'failed',
        created: now - 9000,
        completed: now - 8500,
        errorMessage: 'Network error',
        chapters: [makeChapter(buildExampleUrl('/c5'), 'failed')],
      }),
    ]

    await seedGlobalQueue(context, tasks)

    await getTabId(page, context)
    const sp = await context.newPage()
    await sp.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'domcontentloaded' })

    await expect(sp.locator('#root')).toBeVisible()
    // Storage subscription hydration can lag behind initial root mount in full-suite runs.
    // Wait for seeded queue content before validating derived header counters.
    await expect(sp.getByText('Active Series')).toBeVisible({ timeout: 15000 })
    // Header uses separate badges: "X active" and "Y queued"
    await expect(sp.getByText(/1\s*active/)).toBeVisible()
    await expect(sp.getByText(/2\s*queued/)).toBeVisible()
    await expect(sp.getByText('Queued One')).toBeVisible()
    await expect(sp.getByText('Queued Two')).toBeVisible()
    await expect(sp.getByText('Recent history')).toBeVisible()
    const recentHistory = sp.getByRole('region', { name: 'Recent history' })
    await expect(recentHistory).toHaveCSS('max-height', 'none')
    await expect(recentHistory).toHaveCSS('flex-shrink', '1')
    await expect(sp.getByText('Failed One')).toBeVisible()
    await expect(sp.getByText('Network error')).toBeVisible()
  })
})
