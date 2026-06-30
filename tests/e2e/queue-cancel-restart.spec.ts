import { test, expect } from './fixtures/extension'
import { waitForGlobalState, getTabId } from './fixtures/state-helpers'
import { buildExampleUrl } from './fixtures/test-domains'
import { makeChapter, makeTask, seedGlobalQueue } from './fixtures/queue-test-helpers'
import type { ChapterState } from '../../src/types/tab-state'
import type { DownloadTaskState } from '../../src/types/queue-state'

const exampleRootUrl = buildExampleUrl('/')

test.describe('Queue cancel and restart behavior', () => {
  test.describe.configure({ mode: 'serial' })

  test('per-task Cancel and Remove actions update global queue state', async ({ context, extensionId, page }) => {
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
        id: 'completed-task',
        seriesTitle: 'Completed Series',
        status: 'completed',
        created: now - 8000,
        completed: now - 7000,
        chapters: [makeChapter(buildExampleUrl('/c2'), 'completed')],
      }),
    ]

    await seedGlobalQueue(context, tasks)

    await getTabId(page, context)
    const sp = await context.newPage()
    await sp.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'domcontentloaded' })

    await expect(sp.locator('#root')).toBeVisible()
    await sp.getByRole('button', { name: 'Cancel' }).click()
    await expect(sp.getByText('Cancel this download?')).toBeVisible()
    await sp.getByRole('button', { name: 'Yes' }).click()

    await waitForGlobalState(context, (state) => {
      const t = state.downloadQueue.find((task) => task.id === 'active-task')
      return !!t && t.status === 'canceled'
    })

    // After cancel, both tasks are in history and have a Remove button; the completed task
    // is the second one. Target that button explicitly to avoid strict-mode violations.
    await sp.getByRole('button', { name: 'Remove' }).last().click()

    await waitForGlobalState(context, (state) => !state.downloadQueue.some((task) => task.id === 'completed-task'))
  })

  test('inline cancellation confirmation keeps task downloading when user selects No', async ({ context, extensionId, page }) => {
    await page.goto(exampleRootUrl, { waitUntil: 'domcontentloaded' })

    const now = Date.now()
    const tasks: DownloadTaskState[] = [
      makeTask({
        id: 'active-task-no-confirm',
        seriesTitle: 'Active Series No Confirm',
        status: 'downloading',
        created: now - 5000,
        chapters: [makeChapter(buildExampleUrl('/cancel-no'), 'downloading')],
      }),
    ]

    await seedGlobalQueue(context, tasks)

    await getTabId(page, context)
    const sp = await context.newPage()
    await sp.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'domcontentloaded' })

    await expect(sp.locator('#root')).toBeVisible()
    await sp.getByRole('button', { name: 'Cancel' }).click()
    await expect(sp.getByText('Cancel this download?')).toBeVisible()

    await sp.getByRole('button', { name: 'No' }).click()
    await expect(sp.getByText('Cancel this download?')).toHaveCount(0)

    await waitForGlobalState(context, (state) => {
      const t = state.downloadQueue.find((task) => task.id === 'active-task-no-confirm')
      return !!t && t.status === 'downloading'
    })

    await sp.close()
  })

  test('retry failed chapters creates a new queued task and marks original as retried', async ({ context, extensionId, page }) => {
    await page.goto(exampleRootUrl, { waitUntil: 'domcontentloaded' })

    const now = Date.now()
    const tasks: DownloadTaskState[] = [
      makeTask({
        id: 'failed-with-mix',
        seriesTitle: 'Has Failures',
        status: 'partial_success',
        created: now - 8000,
        completed: now - 7000,
        chapters: [
          makeChapter(buildExampleUrl('/c1'), 'completed'),
          makeChapter(buildExampleUrl('/c2'), 'failed'),
          makeChapter(buildExampleUrl('/c3'), 'failed'),
        ],
      }),
    ]

    await seedGlobalQueue(context, tasks)

    await getTabId(page, context)
    const sp = await context.newPage()
    await sp.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'domcontentloaded' })

    await expect(sp.locator('#root')).toBeVisible()
    await expect(sp.getByText('Has Failures')).toBeVisible()

    // There should be a single "Retry failed" action for the failed task
    const retryButton = sp.getByRole('button', { name: 'Retry failed' })
    await expect(retryButton).toBeVisible()
    await retryButton.click()

    // Global state: original task is marked retried; a new retry task exists with only failed chapters
    await waitForGlobalState(context, (state) => {
      const original = state.downloadQueue.find((t) => t.id === 'failed-with-mix')
      if (!original || !original.isRetried) return false

      const retryTasks = state.downloadQueue.filter((t) => t.id !== 'failed-with-mix' && t.mangaId === original.mangaId)
      const retryTask = retryTasks[0]
      if (!retryTask) return false

      const urls = retryTask.chapters.map((ch) => ch.url)
      return (
        urls.length === 2 &&
        urls.includes(buildExampleUrl('/c2')) &&
        urls.includes(buildExampleUrl('/c3'))
      )
    })

    // Regression guard: retry-created task must not remain permanently queued
    await waitForGlobalState(context, (state) => {
      const original = state.downloadQueue.find((t) => t.id === 'failed-with-mix')
      if (!original) return false

      const retryTask = state.downloadQueue.find((t) => t.id !== 'failed-with-mix' && t.mangaId === original.mangaId)
      if (!retryTask) return false

      return retryTask.status !== 'queued'
    })

    // UI: Retry button should be removed once the original task has been retried
    await expect(sp.getByRole('button', { name: 'Retry failed' })).toHaveCount(0)

    await sp.close()
  })

  test('retry action includes both failed and partial_success chapters', async ({ context, extensionId, page }) => {
    await page.goto(exampleRootUrl, { waitUntil: 'domcontentloaded' })

    const now = Date.now()
    const tasks: DownloadTaskState[] = [
      makeTask({
        id: 'retry-partial',
        seriesTitle: 'Retry Partial',
        status: 'partial_success' as DownloadTaskState['status'],
        created: now - 8000,
        completed: now - 7000,
        chapters: [
          makeChapter(buildExampleUrl('/rp1'), 'completed'),
          makeChapter(buildExampleUrl('/rp2'), 'failed'),
          makeChapter(buildExampleUrl('/rp3'), 'partial_success' as ChapterState['status']),
        ],
      }),
    ]

    await seedGlobalQueue(context, tasks)

    await getTabId(page, context)
    const sp = await context.newPage()
    await sp.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'domcontentloaded' })

    await expect(sp.locator('#root')).toBeVisible()
    await expect(sp.getByText('Retry Partial')).toBeVisible()

    await sp.getByRole('button', { name: 'Retry failed' }).click()

    await waitForGlobalState(context, (state) => {
      const original = state.downloadQueue.find((task) => task.id === 'retry-partial')
      if (!original?.isRetried) {
        return false
      }

      const retryTask = state.downloadQueue.find(
        (task) => task.id !== 'retry-partial' && task.mangaId === original.mangaId,
      )
      if (!retryTask) {
        return false
      }

      const retryUrls = retryTask.chapters.map((chapter) => chapter.url).sort()
      return retryUrls.length === 2
        && retryUrls[0] === buildExampleUrl('/rp2')
        && retryUrls[1] === buildExampleUrl('/rp3')
    })

    await sp.close()
  })
})
