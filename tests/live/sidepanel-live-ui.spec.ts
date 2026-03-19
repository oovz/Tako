import { test, expect } from '../e2e/fixtures/extension'
import { getSessionState, getTabId, openSidepanelHarness } from '../e2e/fixtures/state-helpers'
import { LIVE_MANGADEX_REFERENCE_URL } from '../e2e/fixtures/test-domains'

interface LiveTabState {
  siteIntegrationId?: string
  mangaId?: string
  seriesTitle?: string
  chapters?: unknown[]
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function waitForLiveTabState(
  context: import('@playwright/test').BrowserContext,
  tabId: number,
  timeoutMs: number = 90_000,
): Promise<LiveTabState> {
  const start = Date.now()
  let lastState: LiveTabState | undefined

  while (Date.now() - start < timeoutMs) {
    const state = await getSessionState<LiveTabState>(context, `tab_${tabId}`)
    lastState = state

    const hasSeries = typeof state?.seriesTitle === 'string' && state.seriesTitle.length > 0
    const hasSeriesId = typeof state?.mangaId === 'string' && state.mangaId.length > 0
    const isMangadex = state?.siteIntegrationId === 'mangadex'
    const hasChapters = Array.isArray(state?.chapters) && state.chapters.length > 0

    if (isMangadex && hasSeries && hasSeriesId && hasChapters) {
      return state
    }

    await context.pages()[0]?.waitForTimeout(500)
  }

  throw new Error(
    `Timed out waiting for live MangaDex state in tab_${tabId}. Last state: ${JSON.stringify(lastState)}`,
  )
}

test.describe('Live side panel UI smoke', () => {
  test('renders live side-panel action affordances on MangaDex', async ({ context, extensionId }) => {
    const page = await context.newPage()
    await page.goto(LIVE_MANGADEX_REFERENCE_URL, { waitUntil: 'domcontentloaded' })

    const tabId = await getTabId(page, context)
    const liveState = await waitForLiveTabState(context, tabId)

    const sidepanel = await openSidepanelHarness(context, extensionId, page)
    await expect(sidepanel.locator('#root')).toBeVisible()

    await expect(
      sidepanel.getByText(new RegExp(escapeForRegex(liveState.seriesTitle ?? ''), 'i')),
    ).toBeVisible({ timeout: 30_000 })
    await expect(sidepanel.getByRole('button', { name: /Select Chapters/i })).toBeVisible()
    await expect(sidepanel.getByRole('button', { name: /Open Options \(Advanced Settings\)/i })).toBeVisible()

    await sidepanel.close()
    await page.close()
  })

  test('expands the live inline selector and opens Options from the live side panel', async ({ context, extensionId }) => {
    const page = await context.newPage()
    await page.goto(LIVE_MANGADEX_REFERENCE_URL, { waitUntil: 'domcontentloaded' })

    const tabId = await getTabId(page, context)
    const liveState = await waitForLiveTabState(context, tabId)
    expect(Array.isArray(liveState.chapters)).toBe(true)
    expect((liveState.chapters ?? []).length).toBeGreaterThan(0)

    const sidepanel = await openSidepanelHarness(context, extensionId, page)
    await expect(sidepanel.locator('#root')).toBeVisible()

    await sidepanel.getByRole('button', { name: /Select Chapters/i }).click()
    await expect(sidepanel.getByRole('button', { name: /Close Selection/i })).toBeVisible({ timeout: 30_000 })

    const [optionsPage] = await Promise.all([
      context.waitForEvent('page'),
      sidepanel.getByRole('button', { name: /Open Options \(Advanced Settings\)/i }).click(),
    ])

    await optionsPage.waitForLoadState('domcontentloaded')
    await expect(optionsPage.getByText('Tako Manga Downloader Settings')).toBeVisible({ timeout: 10_000 })

    await optionsPage.close()
    await sidepanel.close()
    await page.close()
  })
})
