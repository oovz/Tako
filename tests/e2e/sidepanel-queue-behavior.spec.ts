import { test, expect } from './fixtures/extension'
import {
  getSessionState,
  getTabId,
  openSidepanelHarness,
  waitForGlobalState,
} from './fixtures/state-helpers'
import { getExtensionWorker, makeChapter, makeTask, seedGlobalQueue } from './fixtures/queue-test-helpers'
import { buildExampleUrl } from './fixtures/test-domains'
import type { DownloadTaskState } from '../../src/types/queue-state'

const exampleRootUrl = buildExampleUrl('/')

test.describe('Side panel queue behavior', () => {
  test.describe.configure({ mode: 'serial' })

  test('queued-task cancel uses inline confirmation and preserves active task', async ({ context, extensionId, page }) => {
    await page.goto(exampleRootUrl, { waitUntil: 'domcontentloaded' })

    const now = Date.now()
    const tasks: DownloadTaskState[] = [
      makeTask({
        id: 'active-task-spec',
        seriesTitle: 'Active Task Spec',
        status: 'downloading',
        created: now - 5000,
        chapters: [makeChapter(buildExampleUrl('/active-spec'), 'downloading')],
      }),
      makeTask({
        id: 'queued-task-spec',
        seriesTitle: 'Queued Task Spec',
        status: 'queued',
        created: now - 4000,
        chapters: [makeChapter(buildExampleUrl('/queued-spec'), 'queued')],
      }),
    ]

    await seedGlobalQueue(context, tasks)
    await getTabId(page, context)

    const sp = await openSidepanelHarness(context, extensionId, page)
    await expect(sp.locator('#root')).toBeVisible()
    await expect(sp.getByText('Queued Task Spec')).toBeVisible()

    await sp.getByRole('button', { name: 'Cancel' }).last().click()
    await expect(sp.getByText('Cancel this download?')).toBeVisible()
    await sp.getByRole('button', { name: 'Yes' }).click()

    await waitForGlobalState(context, (state) => {
      const activeTask = state.downloadQueue.find((task) => task.id === 'active-task-spec')
      const queuedTask = state.downloadQueue.find((task) => task.id === 'queued-task-spec')
      return activeTask?.status === 'downloading' && queuedTask?.status === 'canceled'
    })

    await expect(sp.getByText(/1\s*active/)).toBeVisible()
    await sp.close()
  })

  test('restarting a canceled task creates a fresh task with all chapters and no retried badge in the side panel', async ({ context, extensionId, page }) => {
    await page.goto(exampleRootUrl, { waitUntil: 'domcontentloaded' })

    const now = Date.now()
    const chapterUrls = [
      buildExampleUrl('/restart-spec-1'),
      buildExampleUrl('/restart-spec-2'),
      buildExampleUrl('/restart-spec-3'),
    ]
    const tasks: DownloadTaskState[] = [
      makeTask({
        id: 'canceled-task-spec',
        mangaId: 'mangadex:restart-series',
        seriesTitle: 'Restartable Series',
        status: 'canceled',
        created: now - 8000,
        completed: now - 7000,
        chapters: [
          makeChapter(chapterUrls[0], 'completed'),
          makeChapter(chapterUrls[1], 'failed'),
          makeChapter(chapterUrls[2], 'queued'),
        ],
      }),
    ]

    await getTabId(page, context)
    await seedGlobalQueue(context, tasks)
    await expect.poll(async () => {
      const worker = await getExtensionWorker(context)
      const queueView = await worker.evaluate(async () => {
        const result = (await chrome.storage.session.get('queueView')) as {
          queueView?: Array<{ seriesTitle?: string; status?: string }>
        }
        return result.queueView
      })
      return queueView?.some(
        (task) => task.seriesTitle === 'Restartable Series' && task.status === 'canceled',
      ) ?? false
    }).toBe(true)

    const sp = await context.newPage()
    await sp.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'domcontentloaded' })
    await expect(sp.locator('#root')).toBeVisible()
    await expect(sp.getByRole('button', { name: 'Restart task' })).toBeVisible({ timeout: 15000 })

    await sp.getByRole('button', { name: 'Restart task' }).click()

    await waitForGlobalState(context, (state) => {
      const original = state.downloadQueue.find((task) => task.id === 'canceled-task-spec')
      if (!original?.isRetried) return false

      const restartTask = state.downloadQueue.find(
        (task) => task.mangaId === 'mangadex:restart-series' && task.isRetryTask === true,
      )
      if (!restartTask) return false

      return (
        restartTask.chapters.length === chapterUrls.length
        && restartTask.isRetried === false
        && chapterUrls.every((url) => restartTask.chapters.some((chapter) => chapter.url === url))
      )
    })

    await expect(sp.getByText(/^retried$/i)).toHaveCount(0)
    await expect(sp.getByRole('button', { name: 'Restart task' })).toHaveCount(0)
    await sp.close()
  })

  test('history view shows five items and backfills after removing one', async ({ context, extensionId, page }) => {
    await page.goto(exampleRootUrl, { waitUntil: 'domcontentloaded' })

    const now = Date.now()
    const historyTasks: DownloadTaskState[] = Array.from({ length: 6 }, (_, index) => {
      const position = index + 1
      return makeTask({
        id: `history-task-${position}`,
        seriesTitle: `History Task ${position}`,
        status: 'completed',
        created: now - (position + 10) * 1000,
        completed: now - position * 1000,
        chapters: [makeChapter(buildExampleUrl(`/history-${position}`), 'completed')],
      })
    })

    await getTabId(page, context)
    await seedGlobalQueue(context, historyTasks)

    await expect.poll(async () => {
      const queueView = await getSessionState<Array<{ seriesTitle?: string; status?: string }>>(context, 'queueView')
      return queueView
        ?.filter((task) => task.status === 'completed')
        .map((task) => task.seriesTitle)
        .slice(0, 5) ?? []
    }).toEqual([
      'History Task 1',
      'History Task 2',
      'History Task 3',
      'History Task 4',
      'History Task 5',
    ])
  
    const sp = await context.newPage()
    await sp.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'domcontentloaded' })
    await expect(sp.locator('#root')).toBeVisible()
    await expect(sp.getByText('History Task 1')).toBeVisible({ timeout: 15000 })
    await expect(sp.getByText('History Task 5')).toBeVisible()
    await expect(sp.getByText('History Task 6')).toHaveCount(0)

    await sp.getByRole('button', { name: 'Remove' }).first().click()

    await waitForGlobalState(context, (state) => !state.downloadQueue.some((task) => task.id === 'history-task-1'))
    await expect(sp.getByText('History Task 6')).toBeVisible({ timeout: 15000 })
    await sp.close()
  })

  test('View Full History focuses an existing options tab and deep-links to downloads', async ({ context, extensionId, page }) => {
    await page.goto(exampleRootUrl, { waitUntil: 'domcontentloaded' })

    const now = Date.now()
    const tasks: DownloadTaskState[] = [
      makeTask({
        id: 'history-link-task',
        seriesTitle: 'History Link Task',
        status: 'completed',
        created: now - 4000,
        completed: now - 2000,
        chapters: [makeChapter(buildExampleUrl('/history-link'), 'completed')],
      }),
    ]

    await getTabId(page, context)
    await seedGlobalQueue(context, tasks)

    await expect.poll(async () => {
      const queueView = await getSessionState<Array<{ seriesTitle?: string; status?: string }>>(context, 'queueView')
      return queueView?.some(
        (task) => task.seriesTitle === 'History Link Task' && task.status === 'completed',
      ) ?? false
    }).toBe(true)

    const existingOptionsPage = await context.newPage()
    await existingOptionsPage.goto(`chrome-extension://${extensionId}/options.html?tab=debug`, {
      waitUntil: 'domcontentloaded',
    })
    await expect(existingOptionsPage.getByRole('button', { name: 'About & Debug' })).toBeVisible()

    const sp = await context.newPage()
    await sp.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'domcontentloaded' })
    await expect(sp.locator('#root')).toBeVisible()
    await expect(sp.getByText('History Link Task')).toBeVisible({ timeout: 15000 })
    await expect(sp.getByRole('button', { name: 'View Full History' })).toBeVisible({ timeout: 15000 })

    await sp.getByRole('button', { name: 'View Full History' }).click()

    await expect.poll(() => existingOptionsPage.url()).toContain('options.html?tab=downloads')
    await expect(existingOptionsPage.getByRole('button', { name: 'Downloads' })).toBeVisible()
    await expect(existingOptionsPage.getByText('Download destination', { exact: true })).toBeVisible()

    await sp.close()
    await existingOptionsPage.close()
  })
})








