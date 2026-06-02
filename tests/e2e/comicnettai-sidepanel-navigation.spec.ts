import { test, expect } from './fixtures/extension'
import {
  getTabId,
  openSidepanelHarness,
  waitForTabSeriesTitle,
  waitForTabStateCleared,
} from './fixtures/state-helpers'
import { COMICNETTAI_BASE_URL } from './fixtures/test-domains'
import { ComicNettai } from './fixtures/mock-data'

test.describe('Comic Nettai side panel navigation workflows (mocked)', () => {
  test('front page -> book page initializes tab state', async ({ context, extensionId, page }) => {
    await page.goto(COMICNETTAI_BASE_URL, { waitUntil: 'domcontentloaded' })
    const tabId = await getTabId(page, context)

    const sp = await openSidepanelHarness(context, extensionId, page)
    await expect(sp.locator('#root')).toBeVisible()

    await page.bringToFront()
    await page.goto(`${COMICNETTAI_BASE_URL}/book/${ComicNettai.BASIC_SERIES.series.seriesId}`, {
      waitUntil: 'domcontentloaded',
    })

    await waitForTabSeriesTitle(context, tabId, ComicNettai.BASIC_SERIES.series.seriesTitle)

    await sp.close()
  })

  test('book page -> front page clears tab state', async ({ context, extensionId, page }) => {
    const bookUrl = `${COMICNETTAI_BASE_URL}/book/${ComicNettai.BASIC_SERIES.series.seriesId}`
    await page.goto(bookUrl, { waitUntil: 'domcontentloaded' })
    const tabId = await getTabId(page, context)

    const sp = await openSidepanelHarness(context, extensionId, page)
    await expect(sp.locator('#root')).toBeVisible()

    await waitForTabSeriesTitle(context, tabId, ComicNettai.BASIC_SERIES.series.seriesTitle)

    await page.bringToFront()
    await page.goto(COMICNETTAI_BASE_URL, { waitUntil: 'domcontentloaded' })
    await waitForTabStateCleared(context, tabId)

    await sp.close()
  })
})
