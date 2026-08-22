import type { BrowserContext, Page } from "@playwright/test"
import { expect } from "@playwright/test"
import { getSessionState, getTabId } from "../../e2e/fixtures/state-helpers"
import { resolveCandidateTabIds } from "./download-workflow-helpers"

export type LiveChapter = {
  id: string
  index: number
  title: string
  url: string
  locked?: boolean
  chapterLabel?: string
  chapterNumber?: number
  volumeId?: string
  volumeLabel?: string
  volumeNumber?: number
  language?: string
}

export type LiveVolume = {
  id: string
  title: string
  label?: string
}

export type LiveTabState = {
  siteIntegrationId?: string
  mangaId?: string
  seriesTitle?: string
  chapters?: LiveChapter[]
  volumes?: LiveVolume[]
  metadata?: { coverUrl?: string }
}

export function extractNumericValue(
  value: string | undefined
): number | undefined {
  if (typeof value !== "string") {
    return undefined
  }

  const match = value.match(/\d+(?:\.\d+)?/)
  if (!match) {
    return undefined
  }

  const parsed = Number(match[0])
  return Number.isFinite(parsed) ? parsed : undefined
}

export function hasNumericToken(value: string | undefined): boolean {
  return extractNumericValue(value) !== undefined
}

async function findReadyState(
  context: BrowserContext,
  candidateTabIds: number[],
  integrationId: string
): Promise<{ tabId: number; state: LiveTabState } | null> {
  for (const tabId of candidateTabIds) {
    const state = await getSessionState<LiveTabState>(context, `tab_${tabId}`)
    if (
      state &&
      state.siteIntegrationId === integrationId &&
      typeof state.mangaId === "string" &&
      state.mangaId.length > 0 &&
      typeof state.seriesTitle === "string" &&
      state.seriesTitle.length > 0 &&
      Array.isArray(state.chapters) &&
      state.chapters.length > 0
    ) {
      return { tabId, state }
    }
  }

  return null
}

export async function loadLiveTabState(
  context: BrowserContext,
  extensionId: string,
  page: Page,
  integrationId: string
): Promise<LiveTabState> {
  const optionsPage = await context.newPage()

  try {
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`, {
      waitUntil: "domcontentloaded",
    })

    const preferredTabId = await getTabId(page, context)
    const candidateTabIds = await resolveCandidateTabIds(
      optionsPage,
      preferredTabId,
      page.url()
    )
    expect(candidateTabIds.length).toBeGreaterThan(0)

    const timeoutMs = 30_000
    const pollMs = 500
    const start = Date.now()

    while (Date.now() - start < timeoutMs) {
      const ready = await findReadyState(
        context,
        candidateTabIds,
        integrationId
      )
      if (ready) {
        return ready.state
      }

      await page.waitForTimeout(pollMs)
    }

    throw new Error(
      `Timed out waiting for live ${integrationId} state from ${page.url()}`
    )
  } finally {
    await optionsPage.close()
  }
}

export function assertNumericChapterProjection(
  chapters: LiveChapter[],
  options: {
    minNumberedChapters: number
    expectedSampleNumber?: number
    expectedSampleLabel?: RegExp
    expectAnyVolumeNumbers: boolean | "if-present"
  }
): void {
  const numberedChapters = chapters.filter((chapter) => {
    const source =
      typeof chapter.chapterLabel === "string" &&
      chapter.chapterLabel.length > 0
        ? chapter.chapterLabel
        : chapter.title

    return hasNumericToken(source)
  })

  expect(numberedChapters.length).toBeGreaterThanOrEqual(
    options.minNumberedChapters
  )

  for (const chapter of numberedChapters.slice(0, 10)) {
    const source =
      typeof chapter.chapterLabel === "string" &&
      chapter.chapterLabel.length > 0
        ? chapter.chapterLabel
        : chapter.title
    expect(chapter.chapterNumber).toBe(extractNumericValue(source))
  }

  if (options.expectedSampleNumber !== undefined) {
    const sample = chapters.find(
      (chapter) => chapter.chapterNumber === options.expectedSampleNumber
    )
    expect(sample).toBeTruthy()
    expect(sample?.chapterNumber).toBe(options.expectedSampleNumber)

    if (options.expectedSampleLabel) {
      expect(
        options.expectedSampleLabel.test(
          sample?.chapterLabel ?? sample?.title ?? ""
        )
      ).toBe(true)
    }
  }

  const chaptersWithVolumeLabels = chapters.filter((chapter) =>
    hasNumericToken(chapter.volumeLabel)
  )

  if (options.expectAnyVolumeNumbers === "if-present") {
    for (const chapter of chaptersWithVolumeLabels.slice(0, 10)) {
      expect(chapter.volumeNumber).toBe(
        extractNumericValue(chapter.volumeLabel)
      )
    }
    return
  }

  if (options.expectAnyVolumeNumbers) {
    expect(chaptersWithVolumeLabels.length).toBeGreaterThan(0)
    for (const chapter of chaptersWithVolumeLabels.slice(0, 10)) {
      expect(chapter.volumeNumber).toBe(
        extractNumericValue(chapter.volumeLabel)
      )
    }
    return
  }

  expect(chaptersWithVolumeLabels.length).toBe(0)
  expect(chapters.some((chapter) => chapter.volumeNumber !== undefined)).toBe(
    false
  )
}
