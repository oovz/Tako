import { test, expect } from '../e2e/fixtures/extension'
import { getTabId, getSessionState } from '../e2e/fixtures/state-helpers'
import {
  LIVE_MANGADEX_REFERENCE_URL,
  LIVE_PIXIV_COMIC_REFERENCE_URL,
  LIVE_PIXIV_COMIC_DUPLICATE_TITLE_URL,
  LIVE_PIXIV_COMIC_DUAL_TITLE_URL,
  LIVE_SHONENJUMPPLUS_REFERENCE_URL,
} from '../e2e/fixtures/test-domains'
import type { BrowserContext, Page } from '@playwright/test'

type LiveChapter = {
  id?: string
  title?: string
  chapterLabel?: string
  chapterNumber?: number
  volumeLabel?: string
  volumeNumber?: number
}

type LiveTabState = {
  siteIntegrationId?: string
  mangaId?: string
  seriesTitle?: string
  chapters?: LiveChapter[]
}

function extractNumericValue(value: string | undefined): number | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const match = value.match(/\d+(?:\.\d+)?/)
  if (!match) {
    return undefined
  }

  const parsed = Number(match[0])
  return Number.isFinite(parsed) ? parsed : undefined
}

function hasNumericToken(value: string | undefined): boolean {
  return extractNumericValue(value) !== undefined
}

async function resolveCandidateTabIds(
  optionsPage: Page,
  preferredTabId: number,
  targetHref: string,
): Promise<number[]> {
  return await optionsPage.evaluate(
    async ({ preferredTabId: preferredId, targetHref: href }: { preferredTabId: number; targetHref: string }) => {
      const target = new URL(href)
      const allTabs = await chrome.tabs.query({})

      const urlMatchedIds = allTabs
        .filter((tab) => {
          if (typeof tab.id !== 'number' || !tab.url) {
            return false
          }

          try {
            const url = new URL(tab.url)
            if (url.hostname !== target.hostname) {
              return false
            }

            if (url.pathname === target.pathname) {
              return true
            }

            return url.pathname.startsWith(target.pathname) || target.pathname.startsWith(url.pathname)
          } catch {
            return false
          }
        })
        .map((tab) => tab.id as number)

      return [preferredId, ...urlMatchedIds].filter(
        (id, index, arr): id is number => typeof id === 'number' && arr.indexOf(id) === index,
      )
    },
    { preferredTabId, targetHref },
  )
}

async function reinjectContentScript(optionsPage: Page, candidateTabIds: number[]): Promise<void> {
  await optionsPage.evaluate(async (ids: number[]) => {
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

    for (const tabId of ids) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            files: ['content-scripts/content.js'],
          })
          break
        } catch {
          await wait(750)
        }
      }
    }
  }, candidateTabIds)
}

async function findReadyState(
  context: BrowserContext,
  candidateTabIds: number[],
  integrationId: string,
): Promise<{ tabId: number; state: LiveTabState } | null> {
  for (const tabId of candidateTabIds) {
    const state = await getSessionState<LiveTabState>(context, `tab_${tabId}`)
    if (
      state
      && state.siteIntegrationId === integrationId
      && typeof state.mangaId === 'string'
      && state.mangaId.length > 0
      && typeof state.seriesTitle === 'string'
      && state.seriesTitle.length > 0
      && Array.isArray(state.chapters)
      && state.chapters.length > 0
    ) {
      return { tabId, state }
    }
  }

  return null
}

async function loadLiveTabState(
  context: BrowserContext,
  extensionId: string,
  page: Page,
  integrationId: string,
): Promise<LiveTabState> {
  const optionsPage = await context.newPage()

  try {
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'domcontentloaded' })

    const preferredTabId = await getTabId(page, context)
    const candidateTabIds = await resolveCandidateTabIds(optionsPage, preferredTabId, page.url())
    expect(candidateTabIds.length).toBeGreaterThan(0)

    await reinjectContentScript(optionsPage, candidateTabIds)

    const timeoutMs = 75_000
    const pollMs = 500
    const maxReinitBursts = 2
    const start = Date.now()
    let reinitBursts = 0

    while (Date.now() - start < timeoutMs) {
      const ready = await findReadyState(context, candidateTabIds, integrationId)
      if (ready) {
        return ready.state
      }

      const elapsed = Date.now() - start
      if (reinitBursts < maxReinitBursts && elapsed > (reinitBursts + 1) * 10_000) {
        await reinjectContentScript(optionsPage, candidateTabIds)
        reinitBursts += 1
      }

      await page.waitForTimeout(pollMs)
    }

    throw new Error(`Timed out waiting for live ${integrationId} state from ${page.url()}`)
  } finally {
    await optionsPage.close()
  }
}

function assertNumericChapterProjection(
  chapters: LiveChapter[],
  options: {
    minNumberedChapters: number
    expectedSampleNumber?: number
    expectedSampleLabel?: RegExp
    expectAnyVolumeNumbers: boolean
  },
): void {
  const numberedChapters = chapters.filter((chapter) => {
    const source = typeof chapter.chapterLabel === 'string' && chapter.chapterLabel.length > 0
      ? chapter.chapterLabel
      : chapter.title

    return hasNumericToken(source)
  })

  expect(numberedChapters.length).toBeGreaterThanOrEqual(options.minNumberedChapters)

  for (const chapter of numberedChapters.slice(0, 10)) {
    const source = typeof chapter.chapterLabel === 'string' && chapter.chapterLabel.length > 0
      ? chapter.chapterLabel
      : chapter.title
    expect(chapter.chapterNumber).toBe(extractNumericValue(source))
  }

  if (options.expectedSampleNumber !== undefined) {
    const sample = chapters.find((chapter) => chapter.chapterNumber === options.expectedSampleNumber)
    expect(sample).toBeTruthy()
    expect(sample?.chapterNumber).toBe(options.expectedSampleNumber)

    if (options.expectedSampleLabel) {
      expect(options.expectedSampleLabel.test(sample?.chapterLabel ?? sample?.title ?? '')).toBe(true)
    }
  }

  const chaptersWithVolumeLabels = chapters.filter((chapter) => hasNumericToken(chapter.volumeLabel))

  if (options.expectAnyVolumeNumbers) {
    expect(chaptersWithVolumeLabels.length).toBeGreaterThan(0)
    for (const chapter of chaptersWithVolumeLabels.slice(0, 10)) {
      expect(chapter.volumeNumber).toBe(extractNumericValue(chapter.volumeLabel))
    }
    return
  }

  expect(chaptersWithVolumeLabels.length).toBe(0)
  expect(chapters.some((chapter) => chapter.volumeNumber !== undefined)).toBe(false)
}

test.describe('Live numeric metadata extraction', () => {
  test('extracts chapter and volume numbers from live MangaDex state', async ({ context, extensionId }) => {
    const page = await context.newPage()
    await page.goto(LIVE_MANGADEX_REFERENCE_URL, { waitUntil: 'domcontentloaded' })

    const state = await loadLiveTabState(context, extensionId, page, 'mangadex')
    expect(state.siteIntegrationId).toBe('mangadex')
    expect(Array.isArray(state.chapters)).toBe(true)

    assertNumericChapterProjection(state.chapters ?? [], {
      minNumberedChapters: 5,
      expectedSampleNumber: 1,
      expectedSampleLabel: /^1$/,
      expectAnyVolumeNumbers: true,
    })

    await page.close()
  })

  test('extracts chapter numbers and preserves absent volume numbers from live Pixiv Comic state', async ({ context, extensionId }) => {
    const page = await context.newPage()
    await page.goto(LIVE_PIXIV_COMIC_REFERENCE_URL, { waitUntil: 'domcontentloaded' })

    const state = await loadLiveTabState(context, extensionId, page, 'pixiv-comic')
    expect(state.siteIntegrationId).toBe('pixiv-comic')
    expect(Array.isArray(state.chapters)).toBe(true)

    assertNumericChapterProjection(state.chapters ?? [], {
      minNumberedChapters: 3,
      expectedSampleNumber: 34,
      expectedSampleLabel: /第\s*34\s*話/,
      expectAnyVolumeNumbers: false,
    })

    await page.close()
  })

  test('preserves duplicate Pixiv chapter titles as separate live chapters across arcs', async ({ context, extensionId }) => {
    const page = await context.newPage()
    await page.goto(LIVE_PIXIV_COMIC_DUPLICATE_TITLE_URL, { waitUntil: 'domcontentloaded' })

    const state = await loadLiveTabState(context, extensionId, page, 'pixiv-comic')
    const chapters = state.chapters ?? []

    const duplicateFirstChapters = chapters.filter((chapter) => chapter.title === '第1話')
    expect(duplicateFirstChapters.length).toBeGreaterThanOrEqual(2)
    expect(new Set(duplicateFirstChapters.map((chapter) => chapter.id)).size).toBe(duplicateFirstChapters.length)
    expect(duplicateFirstChapters.every((chapter) => chapter.chapterNumber === 1)).toBe(true)

    await page.close()
  })

  test('combines Pixiv numbering and subtitle while extracting full-width live chapter numerals', async ({ context, extensionId }) => {
    const page = await context.newPage()
    await page.goto(LIVE_PIXIV_COMIC_DUAL_TITLE_URL, { waitUntil: 'domcontentloaded' })

    const state = await loadLiveTabState(context, extensionId, page, 'pixiv-comic')
    const chapters = state.chapters ?? []

    const firstChapter = chapters.find((chapter) => chapter.id === '68314')
    expect(firstChapter).toBeTruthy()
    expect(firstChapter?.chapterLabel).toBe('第１話')
    expect(firstChapter?.title).toBe('第１話 岡野部長は友達がいない(1)')
    expect(firstChapter?.chapterNumber).toBe(1)

    await page.close()
  })

  test('extracts chapter numbers and preserves absent volume numbers from live Shonen Jump+ state', async ({ context, extensionId }) => {
    const page = await context.newPage()
    await page.goto(LIVE_SHONENJUMPPLUS_REFERENCE_URL, { waitUntil: 'domcontentloaded' })

    const state = await loadLiveTabState(context, extensionId, page, 'shonenjumpplus')
    expect(state.siteIntegrationId).toBe('shonenjumpplus')
    expect(Array.isArray(state.chapters)).toBe(true)

    assertNumericChapterProjection(state.chapters ?? [], {
      minNumberedChapters: 3,
      expectedSampleNumber: 1,
      expectedSampleLabel: /(?:^|\[|第)\s*1\s*話(?:$|\])?/,
      expectAnyVolumeNumbers: false,
    })

    await page.close()
  })
})
