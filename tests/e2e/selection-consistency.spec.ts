import { test, expect } from './fixtures/extension'
import { getSessionState, initializeTabViaAction, openSidepanelHarness, waitForTabStateById, waitForGlobalState } from './fixtures/state-helpers'
import {
  MANGADEX_LOCKED_SELECTION_SERIES_ID,
  MANGADEX_TEST_SERIES_URL,
  buildExampleUrl,
  buildMangadexUrl,
} from './fixtures/test-domains'

const SERIES_URL = MANGADEX_TEST_SERIES_URL

async function switchSelectorToFlatChapterView(sidepanelPage: import('@playwright/test').Page): Promise<void> {
  const showAllChaptersButton = sidepanelPage.getByRole('button', { name: /Show All Chapters/i })
  if (await showAllChaptersButton.count()) {
    await showAllChaptersButton.click()
  }
}

// Selection consistency expectation: cross-tab selection synchronization latency <= 500ms for the same series.

test.describe('selection consistency across tabs', () => {
  test('selection actions stay local to the side panel without creating session selection keys or mutating tab state', async ({ context, extensionId, page }) => {
    await page.goto(SERIES_URL, { waitUntil: 'domcontentloaded' })

    const baseChapters = [
      { id: 'chapter-1', url: buildExampleUrl('/ch1'), title: 'Chapter 1' },
      { id: 'chapter-2', url: buildExampleUrl('/ch2'), title: 'Chapter 2' },
    ]

    const tabIdA = await initializeTabViaAction(page, context, extensionId, {
      siteIntegrationId: 'mangadex',
      mangaId: '106937',
      seriesTitle: 'Hunter x Hunter',
      chapters: baseChapters,
    }, SERIES_URL)
    await waitForTabStateById(page, context, tabIdA, (state) => {
      return (
        state.mangaId === '106937' &&
        state.seriesTitle === 'Hunter x Hunter' &&
        Array.isArray(state.chapters) &&
        state.chapters.length > 0
      )
    })

    // Open Side Panel bound to Tab A to send selection action (no need to open inline selector here)
    const spA = await openSidepanelHarness(context, extensionId, page)
    await expect(spA.locator('#root')).toBeVisible()
    await expect(spA.getByText('Hunter x Hunter')).toBeVisible({ timeout: 15000 })

    const toggleButton = spA.getByRole('button', { name: /Select Chapters/i })
    await expect(toggleButton).toBeVisible()
    await toggleButton.click()

    await spA.locator('[data-testid="inline-item"][data-kind="standalone"]').first().click()

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
      return tabState.chapters.some((chapter) => 'selected' in chapter)
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
    await expect(sp.locator('#root')).toBeVisible()
    await expect(sp.getByRole('button', { name: /Select Chapters/i })).toBeVisible({ timeout: 15000 })
    await sp.getByRole('button', { name: /Select Chapters/i }).click()
    await switchSelectorToFlatChapterView(sp)
    await sp.getByRole('checkbox').nth(1).click()
    await expect(sp.getByRole('button', { name: /Download \(1\)/i })).toBeVisible()
    await sp.close()

    const currentTabState = await getSessionState<{
      siteIntegrationId?: string
      mangaId?: string
      chapters?: Array<{ url?: string }>
    }>(context, `tab_${tabId}`)
    const selectionKey = `selection:${currentTabState?.siteIntegrationId}:${currentTabState?.mangaId}`
    const selectedChapterUrl = currentTabState?.chapters?.[0]?.url
    expect(currentTabState?.siteIntegrationId).toBeTruthy()
    expect(currentTabState?.mangaId).toBeTruthy()
    expect(selectedChapterUrl).toBeTruthy()

    const worker = context.serviceWorkers()[0]
    expect(worker).toBeTruthy()
    await worker!.evaluate(async ({ key, url }: { key: string; url: string }) => {
      await chrome.storage.session.set({ [key]: [url] })
    }, { key: selectionKey, url: selectedChapterUrl! })

    const reopened = await openSidepanelHarness(context, extensionId, page)
    await expect(reopened.locator('#root')).toBeVisible()
    await expect(reopened.getByRole('button', { name: /Select Chapters/i })).toBeVisible({ timeout: 15000 })
    await reopened.getByRole('button', { name: /Select Chapters/i }).click()

    await expect(reopened.getByRole('button', { name: /Download \(1\)/i })).toHaveCount(0)
    await expect.poll(async () => {
      const activeTabState = await getSessionState<{ chapters?: Array<Record<string, unknown>> }>(context, `tab_${tabId}`)
      return Array.isArray(activeTabState?.chapters)
        ? activeTabState.chapters.some((chapter) => 'selected' in chapter)
        : false
    }).toBe(false)

    await reopened.close()
  })

  test('does not show the deferred New quick-select control in the selector', async ({ context, extensionId, page }) => {
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
    await expect(sp.locator('#root')).toBeVisible()
    await expect(sp.getByRole('button', { name: /Select Chapters/i })).toBeVisible({ timeout: 15000 })
    await sp.getByRole('button', { name: /Select Chapters/i }).click()
    await switchSelectorToFlatChapterView(sp)

    await expect(sp.getByRole('button', { name: /^New$/i })).toHaveCount(0)

    await sp.close()
  })

  test('locked chapters are displayed but cannot be selected', async ({ context, extensionId, page }) => {
    const lockedSeriesUrl = buildMangadexUrl(
      `/title/${MANGADEX_LOCKED_SELECTION_SERIES_ID}/locked-selection-series`,
    )
    await page.goto(lockedSeriesUrl, { waitUntil: 'domcontentloaded' })

    const lockedChapterUrl = buildExampleUrl('/locked-chapter-1')
    const baseChapters = [
      { id: 'locked-chapter-1', url: lockedChapterUrl, title: 'Locked Chapter 1', locked: true },
      { id: 'open-chapter-1', url: buildExampleUrl('/open-chapter-1'), title: 'Open Chapter 1' },
    ]

    const tabId = await initializeTabViaAction(
      page,
      context,
      extensionId,
      {
        siteIntegrationId: 'mangadex',
        mangaId: MANGADEX_LOCKED_SELECTION_SERIES_ID,
        seriesTitle: 'Locked Selection Series',
        chapters: baseChapters,
      },
      lockedSeriesUrl,
    )

    const tabState = await waitForTabStateById(page, context, tabId, (state) => {
      return (
        state.mangaId === MANGADEX_LOCKED_SELECTION_SERIES_ID &&
        state.chapters?.length === baseChapters.length &&
        state.chapters.some((chapter) => chapter.url === lockedChapterUrl && chapter.locked === true)
      )
    })
    const lockedChapter = tabState.chapters.find((chapter) => chapter.locked === true)
    const openChapter = tabState.chapters.find((chapter) => chapter.locked !== true)
    expect(lockedChapter).toBeTruthy()
    expect(openChapter).toBeTruthy()

    const sp = await openSidepanelHarness(context, extensionId, page)
    await expect(sp.locator('#root')).toBeVisible()
    await expect(sp.getByText('Locked Selection Series')).toBeVisible({ timeout: 15000 })

    const toggleButton = sp.getByRole('button', { name: /Select Chapters/i })
    await toggleButton.click()

    await expect(sp.getByText(lockedChapter!.title)).toBeVisible()
    await expect(sp.getByText('Locked', { exact: true })).toBeVisible()
    await expect(sp.getByRole('checkbox', { name: new RegExp(lockedChapter!.title, 'i') })).toBeDisabled()
    await expect(sp.getByRole('checkbox', { name: new RegExp(lockedChapter!.title, 'i') })).not.toBeChecked()

    await sp.getByText(openChapter!.title).click()
    await expect(sp.getByRole('button', { name: /Download \(1\)/i })).toBeVisible()
    await expect(sp.getByRole('checkbox', { name: new RegExp(openChapter!.title, 'i') })).toBeChecked()

    await sp.close()
  })
})
