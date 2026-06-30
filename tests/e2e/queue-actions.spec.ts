import { test, expect } from './fixtures/extension'
import { waitForGlobalState, getTabId } from './fixtures/state-helpers'
import { MANGADEX_TEST_SERIES_URL, buildExampleUrl } from './fixtures/test-domains'
import { makeChapter, makeTask, seedGlobalQueue, getExtensionWorker } from './fixtures/queue-test-helpers'
import { projectToQueueView } from '@/src/runtime/projection'
import type { DownloadTaskState } from '../../src/types/queue-state'

const exampleRootUrl = buildExampleUrl('/')

test.describe('Queue actions and cross-window behavior', () => {
  test.describe.configure({ mode: 'serial' })

  test('hybrid settings: no advanced config in Side Panel and Options link opens Options page', async ({ context, extensionId, page }) => {
    await page.goto(exampleRootUrl, { waitUntil: 'domcontentloaded' })

    const sp = await context.newPage()
    await sp.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'domcontentloaded' })

    await expect(sp.locator('#root')).toBeVisible()

    // Side Panel must not expose archive format selectors or path/filename template editors
    await expect(sp.getByText(/Directory Path Template/i)).toHaveCount(0)
    await expect(sp.getByText(/Filename Template/i)).toHaveCount(0)
    await expect(sp.getByText(/archive format/i)).toHaveCount(0)
    await expect(sp.getByRole('button', { name: /CBZ|ZIP|No Archive/i })).toHaveCount(0)

    // Options link should be present and route to the Options page for advanced configuration
    const optionsButton = sp.getByRole('button', { name: /Open Options/i })
    await expect(optionsButton).toBeVisible()

    const [optionsPage] = await Promise.all([
      context.waitForEvent('page'),
      optionsButton.click(),
    ])

    await optionsPage.waitForLoadState('domcontentloaded')
    // Options page has "Tako Settings" in sidebar and "General Settings" as main heading
    await expect(optionsPage.getByText('Tako Settings')).toBeVisible({ timeout: 10000 })

    await optionsPage.close()
    await sp.close()
  })

  test('multi-window: queue updates are reflected across windows', async ({ context, extensionId, page }) => {
    await page.goto(exampleRootUrl, { waitUntil: 'domcontentloaded' })

    const now = Date.now()
    const tasks: DownloadTaskState[] = [
      makeTask({
        id: 'multi-window-active',
        seriesTitle: 'Multi Window Active',
        status: 'downloading',
        created: now - 5000,
        chapters: [makeChapter(buildExampleUrl('/mw1'), 'downloading')],
      }),
    ]

    await seedGlobalQueue(context, tasks)

    await getTabId(page, context)

    const worker = await getExtensionWorker(context)

    await worker.evaluate(async (url: string) => {
      await chrome.windows.create({ url, type: 'normal' })
    }, exampleRootUrl)

    const page2 = await context.waitForEvent('page')
    await page2.waitForLoadState('domcontentloaded')
    await getTabId(page2, context)

    const sp1 = await context.newPage()
    await sp1.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'domcontentloaded' })

    const sp2 = await context.newPage()
    await sp2.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'domcontentloaded' })

    await expect(sp1.locator('#root')).toBeVisible()
    await expect(sp2.locator('#root')).toBeVisible()

    // Header uses separate badges: "X active" and "Y queued"
    await expect(sp1.getByText(/1\s*active/)).toBeVisible()
    await expect(sp1.getByText(/0\s*queued/)).toBeVisible()
    await expect(sp2.getByText(/1\s*active/)).toBeVisible()
    await expect(sp2.getByText(/0\s*queued/)).toBeVisible()

    await sp1.getByRole('button', { name: 'Cancel' }).click()
    await expect(sp1.getByText('Cancel this download?')).toBeVisible()
    await sp1.getByRole('button', { name: 'Yes' }).click()

    await waitForGlobalState(context, (state) => {
      const t = state.downloadQueue.find((task) => task.id === 'multi-window-active')
      return !!t && t.status === 'canceled'
    })

    await expect(sp1.getByText(/0\s*active/)).toBeVisible()
    await expect(sp2.getByText(/0\s*active/)).toBeVisible()

    await sp1.close()
    await sp2.close()
    await page2.close()
  })

  test('single active task is visible consistently across tabs', async ({ context, extensionId, page }) => {
    await page.goto(exampleRootUrl, { waitUntil: 'domcontentloaded' })

    const now = Date.now()
    const tasks: DownloadTaskState[] = [
      makeTask({
        id: 'active-task-multi',
        seriesTitle: 'Active Series Multi',
        status: 'downloading',
        created: now - 5000,
        chapters: [makeChapter(buildExampleUrl('/mc1'), 'downloading')],
      }),
      makeTask({
        id: 'queued-1-multi',
        seriesTitle: 'Queued One Multi',
        status: 'queued',
        created: now - 4000,
        chapters: [makeChapter(buildExampleUrl('/mc2'), 'queued')],
      }),
      makeTask({
        id: 'queued-2-multi',
        seriesTitle: 'Queued Two Multi',
        status: 'queued',
        created: now - 3000,
        chapters: [makeChapter(buildExampleUrl('/mc3'), 'queued')],
      }),
    ]

    await seedGlobalQueue(context, tasks)

    await getTabId(page, context)

    const seriesPage = await context.newPage()
    await seriesPage.goto(MANGADEX_TEST_SERIES_URL, {
      waitUntil: 'domcontentloaded',
    })
    await getTabId(seriesPage, context)

    const spNonManga = await context.newPage()
    await spNonManga.goto(`chrome-extension://${extensionId}/sidepanel.html`, {
      waitUntil: 'domcontentloaded',
    })

    const spSeries = await context.newPage()
    await spSeries.goto(`chrome-extension://${extensionId}/sidepanel.html`, {
      waitUntil: 'domcontentloaded',
    })

    await expect(spNonManga.locator('#root')).toBeVisible()
    await expect(spSeries.locator('#root')).toBeVisible()

    // Header uses separate badges: "X active" and "Y queued"
    await expect(spNonManga.getByText(/1\s*active/)).toBeVisible()
    await expect(spNonManga.getByText(/2\s*queued/)).toBeVisible()
    await expect(spSeries.getByText(/1\s*active/)).toBeVisible()
    await expect(spSeries.getByText(/2\s*queued/)).toBeVisible()

    await expect(spNonManga.getByText('Active Series Multi')).toBeVisible()
    await expect(spSeries.getByText('Active Series Multi')).toBeVisible()

    await spNonManga.close()
    await spSeries.close()
    await seriesPage.close()
  })

  test.describe('unlimited queue behavior', () => {
    test('allows more than 5 tasks in queue without capacity error', async ({ context, extensionId, page }) => {
      await page.goto(exampleRootUrl, { waitUntil: 'domcontentloaded' })

      const now = Date.now()
      // Create 10 non-terminal tasks (1 active + 9 queued) to verify the queue no longer enforces
      // the historical 5-task capacity limit while avoiding auto-resume of synthetic queued tasks.
      const tasks: DownloadTaskState[] = Array.from({ length: 10 }, (_, i) =>
        makeTask({
          id: `task-${i}`,
          seriesTitle: `Series ${i + 1}`,
          status: i === 0 ? 'downloading' : 'queued',
          created: now - (10 - i) * 1000,
          chapters: [makeChapter(buildExampleUrl(`/unlimited-${i}`), i === 0 ? 'downloading' : 'queued')],
        })
      )

      await seedGlobalQueue(context, tasks)

      await getTabId(page, context)
      const sp = await context.newPage()
      await sp.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'domcontentloaded' })

      await expect(sp.locator('#root')).toBeVisible()
      const state = await waitForGlobalState(context, (globalState) => {
        const seededTasks = globalState.downloadQueue
        const failedCapacityTask = globalState.downloadQueue.find(
          (task) => task.status === 'failed' && task.errorMessage?.toLowerCase().includes('capacity'),
        )

        return seededTasks.length === 10 && !failedCapacityTask
      })

      const projection = projectToQueueView(state.downloadQueue)
      expect(projection.nonTerminalCount).toBe(10)

      await expect(sp.getByRole('heading', { name: 'Series 1', exact: true })).toBeVisible({ timeout: 15000 })

      await expect(sp.getByText(/\d+\s*active/)).toBeVisible()
      await expect(sp.getByText(/\d+\s*queued/)).toBeVisible()

      await sp.close()
    })
  })

  test.describe('open-folder action visibility in side panel', () => {
    test('Side Panel does not render Open Folder action for any task state', async ({ context, extensionId, page }) => {
      await page.goto(exampleRootUrl, { waitUntil: 'domcontentloaded' })

      const now = Date.now()
      const tasks: DownloadTaskState[] = [
        makeTask({
          id: 'active-no-folder',
          seriesTitle: 'Active No Folder',
          status: 'downloading',
          created: now - 5000,
          chapters: [makeChapter(buildExampleUrl('/anf1'), 'downloading')],
        }),
        makeTask({
          id: 'completed-with-folder',
          seriesTitle: 'Completed With Folder',
          status: 'completed',
          created: now - 10000,
          completed: now - 8000,
          lastSuccessfulDownloadId: 12345,
          chapters: [makeChapter(buildExampleUrl('/cwf1'), 'completed')],
        }),
      ]

      await seedGlobalQueue(context, tasks)

      await getTabId(page, context)
      const sp = await context.newPage()
      await sp.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'domcontentloaded' })

      await expect(sp.locator('#root')).toBeVisible()
      await expect(sp.getByText('Active No Folder')).toBeVisible()
      await expect(sp.getByText('Completed With Folder')).toBeVisible()
      await expect(sp.getByText('Recent history')).toBeVisible()
      await expect(sp.getByRole('button', { name: /open folder/i })).toHaveCount(0)

      await sp.close()
    })
  })

  test.describe('extension-update failure messaging', () => {
    test('shows extension update error message in failed task', async ({ context, extensionId, page }) => {
      await page.goto(exampleRootUrl, { waitUntil: 'domcontentloaded' })

      const now = Date.now()
      const tasks: DownloadTaskState[] = [
        makeTask({
          id: 'update-failed-task',
          seriesTitle: 'Update Failed Series',
          status: 'failed',
          created: now - 10000,
          completed: now - 5000,
          errorMessage: 'Extension updated during download',
          chapters: [makeChapter(buildExampleUrl('/uf1'), 'failed')],
        }),
      ]

      await seedGlobalQueue(context, tasks)

      await getTabId(page, context)
      const sp = await context.newPage()
      await sp.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'domcontentloaded' })

      await expect(sp.locator('#root')).toBeVisible()
      await expect(sp.getByText('Update Failed Series')).toBeVisible({ timeout: 10000 })
      await expect(sp.getByText(/Extension updated during download/i)).toBeVisible({ timeout: 5000 })

      await sp.close()
    })
  })
})
