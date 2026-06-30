import { test, expect } from '../e2e/fixtures/extension'
import { getTabId, getSessionState } from '../e2e/fixtures/state-helpers'
import {
  LIVE_MANGADEX_REFERENCE_URL,
  LIVE_MANHUAGUI_REFERENCE_URL,
  LIVE_PIXIV_COMIC_REFERENCE_URL,
  LIVE_PIXIV_COMIC_DUPLICATE_TITLE_URL,
  LIVE_PIXIV_COMIC_DUAL_TITLE_URL,
  LIVE_SHONENJUMPPLUS_REFERENCE_URL,
} from '../e2e/fixtures/test-domains'
import { resolveCandidateTabIds, reinjectContentScript } from './fixtures/download-workflow-helpers'
import type { BrowserContext, Page } from '@playwright/test'

type LiveChapter = {
  id?: string
  title?: string
  chapterLabel?: string
  chapterNumber?: number
  volumeId?: string
  volumeLabel?: string
  volumeNumber?: number
}

type LiveVolume = {
  id?: string
  title?: string
  label?: string
}

type LiveTabState = {
  siteIntegrationId?: string
  mangaId?: string
  seriesTitle?: string
  chapters?: LiveChapter[]
  volumes?: LiveVolume[]
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

    const timeoutMs = 30_000
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
    expectAnyVolumeNumbers: boolean | 'if-present'
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

  if (options.expectAnyVolumeNumbers === 'if-present') {
    // Validate volume numbers only when volume labels are present;
    // the live site may not always expose volume data for a given series.
    for (const chapter of chaptersWithVolumeLabels.slice(0, 10)) {
      expect(chapter.volumeNumber).toBe(extractNumericValue(chapter.volumeLabel))
    }
    return
  }

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
      expectAnyVolumeNumbers: 'if-present',
    })

    // Relative assertion: at least one chapter has a parsed chapterNumber >= 0,
    // replacing brittle hardcoded expectedSampleNumber/expectedSampleLabel checks
    // that assumed a specific chapter number and label format on the live site.
    const parsedChapters = (state.chapters ?? []).filter(
      (chapter) => typeof chapter.chapterNumber === 'number' && chapter.chapterNumber >= 0,
    )
    expect(parsedChapters.length).toBeGreaterThan(0)

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
      expectAnyVolumeNumbers: false,
    })

    await page.close()
  })

  test('preserves duplicate Pixiv chapter titles as separate live chapters across arcs', async ({ context, extensionId }) => {
    const page = await context.newPage()
    await page.goto(LIVE_PIXIV_COMIC_DUPLICATE_TITLE_URL, { waitUntil: 'domcontentloaded' })

    const state = await loadLiveTabState(context, extensionId, page, 'pixiv-comic')
    const chapters = state.chapters ?? []

    // Canary: hardcoded chapter title — essential to this test's purpose
    // (verifying duplicate titles are preserved as separate chapters).
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

    // Canary: hardcoded chapter ID and label — essential to this test's purpose
    // (verifying full-width numeral extraction and title/subtitle combination).
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
      expectAnyVolumeNumbers: false,
    })

    // Relative assertion: at least one chapter has a parsed chapterNumber >= 0,
    // replacing brittle hardcoded expectedSampleNumber/expectedSampleLabel checks.
    const parsedChapters = (state.chapters ?? []).filter(
      (chapter) => typeof chapter.chapterNumber === 'number' && chapter.chapterNumber >= 0,
    )
    expect(parsedChapters.length).toBeGreaterThan(0)

    await page.close()
  })

  test('preserves Manhuagui category headings as explicit live volumes', async ({ context, extensionId }) => {
    const page = await context.newPage()
    await page.goto(LIVE_MANHUAGUI_REFERENCE_URL, { waitUntil: 'domcontentloaded' })

    const state = await loadLiveTabState(context, extensionId, page, 'manhuagui')
    expect(state.siteIntegrationId).toBe('manhuagui')
    expect(Array.isArray(state.chapters)).toBe(true)
    expect(Array.isArray(state.volumes)).toBe(true)

    // Canary: hardcoded volume titles and chapter labels — essential to this
    // test's purpose (verifying Manhuagui category headings are preserved as
    // explicit volumes with correct chapter groupings).
    const volumes = state.volumes ?? []
    const volumeTitles = volumes.map((volume) => volume.title ?? volume.label)
    expect(volumeTitles).toEqual(['单行本', '单话', '番外篇'])

    for (const title of ['单行本', '番外篇', '单话']) {
      const volume = volumes.find((candidate) => candidate.title === title || candidate.label === title)
      expect(volume?.id).toBeTruthy()
      const chaptersInVolume = (state.chapters ?? []).filter((chapter) => chapter.volumeId === volume?.id)
      expect(chaptersInVolume.length).toBeGreaterThan(0)
      expect(chaptersInVolume.every((chapter) => chapter.volumeLabel === title)).toBe(true)
      expect(chaptersInVolume.every((chapter) => chapter.volumeNumber === undefined)).toBe(true)
    }

    const singleTalkVolume = volumes.find((volume) => volume.title === '单话' || volume.label === '单话')
    const firstSingleTalkChapter = (state.chapters ?? []).find((chapter) => chapter.volumeId === singleTalkVolume?.id)
    expect(firstSingleTalkChapter).toMatchObject({
      title: '第01回',
      chapterLabel: '第01回',
      volumeLabel: '单话',
    })
    expect(firstSingleTalkChapter?.title).not.toContain('54p')

    await page.close()
  })
})
