import type { BrowserContext, Page } from "@playwright/test"

import { test, expect } from "../e2e/fixtures/extension"
import { getSessionState, getTabId } from "../e2e/fixtures/state-helpers"
import {
  LIVE_MANHUAGUI_ADULT_REFERENCE_URL,
  LIVE_MANHUAGUI_REFERENCE_URL,
  MANHUAGUI_BASE_URL,
} from "../e2e/fixtures/test-domains"
import { resolveCandidateTabIds } from "./fixtures/download-workflow-helpers"

type ManhuaguiLiveState = {
  siteIntegrationId?: string
  mangaId?: string
  chapters?: Array<{ id?: string; url?: string }>
}

async function loadManhuaguiState(
  context: BrowserContext,
  extensionId: string,
  page: Page,
  expectedMangaId: string,
  expectedChapterAvailability: "empty" | "non-empty"
): Promise<ManhuaguiLiveState> {
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

    let result: ManhuaguiLiveState | undefined
    await expect
      .poll(
        async () => {
          for (const tabId of candidateTabIds) {
            const state = await getSessionState<ManhuaguiLiveState>(
              context,
              `tab_${tabId}`
            )
            if (
              state?.siteIntegrationId !== "manhuagui" ||
              state.mangaId !== expectedMangaId ||
              !Array.isArray(state.chapters)
            ) {
              continue
            }

            const hasExpectedChapters =
              expectedChapterAvailability === "empty"
                ? state.chapters.length === 0
                : state.chapters.length > 0
            if (hasExpectedChapters) {
              result = state
              return true
            }
          }
          return false
        },
        {
          message: `waiting for Manhuagui ${expectedMangaId} ${expectedChapterAvailability} chapter state`,
          timeout: 30_000,
        }
      )
      .toBe(true)

    if (!result) {
      throw new Error(`Missing Manhuagui state for ${expectedMangaId}`)
    }
    return result
  } finally {
    await optionsPage.close()
  }
}

async function clearAdultConsent(context: BrowserContext): Promise<void> {
  await context.clearCookies()
  expect(
    (await context.cookies(MANHUAGUI_BASE_URL)).some(
      (cookie) => cookie.name === "isAdult"
    )
  ).toBe(false)
}

async function grantAdultConsent(context: BrowserContext): Promise<void> {
  await context.addCookies([
    {
      name: "isAdult",
      value: "1",
      domain: ".manhuagui.com",
      path: "/",
      secure: true,
      sameSite: "Lax",
    },
  ])
  expect(
    (await context.cookies(MANHUAGUI_BASE_URL)).some(
      (cookie) => cookie.name === "isAdult" && cookie.value === "1"
    )
  ).toBe(true)
}

test.describe("Manhuagui adult-gate cookie behavior (live)", () => {
  test("non-adult comic exposes chapters without adult consent", async ({
    context,
    extensionId,
    page,
  }) => {
    await clearAdultConsent(context)
    await page.goto(LIVE_MANHUAGUI_REFERENCE_URL, {
      waitUntil: "domcontentloaded",
    })

    await expect(page.locator(".chapter-list").first()).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.locator("#checkAdult")).toHaveCount(0)
    const state = await loadManhuaguiState(
      context,
      extensionId,
      page,
      "19430",
      "non-empty"
    )
    expect(state.chapters?.length).toBeGreaterThan(0)
  })

  test("adult comic exposes no chapters without adult consent", async ({
    context,
    extensionId,
    page,
  }) => {
    await clearAdultConsent(context)
    await page.goto(LIVE_MANHUAGUI_ADULT_REFERENCE_URL, {
      waitUntil: "domcontentloaded",
    })

    await expect(page.locator("#checkAdult")).toBeVisible({ timeout: 15_000 })
    const state = await loadManhuaguiState(
      context,
      extensionId,
      page,
      "21243",
      "empty"
    )
    expect(state.chapters).toEqual([])
  })

  test("adult comic exposes chapters when the harness grants consent", async ({
    context,
    extensionId,
    page,
  }) => {
    await grantAdultConsent(context)
    await page.goto(LIVE_MANHUAGUI_ADULT_REFERENCE_URL, {
      waitUntil: "domcontentloaded",
    })

    await expect(page.locator(".chapter-list").first()).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.locator("#checkAdult")).toHaveCount(0)
    const state = await loadManhuaguiState(
      context,
      extensionId,
      page,
      "21243",
      "non-empty"
    )
    expect(state.chapters?.length).toBeGreaterThan(0)
    expect(
      state.chapters?.every((chapter) =>
        chapter.url?.startsWith(`${MANHUAGUI_BASE_URL}/comic/21243/`)
      )
    ).toBe(true)
  })
})
