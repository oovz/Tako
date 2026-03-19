import { test, expect } from './fixtures/extension'
import { initializeTabViaAction, openSidepanelHarness, waitForTabStateById, waitForGlobalState } from './fixtures/state-helpers'
import { MANGADEX_TEST_SERIES_URL, buildExampleUrl } from './fixtures/test-domains'

const SERIES_URL = MANGADEX_TEST_SERIES_URL

// Selection consistency expectation: cross-tab selection synchronization latency <= 500ms for the same series.

test.describe('selection consistency across tabs', () => {
  test('selection actions stay local to the side panel without creating session selection keys or mutating tab state', async ({ context, extensionId, page }) => {
    const chapterOneUrl = buildExampleUrl('/ch1')
    const baseChapters = [
      { id: 'chapter-1', url: chapterOneUrl, title: 'Chapter 1' },
      { id: 'chapter-2', url: buildExampleUrl('/ch2'), title: 'Chapter 2' },
    ]

    const tabIdA = await initializeTabViaAction(page, context, extensionId, {
      siteIntegrationId: 'mangadex',
      mangaId: '106937',
      seriesTitle: 'Hunter x Hunter',
      chapters: baseChapters,
    }, SERIES_URL)
    const currentTabState = await waitForTabStateById(page, context, tabIdA, (state) => {
      return (
        state.mangaId === '106937' &&
        state.seriesTitle === 'Hunter x Hunter' &&
        Array.isArray(state.chapters) &&
        state.chapters.length > 0
      )
    })
    const selectedChapterUrl = currentTabState.chapters[0]?.url
    expect(selectedChapterUrl).toBeTruthy()

    // Open Side Panel bound to Tab A to send selection action (no need to open inline selector here)
    const spA = await openSidepanelHarness(context, extensionId, page)
    await expect(spA.locator('#root')).toBeVisible()
    await expect(spA.getByText('Hunter x Hunter')).toBeVisible({ timeout: 15000 })

    const toggleButton = spA.getByRole('button', { name: /Select Chapters/i })
    await expect(toggleButton).toBeVisible()
    await toggleButton.click()

    await spA.getByText(currentTabState.chapters[0]?.title ?? '').click()

    await expect(spA.getByRole('button', { name: /Download \(1\)/i })).toBeVisible()

    const selectionKey = 'selection:mangadex:106937'
    await expect.poll(async () => {
      const worker = context.serviceWorkers()[0]
      if (!worker) return false
      return worker.evaluate(async (key) => {
        const result = await chrome.storage.session.get([key])
        return !(key in result)
      }, selectionKey)
    }).toBe(true)

    await expect.poll(async () => {
      const tabState = await waitForTabStateById(page, context, tabIdA, (state) => state.mangaId === '106937')
      const selectedChapter = tabState.chapters.find((chapter) => chapter.url === selectedChapterUrl)
      return selectedChapter ? 'selected' in selectedChapter : false
    }).toBe(false)

    await spA.close()
  })
})

test.describe('chapter selection flow', () => {
  test('expands inline selector and collapses after starting a download', async ({ context, extensionId, page }) => {
    await page.goto(SERIES_URL, { waitUntil: 'domcontentloaded' })

    const baseChapters = [
      { id: 'chapter-1', url: buildExampleUrl('/ch1'), title: 'Chapter 1' },
      { id: 'chapter-2', url: buildExampleUrl('/ch2'), title: 'Chapter 2' },
      { id: 'chapter-3', url: buildExampleUrl('/ch3'), title: 'Chapter 3' },
    ]

    const tabId = await initializeTabViaAction(
      page,
      context,
      extensionId,
      {
        siteIntegrationId: 'mangadex',
        mangaId: '106937',
        seriesTitle: 'Hunter x Hunter',
        chapters: baseChapters,
      },
      SERIES_URL,
    )
    await waitForTabStateById(page, context, tabId, (state) => {
      return (
        state.mangaId === '106937' &&
        state.seriesTitle === 'Hunter x Hunter' &&
        state.chapters?.length === baseChapters.length
      )
    })

    const sp = await openSidepanelHarness(context, extensionId, page)
    await expect(sp.locator('#root')).toBeVisible()
    await expect(sp.getByText('Hunter x Hunter')).toBeVisible({ timeout: 15000 })

    const toggleButton = sp.getByRole('button', { name: /Select Chapters/i })
    await expect(toggleButton).toBeVisible()
    await toggleButton.click()

    await expect(sp.getByRole('button', { name: /Close Selection/i })).toBeVisible()

    const downloadButton = sp.getByRole('button', { name: /Download/i })
    await expect(downloadButton).toBeVisible()

    await sp.getByText('Chapter 1').click()

    await expect(downloadButton).toHaveText(/Download \(1\)/i)
    await downloadButton.click()

    await waitForGlobalState(context, (state) => Array.isArray(state.downloadQueue) && state.downloadQueue.length >= 1)

    await expect(sp.getByRole('button', { name: /Select Chapters/i })).toBeVisible()
    await expect(sp.getByRole('button', { name: /Close Selection/i })).toHaveCount(0)
  })

  test('does not persist chapter selections after closing and reopening the side panel', async ({ context, extensionId, page }) => {
    await page.goto(SERIES_URL, { waitUntil: 'domcontentloaded' })

    const baseChapters = [
      { id: 'chapter-1', url: buildExampleUrl('/ch1'), title: 'Chapter 1' },
      { id: 'chapter-2', url: buildExampleUrl('/ch2'), title: 'Chapter 2' },
    ]

    const tabId = await initializeTabViaAction(
      page,
      context,
      extensionId,
      {
        siteIntegrationId: 'mangadex',
        mangaId: 'selection-reset-series',
        seriesTitle: 'Selection Reset Series',
        chapters: baseChapters,
      },
      SERIES_URL,
    )

    await waitForTabStateById(page, context, tabId, (state) => {
      return state.mangaId === 'selection-reset-series' && state.chapters?.length === baseChapters.length
    })

    const sp = await openSidepanelHarness(context, extensionId, page)
    await expect(sp.getByText('Selection Reset Series')).toBeVisible({ timeout: 15000 })
    await sp.getByRole('button', { name: /Select Chapters/i }).click()
    await sp.getByText('Chapter 1').click()
    await expect(sp.getByRole('button', { name: /Download \(1\)/i })).toBeVisible()
    await sp.close()

    const selectionKey = 'selection:mangadex:selection-reset-series'
    const worker = context.serviceWorkers()[0]
    expect(worker).toBeTruthy()
    await worker!.evaluate(async ([key, url]) => {
      await chrome.storage.session.set({ [key]: [url] })
    }, [selectionKey, buildExampleUrl('/ch1')])

    const reopened = await openSidepanelHarness(context, extensionId, page)
    await expect(reopened.getByText('Selection Reset Series')).toBeVisible({ timeout: 15000 })
    await reopened.getByRole('button', { name: /Select Chapters/i }).click()

    await expect(reopened.getByRole('button', { name: /Download \(1\)/i })).toHaveCount(0)
    await expect.poll(async () => {
      const activeTabState = await waitForTabStateById(page, context, tabId, (state) => state.mangaId === 'selection-reset-series')
      const chapter = activeTabState.chapters.find((item) => item.url === buildExampleUrl('/ch1'))
      return chapter ? 'selected' in chapter : false
    }).toBe(false)

    await reopened.close()
  })

  test('does not show the deferred New quick-select control in the MVP selector', async ({ context, extensionId, page }) => {
    await page.goto(SERIES_URL, { waitUntil: 'domcontentloaded' })

    const baseChapters = [
      { id: 'chapter-1', url: buildExampleUrl('/new-1'), title: 'Chapter 1' },
      { id: 'chapter-2', url: buildExampleUrl('/new-2'), title: 'Chapter 2' },
    ]

    const tabId = await initializeTabViaAction(
      page,
      context,
      extensionId,
      {
        siteIntegrationId: 'mangadex',
        mangaId: 'no-new-quick-select',
        seriesTitle: 'No New Quick Select',
        chapters: baseChapters,
      },
      SERIES_URL,
    )

    await waitForTabStateById(page, context, tabId, (state) => {
      return state.mangaId === 'no-new-quick-select' && state.chapters?.length === baseChapters.length
    })

    const sp = await openSidepanelHarness(context, extensionId, page)
    await expect(sp.getByText('No New Quick Select')).toBeVisible({ timeout: 15000 })
    await sp.getByRole('button', { name: /Select Chapters/i }).click()

    await expect(sp.getByRole('button', { name: /^New$/i })).toHaveCount(0)

    await sp.close()
  })

  test('locked chapters are displayed but cannot be selected', async ({ context, extensionId, page }) => {
    await page.goto(SERIES_URL, { waitUntil: 'domcontentloaded' })

    const lockedChapterUrl = buildExampleUrl('/ch-locked')
    const baseChapters = [
      { id: 'chapter-locked', url: lockedChapterUrl, title: 'Chapter Locked', locked: true },
      { id: 'chapter-open', url: buildExampleUrl('/ch-open'), title: 'Chapter Open' },
    ]

    const tabId = await initializeTabViaAction(
      page,
      context,
      extensionId,
      {
        siteIntegrationId: 'mangadex',
        mangaId: 'locked-series',
        seriesTitle: 'Locked Series',
        chapters: baseChapters,
      },
      SERIES_URL,
    )

    await waitForTabStateById(page, context, tabId, (state) => {
      return (
        state.mangaId === 'locked-series' &&
        state.chapters?.length === baseChapters.length &&
        state.chapters.some((chapter) => chapter.url === lockedChapterUrl && chapter.locked === true)
      )
    })

    const sp = await openSidepanelHarness(context, extensionId, page)
    await expect(sp.locator('#root')).toBeVisible()
    await expect(sp.getByText('Locked Series')).toBeVisible({ timeout: 15000 })

    const toggleButton = sp.getByRole('button', { name: /Select Chapters/i })
    await toggleButton.click()

    await expect(sp.getByText('Chapter Locked')).toBeVisible()
    await expect(sp.getByRole('checkbox', { name: /Chapter Locked/i })).toBeDisabled()
    await expect(sp.getByRole('checkbox', { name: /Chapter Locked/i })).not.toBeChecked()

    await sp.getByText('Chapter Open').click()
    await expect(sp.getByRole('button', { name: /Download \(1\)/i })).toBeVisible()
    await expect(sp.getByRole('checkbox', { name: /Chapter Open/i })).toBeChecked()

    await sp.close()
  })
})
