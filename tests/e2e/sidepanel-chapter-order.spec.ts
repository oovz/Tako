import { test, expect } from './fixtures/extension'
import { initializeTabViaAction, openSidepanelHarness, waitForGlobalState, waitForTabState } from './fixtures/state-helpers'
import {
  buildMangadexUrl,
  MANGADEX_GROUPED_COLLAPSE_SERIES_ID,
  MANGADEX_ORDER_TEST_SERIES_ID,
  MANGADEX_STRESS_TOGGLE_SERIES_ID,
  MANGADEX_VIEW_TOGGLE_SERIES_ID,
} from './fixtures/test-domains'

const ORDER_TEST_SERIES_URL = buildMangadexUrl(`/title/${MANGADEX_ORDER_TEST_SERIES_ID}/ordering-test-series`)
const VIEW_TOGGLE_SERIES_URL = buildMangadexUrl(`/title/${MANGADEX_VIEW_TOGGLE_SERIES_ID}/view-toggle-series`)
const STRESS_TOGGLE_SERIES_URL = buildMangadexUrl(`/title/${MANGADEX_STRESS_TOGGLE_SERIES_ID}/stress-toggle-series`)
const GROUPED_COLLAPSE_SERIES_URL = buildMangadexUrl(`/title/${MANGADEX_GROUPED_COLLAPSE_SERIES_ID}/grouped-collapse-series`)

// Side Panel chapter list preserves mixed standalone/volume order

test.describe('Side Panel chapter/volume order', () => {
  test('renders standalone chapters and volumes in correct mixed order', async ({ context, extensionId, page }) => {
    await page.goto(ORDER_TEST_SERIES_URL, { waitUntil: 'domcontentloaded' })

    const baseChapters = [
      { id: 'standalone-1', url: 'https://example.com/standalone-1', title: 'Standalone chapter 1' },
      { id: 'v2-c3', url: 'https://example.com/v2-c3', title: 'Volume 2 Chapter 3', chapterNumber: 3, volumeNumber: 2 },
      { id: 'standalone-2', url: 'https://example.com/standalone-2', title: 'Standalone chapter 2' },
      { id: 'v2-c4', url: 'https://example.com/v2-c4', title: 'Volume 2 Chapter 4', chapterNumber: 4, volumeNumber: 2 },
      { id: 'v2-c5', url: 'https://example.com/v2-c5', title: 'Volume 2 Chapter 5', chapterNumber: 5, volumeNumber: 2 },
      { id: 'standalone-3', url: 'https://example.com/standalone-3', title: 'Standalone chapter 3' },
      { id: 'v2-c6', url: 'https://example.com/v2-c6', title: 'Volume 2 Chapter 6', chapterNumber: 6, volumeNumber: 2 },
    ]

    await initializeTabViaAction(
      page,
      context,
      extensionId,
      {
        siteIntegrationId: 'mangadex',
        mangaId: MANGADEX_ORDER_TEST_SERIES_ID,
        seriesTitle: 'Ordering Test Series',
        chapters: baseChapters,
      },
      ORDER_TEST_SERIES_URL,
    )

    await waitForTabState(page, context, (state) => {
      return (
        state.mangaId === MANGADEX_ORDER_TEST_SERIES_ID &&
        state.seriesTitle === 'Ordering Test Series' &&
        state.chapters?.length === baseChapters.length
      )
    })

    const sp = await openSidepanelHarness(context, extensionId, page)
    await expect(sp.locator('#root')).toBeVisible()
    await expect(sp.getByText('Ordering Test Series')).toBeVisible({ timeout: 15000 })

    const toggleButton = sp.getByRole('button', { name: /Select Chapters/i })
    await expect(toggleButton).toBeVisible()
    await toggleButton.click()

    // Collect inline items in DOM order (volumes and standalones)
    const itemLocator = sp.locator('[data-testid="inline-item"]')
    const count = await itemLocator.count()
    expect(count).toBe(6)

    const items = [] as { kind: string | null; text: string }[]
    for (let i = 0; i < count; i++) {
      const el = itemLocator.nth(i)
      const kind = await el.getAttribute('data-kind')
      const text = (await el.innerText()).trim()
      items.push({ kind, text })
    }

    // We expect:
    // 0: standalone 1
    // 1: volume 2 (group 1)
    // 2: standalone 2
    // 3: volume 2 (group 2)
    // 4: standalone 3
    // 5: volume 2 (group 3)
    expect(items[0].kind).toBe('standalone')
    expect(items[0].text).toContain('Standalone chapter 1')

    expect(items[1].kind).toBe('volume')
    expect(items[1].text).toContain('Volume 2')

    expect(items[2].kind).toBe('standalone')
    expect(items[2].text).toContain('Standalone chapter 2')

    expect(items[3].kind).toBe('volume')
    expect(items[3].text).toContain('Volume 2')

    expect(items[4].kind).toBe('standalone')
    expect(items[4].text).toContain('Standalone chapter 3')

    expect(items[5].kind).toBe('volume')
    expect(items[5].text).toContain('Volume 2')

    await sp.close()
  })

  test('volume select-all operates per contiguous volume group', async ({ context, extensionId, page }) => {
    await page.goto(ORDER_TEST_SERIES_URL, { waitUntil: 'domcontentloaded' })

    const baseChapters = [
      { id: 'standalone-1', url: 'https://example.com/standalone-1', title: 'Standalone chapter 1' },
      { id: 'v2-c3', url: 'https://example.com/v2-c3', title: 'Volume 2 Chapter 3', chapterNumber: 3, volumeNumber: 2 },
      { id: 'standalone-2', url: 'https://example.com/standalone-2', title: 'Standalone chapter 2' },
      { id: 'v2-c4', url: 'https://example.com/v2-c4', title: 'Volume 2 Chapter 4', chapterNumber: 4, volumeNumber: 2 },
      { id: 'v2-c5', url: 'https://example.com/v2-c5', title: 'Volume 2 Chapter 5', chapterNumber: 5, volumeNumber: 2 },
      { id: 'standalone-3', url: 'https://example.com/standalone-3', title: 'Standalone chapter 3' },
      { id: 'v2-c6', url: 'https://example.com/v2-c6', title: 'Volume 2 Chapter 6', chapterNumber: 6, volumeNumber: 2 },
    ]

    await initializeTabViaAction(
      page,
      context,
      extensionId,
      {
        siteIntegrationId: 'mangadex',
        mangaId: MANGADEX_ORDER_TEST_SERIES_ID,
        seriesTitle: 'Ordering Test Series',
        chapters: baseChapters,
      },
      ORDER_TEST_SERIES_URL,
    )

    await waitForTabState(page, context, (state) => {
      return (
        state.mangaId === MANGADEX_ORDER_TEST_SERIES_ID &&
        state.seriesTitle === 'Ordering Test Series' &&
        state.chapters?.length === baseChapters.length
      )
    })

    const sp = await openSidepanelHarness(context, extensionId, page)
    await expect(sp.locator('#root')).toBeVisible()
    await expect(sp.getByText('Ordering Test Series')).toBeVisible({ timeout: 15000 })

    const toggleButton = sp.getByRole('button', { name: /Select Chapters/i })
    await expect(toggleButton).toBeVisible()
    await toggleButton.click()

    // Click "Select All" on the second Volume 2 group (with chapters v2-c4 and v2-c5)
    const volumeItems = sp.locator('[data-testid="inline-item"][data-kind="volume"]')
    await expect(volumeItems).toHaveCount(3)
    const secondVolume = volumeItems.nth(1)
    const secondVolumeSelectAll = secondVolume.getByRole('button', { name: /Select All/i })
    await secondVolumeSelectAll.click()

    await expect(sp.getByRole('button', { name: /Download \(2\)/i })).toBeVisible()
    await expect(sp.getByRole('checkbox', { name: /Volume 2 Chapter 4/i })).toBeChecked()
    await expect(sp.getByRole('checkbox', { name: /Volume 2 Chapter 5/i })).toBeChecked()
    await expect(sp.getByRole('checkbox', { name: /Volume 2 Chapter 3/i })).not.toBeChecked()
    await expect(sp.getByRole('checkbox', { name: /Volume 2 Chapter 6/i })).not.toBeChecked()
    await expect(sp.getByRole('checkbox', { name: /Standalone chapter 1/i })).not.toBeChecked()
    await expect(sp.getByRole('checkbox', { name: /Standalone chapter 2/i })).not.toBeChecked()
    await expect(sp.getByRole('checkbox', { name: /Standalone chapter 3/i })).not.toBeChecked()

    await sp.close()
  })

  test('switches between grouped and flat chapter views without crashing the side panel', async ({ context, extensionId, page }) => {
    await page.goto(VIEW_TOGGLE_SERIES_URL, { waitUntil: 'domcontentloaded' })

    const baseChapters = Array.from({ length: 32 }, (_, index) => {
      const chapterNumber = index + 1
      const volumeNumber = chapterNumber <= 16 ? 1 : 2

      return {
        id: `toggle-${chapterNumber}`,
        url: `https://example.com/toggle-${chapterNumber}`,
        title: `Volume ${volumeNumber} Chapter ${chapterNumber}`,
        chapterNumber,
        volumeNumber,
      }
    })

    await initializeTabViaAction(
      page,
      context,
      extensionId,
      {
        siteIntegrationId: 'mangadex',
        mangaId: MANGADEX_VIEW_TOGGLE_SERIES_ID,
        seriesTitle: 'View Toggle Series',
        chapters: baseChapters,
      },
      VIEW_TOGGLE_SERIES_URL,
    )

    await waitForTabState(page, context, (state) => {
      return (
        state.mangaId === MANGADEX_VIEW_TOGGLE_SERIES_ID &&
        state.seriesTitle === 'View Toggle Series' &&
        state.chapters?.length === baseChapters.length
      )
    })

    const sp = await openSidepanelHarness(context, extensionId, page)
    await expect(sp.locator('#root')).toBeVisible()
    await expect(sp.getByText('View Toggle Series')).toBeVisible({ timeout: 15000 })

    await sp.getByRole('button', { name: /Select Chapters/i }).click()
    const viewModeTrigger = sp.getByRole('button', { name: /Show All Chapters/i })

    await expect(sp.getByText(/^Volume 1$/)).toBeVisible()
    await expect(viewModeTrigger).toBeVisible()
    await expect(viewModeTrigger).toHaveText('All chapters')

    const firstVolumeRow = sp.locator('[data-testid="inline-item"][data-kind="volume"]').first()
    await expect(firstVolumeRow).not.toContainText('selectable')

    await viewModeTrigger.click()

    await expect(sp.getByText('View Toggle Series')).toBeVisible()
    const groupByVolumeButton = sp.getByRole('button', { name: /Group by Volume/i })
    await expect(groupByVolumeButton).toBeVisible()
    await expect(groupByVolumeButton).toHaveText('Volumes')
    await expect(sp.locator('#toggle-1')).toBeVisible()
    await expect(sp.locator('#toggle-2')).toBeVisible()

    await groupByVolumeButton.click()

    await expect(sp.getByRole('button', { name: /Show All Chapters/i })).toBeVisible()
    await expect(sp.getByText(/^Volume 1$/)).toBeVisible()

    await sp.close()
  })

  test('survives repeated grouped-flat selector toggles on virtualized chapter lists without React depth errors', async ({ context, extensionId, page }) => {
    await page.goto(STRESS_TOGGLE_SERIES_URL, { waitUntil: 'domcontentloaded' })

    const baseChapters = Array.from({ length: 36 }, (_, index) => {
      const chapterNumber = index + 1
      const volumeNumber = chapterNumber <= 18 ? 1 : 2

      return {
        id: `stress-${chapterNumber}`,
        url: `https://example.com/stress-${chapterNumber}`,
        title: `Volume ${volumeNumber} Chapter ${chapterNumber}`,
        chapterNumber,
        volumeNumber,
      }
    })

    await initializeTabViaAction(
      page,
      context,
      extensionId,
      {
        siteIntegrationId: 'mangadex',
        mangaId: MANGADEX_STRESS_TOGGLE_SERIES_ID,
        seriesTitle: 'Stress Toggle Series',
        chapters: baseChapters,
      },
      STRESS_TOGGLE_SERIES_URL,
    )

    await waitForTabState(page, context, (state) => {
      return (
        state.mangaId === MANGADEX_STRESS_TOGGLE_SERIES_ID &&
        state.seriesTitle === 'Stress Toggle Series' &&
        state.chapters?.length === baseChapters.length
      )
    })

    const sp = await openSidepanelHarness(context, extensionId, page)
    const pageErrors: string[] = []
    const consoleErrors: string[] = []
    sp.on('pageerror', (error) => {
      pageErrors.push(error.message)
    })
    sp.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text())
      }
    })

    await expect(sp.locator('#root')).toBeVisible()
    await expect(sp.getByText('Stress Toggle Series')).toBeVisible({ timeout: 15000 })

    await sp.getByRole('button', { name: /Select Chapters/i }).click()

    for (let iteration = 0; iteration < 10; iteration += 1) {
      const isGroupedView = iteration % 2 === 0
      await sp.getByRole('button', { name: isGroupedView ? /Show All Chapters/i : /Group by Volume/i }).click()
    }

    await expect(sp.locator('#root')).toBeVisible()
    await expect(sp.getByRole('button', { name: /Show All Chapters/i })).toBeVisible()
    expect(pageErrors.some((message) => message.includes('Maximum update depth exceeded'))).toBe(false)
    expect(consoleErrors.some((message) => message.includes('Maximum update depth exceeded'))).toBe(false)

    await sp.close()
  })

  test('auto-collapses the grouped selector after successfully starting a download', async ({ context, extensionId, page }) => {
    await page.goto(GROUPED_COLLAPSE_SERIES_URL, { waitUntil: 'domcontentloaded' })

    const baseChapters = [
      { id: 'v1-c1', url: 'https://example.com/collapse-v1-c1', title: 'Volume 1 Chapter 1', chapterNumber: 1, volumeNumber: 1 },
      { id: 'v1-c2', url: 'https://example.com/collapse-v1-c2', title: 'Volume 1 Chapter 2', chapterNumber: 2, volumeNumber: 1 },
      { id: 'v2-c3', url: 'https://example.com/collapse-v2-c3', title: 'Volume 2 Chapter 3', chapterNumber: 3, volumeNumber: 2 },
    ]

    await initializeTabViaAction(
      page,
      context,
      extensionId,
      {
        siteIntegrationId: 'mangadex',
        mangaId: MANGADEX_GROUPED_COLLAPSE_SERIES_ID,
        seriesTitle: 'Grouped Collapse Series',
        chapters: baseChapters,
      },
      GROUPED_COLLAPSE_SERIES_URL,
    )

    await waitForTabState(page, context, (state) => {
      return (
        state.mangaId === MANGADEX_GROUPED_COLLAPSE_SERIES_ID &&
        state.seriesTitle === 'Grouped Collapse Series' &&
        state.chapters?.length === baseChapters.length
      )
    })

    const sp = await openSidepanelHarness(context, extensionId, page)
    await expect(sp.locator('#root')).toBeVisible()
    await expect(sp.getByText('Grouped Collapse Series')).toBeVisible({ timeout: 15000 })

    await sp.getByRole('button', { name: /Select Chapters/i }).click()
    const viewModeTrigger = sp.getByRole('button', { name: /Show All Chapters/i })
    await expect(viewModeTrigger).toBeVisible()
    await viewModeTrigger.click()

    await sp.getByText('Volume 1 Chapter 1').click()
    await expect(sp.getByRole('button', { name: /Download \(1\)/i })).toBeVisible()

    await sp.getByRole('button', { name: /Download \(1\)/i }).click()

    await waitForGlobalState(context, (state) => Array.isArray(state.downloadQueue) && state.downloadQueue.length >= 1)

    await expect(sp.getByRole('button', { name: /Select Chapters/i })).toBeVisible()
    await expect(sp.getByRole('button', { name: /Close Selection/i })).toHaveCount(0)
    await expect(sp.getByRole('button', { name: /Group by Volume/i })).toHaveCount(0)

    await sp.close()
  })
})
