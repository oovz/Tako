import { test, expect } from "./fixtures/extension"
import {
  openSidepanelHarness,
  setDownloadedChapterHistory,
} from "./fixtures/state-helpers"
import {
  buildExampleUrl,
  buildMangadexUrl,
  MANGADEX_ORDER_TEST_SERIES_ID,
} from "./fixtures/test-domains-constants"
import {
  makeChapter,
  makeTask,
  openTaskFeedback,
  seedGlobalQueue,
} from "./fixtures/queue-test-helpers"
import type { DownloadTaskState } from "../../src/domain/queue/state"
import { MANGADEX_UPLOADS_BASE_URL } from "./fixtures/mock-data/site-integrations/mangadex/image-fixtures"

const exampleRootUrl = buildExampleUrl("/")

test.describe("Queue rendering", () => {
  test("shows friendly empty state on non-manga tab with no tasks", async ({
    context,
    extensionId,
    page,
  }) => {
    await page.goto(exampleRootUrl, { waitUntil: "domcontentloaded" })

    await seedGlobalQueue(context, [])

    const sp = await openSidepanelHarness(context, extensionId, page)
    await sp.setViewportSize({ width: 360, height: 720 })

    await expect(
      sp.getByText("Open a supported manga series page to get started.")
    ).toBeVisible()
    await expect(sp.getByText("No active downloads.")).toBeVisible()
  })

  test("renders the active task cover in Queue", async ({
    context,
    extensionId,
    page,
  }) => {
    await page.goto(exampleRootUrl, { waitUntil: "domcontentloaded" })

    const now = Date.now()
    const coverUrl = `${MANGADEX_UPLOADS_BASE_URL}/covers/covered-series/cover.png`
    const tasks: DownloadTaskState[] = [
      makeTask({
        id: "covered-task",
        seriesTitle: "Covered Series",
        status: "downloading",
        created: now - 1000,
        seriesCoverUrl: coverUrl,
        chapters: [
          makeChapter(buildExampleUrl("/covered-chapter"), "downloading"),
        ],
      }),
    ]

    await seedGlobalQueue(context, tasks)

    const sp = await openSidepanelHarness(context, extensionId, page)
    const cover = sp.locator('[data-task-id="covered-task"] img')
    await expect(cover).toHaveAttribute("src", /^blob:/)
    await expect(cover).toHaveJSProperty("naturalWidth", 1)
  })

  test("renders global queue and header summary for active and queued tasks with recent history", async ({
    context,
    extensionId,
    page,
  }) => {
    await page.goto(exampleRootUrl, { waitUntil: "domcontentloaded" })

    const now = Date.now()
    const tasks: DownloadTaskState[] = [
      makeTask({
        id: "active-task",
        seriesTitle: "Active Series",
        status: "downloading",
        created: now - 5000,
        chapters: [makeChapter(buildExampleUrl("/c1"), "downloading")],
      }),
      makeTask({
        id: "queued-1",
        seriesTitle: "Queued One",
        status: "queued",
        created: now - 4000,
        chapters: [makeChapter(buildExampleUrl("/c2"), "queued")],
      }),
      makeTask({
        id: "queued-2",
        seriesTitle: "Queued Two",
        status: "queued",
        created: now - 3000,
        chapters: [makeChapter(buildExampleUrl("/c3"), "queued")],
      }),
      makeTask({
        id: "failed-1",
        seriesTitle: "Failed One",
        status: "failed",
        created: now - 9000,
        completed: now - 8500,
        errorCategory: "network_unavailable",
        errorMessage: "Network error",
        chapters: [
          {
            ...makeChapter(buildExampleUrl("/c5"), "failed"),
            errorCategory: "network_unavailable",
            errorMessage: "Network error",
          },
        ],
      }),
    ]

    await seedGlobalQueue(context, tasks)
    await setDownloadedChapterHistory(context, [
      {
        siteIntegrationId: "mangadex",
        seriesId: MANGADEX_ORDER_TEST_SERIES_ID,
        seriesTitle: "Completed One",
        chapterId: "saved-chapter",
        url: buildMangadexUrl("/chapter/saved-chapter"),
        title: "Saved chapter",
        downloadedAt: now - 7000,
        saveConfirmedAt: now - 7000,
        outputDestination: "downloads-api",
        format: "cbz",
      },
    ])

    const sp = await openSidepanelHarness(context, extensionId, page)
    await sp.setViewportSize({ width: 360, height: 720 })
    await expect(sp.getByText("Active Series")).toBeVisible()
    await expect(sp.getByText(/1\s*active/)).toBeVisible()
    await expect(sp.getByText(/2\s*queued/)).toBeVisible()
    await expect(sp.getByText("Queued One")).toBeVisible()
    await expect(sp.getByText("Queued Two")).toBeVisible()
    await expect(sp.getByText("Failed One")).toBeVisible()
    const feedback = await openTaskFeedback(
      sp.locator('[data-task-id="failed-1"]')
    )
    await expect(
      feedback.getByText("The network connection is unavailable.")
    ).toBeVisible()
    await expect(sp.getByText("Network error")).toHaveCount(0)
    await sp.getByRole("tab", { name: "Recent" }).click()
    await expect(sp.getByText("Completed One")).toBeVisible()
    await expect(sp.getByText("Saved chapter")).toBeVisible()
    expect(
      await sp.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    ).toBe(true)
  })
})
