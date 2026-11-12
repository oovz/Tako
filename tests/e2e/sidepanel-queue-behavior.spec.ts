import { test, expect } from "./fixtures/extension"
import {
  getSessionState,
  getTabId,
  openSidepanelHarness,
  waitForGlobalState,
} from "./fixtures/state-helpers"
import {
  getExtensionWorker,
  makeChapter,
  makeTask,
  openTaskFeedback,
  seedGlobalQueue,
} from "./fixtures/queue-test-helpers"
import { buildExampleUrl } from "./fixtures/test-domains-constants"
import type { DownloadTaskState } from "../../src/domain/queue/state"

const exampleRootUrl = buildExampleUrl("/")

test.describe("Side panel queue behavior", () => {
  test.describe.configure({ mode: "serial" })

  test("queued-task cancel is immediate and preserves the active task", async ({
    context,
    extensionId,
    page,
  }) => {
    await page.goto(exampleRootUrl, { waitUntil: "domcontentloaded" })

    const now = Date.now()
    const tasks: DownloadTaskState[] = [
      makeTask({
        id: "active-task-spec",
        seriesTitle: "Active Task Spec",
        status: "downloading",
        created: now - 5000,
        chapters: [makeChapter(buildExampleUrl("/active-spec"), "downloading")],
      }),
      makeTask({
        id: "queued-task-spec",
        seriesTitle: "Queued Task Spec",
        status: "queued",
        created: now - 4000,
        chapters: [makeChapter(buildExampleUrl("/queued-spec"), "queued")],
      }),
    ]

    await seedGlobalQueue(context, tasks)
    await getTabId(page, context)

    const sp = await openSidepanelHarness(context, extensionId, page)
    await expect(sp.locator("#root")).toBeVisible()
    await expect(sp.getByText("Queued Task Spec")).toBeVisible()

    const queuedTaskRow = sp
      .getByRole("heading", { name: "Queued Task Spec" })
      .locator(
        "xpath=ancestor::div[.//button[@aria-label='Cancel download']][1]"
      )
    await queuedTaskRow.getByRole("button", { name: "Cancel download" }).click()

    await waitForGlobalState(context, (state) => {
      const activeTask = state.downloadQueue.find(
        (task) => task.id === "active-task-spec"
      )
      const queuedTask = state.downloadQueue.find(
        (task) => task.id === "queued-task-spec"
      )
      return activeTask?.status === "downloading" && queuedTask === undefined
    })

    await expect(sp.getByText(/1\s*active/)).toBeVisible()
    await sp.close()
  })

  test("keeps cancellation out of Queue and allows a fresh restart from Activity", async ({
    context,
    extensionId,
    page,
  }) => {
    await page.goto(exampleRootUrl, { waitUntil: "domcontentloaded" })

    const now = Date.now()
    const chapterUrls = [
      buildExampleUrl("/restart-spec-1"),
      buildExampleUrl("/restart-spec-2"),
      buildExampleUrl("/restart-spec-3"),
    ]
    const tasks: DownloadTaskState[] = [
      makeTask({
        id: "canceled-task-spec",
        mangaId: "mangadex:restart-series",
        seriesTitle: "Restartable Series",
        status: "canceled",
        created: now - 8000,
        completed: now - 7000,
        chapters: [
          makeChapter(chapterUrls[0], "completed"),
          makeChapter(chapterUrls[1], "failed"),
          makeChapter(chapterUrls[2], "queued"),
        ],
      }),
    ]

    await getTabId(page, context)
    await seedGlobalQueue(context, tasks)
    await expect
      .poll(async () => {
        const worker = await getExtensionWorker(context)
        const historyView = await worker.evaluate(async () => {
          const result = (await chrome.storage.session.get("historyView")) as {
            historyView?: Array<{ seriesTitle?: string; status?: string }>
          }
          return result.historyView
        })
        return (
          historyView?.some(
            (task) =>
              task.seriesTitle === "Restartable Series" &&
              task.status === "canceled"
          ) ?? false
        )
      })
      .toBe(true)

    const sp = await context.newPage()
    await sp.goto(`chrome-extension://${extensionId}/sidepanel.html`, {
      waitUntil: "domcontentloaded",
    })
    await expect(sp.getByRole("heading", { name: "In progress" })).toBeVisible()
    await expect(sp.getByText("Restartable Series")).toHaveCount(0)
    const activity = await context.newPage()
    await activity.goto(
      `chrome-extension://${extensionId}/options.html?tab=activity`
    )
    const canceledCard = activity.locator(".options-task-card", {
      hasText: "Restartable Series",
    })
    await canceledCard.getByRole("button", { name: "Restart task" }).click()

    await waitForGlobalState(context, (state) => {
      const original = state.downloadQueue.find(
        (task) => task.id === "canceled-task-spec"
      )
      if (!original?.isRetried) return false

      const restartTask = state.downloadQueue.find(
        (task) =>
          task.mangaId === "mangadex:restart-series" &&
          task.isRetryTask === true
      )
      if (!restartTask) return false

      return (
        restartTask.chapters.length === chapterUrls.length &&
        restartTask.isRetried === false &&
        chapterUrls.every((url) =>
          restartTask.chapters.some((chapter) => chapter.url === url)
        )
      )
    })

    await activity.close()
    await sp.close()
  })

  test("the bounded Queue recovery view backfills after a row is dismissed", async ({
    context,
    extensionId,
    page,
  }) => {
    await page.goto(exampleRootUrl, { waitUntil: "domcontentloaded" })

    const now = Date.now()
    const historyTasks: DownloadTaskState[] = Array.from(
      { length: 6 },
      (_, index) => {
        const position = index + 1
        return makeTask({
          id: `history-task-${position}`,
          seriesTitle: `History Task ${position}`,
          status: "failed",
          created: now - (position + 10) * 1000,
          started: now - (position + 8) * 1000,
          completed: now - position * 1000,
          chapters: [
            makeChapter(buildExampleUrl(`/history-${position}`), "failed"),
          ],
        })
      }
    )

    await getTabId(page, context)
    await seedGlobalQueue(context, historyTasks)

    await expect
      .poll(async () => {
        const historyView = await getSessionState<
          Array<{ seriesTitle?: string; status?: string }>
        >(context, "historyView")
        return (
          historyView
            ?.filter((task) => task.status === "failed")
            .map((task) => task.seriesTitle)
            .slice(0, 5) ?? []
        )
      })
      .toEqual([
        "History Task 1",
        "History Task 2",
        "History Task 3",
        "History Task 4",
        "History Task 5",
      ])

    const sp = await context.newPage()
    await sp.goto(`chrome-extension://${extensionId}/sidepanel.html`, {
      waitUntil: "domcontentloaded",
    })
    await expect(sp.locator("#root")).toBeVisible()
    await expect(sp.getByText("History Task 1")).toBeVisible({
      timeout: 15000,
    })
    await expect(sp.getByText("History Task 5")).toBeVisible()
    await expect(sp.getByText("History Task 6")).toHaveCount(0)

    const firstHistoryTaskRow = sp.locator('[data-task-id="history-task-1"]')
    const feedback = await openTaskFeedback(firstHistoryTaskRow)
    await feedback.getByRole("button", { name: "Dismiss" }).click()

    await waitForGlobalState(
      context,
      (state) =>
        !state.downloadQueue.some((task) => task.id === "history-task-1")
    )
    await expect(sp.getByText("History Task 6")).toBeVisible({
      timeout: 15000,
    })
    await sp.close()
  })

  test("View Full History focuses an existing options tab and opens Activity", async ({
    context,
    extensionId,
    page,
  }) => {
    await page.goto(exampleRootUrl, { waitUntil: "domcontentloaded" })

    const now = Date.now()
    const tasks: DownloadTaskState[] = [
      makeTask({
        id: "history-link-task",
        seriesTitle: "History Link Task",
        status: "completed",
        created: now - 4000,
        completed: now - 2000,
        chapters: [makeChapter(buildExampleUrl("/history-link"), "completed")],
      }),
    ]

    await getTabId(page, context)
    await seedGlobalQueue(context, tasks)

    await expect
      .poll(async () => {
        const historyView = await getSessionState<
          Array<{ seriesTitle?: string; status?: string }>
        >(context, "historyView")
        return (
          historyView?.some(
            (task) =>
              task.seriesTitle === "History Link Task" &&
              task.status === "completed"
          ) ?? false
        )
      })
      .toBe(true)

    const existingOptionsPage = await context.newPage()
    await existingOptionsPage.goto(
      `chrome-extension://${extensionId}/options.html?tab=general`,
      {
        waitUntil: "domcontentloaded",
      }
    )
    await expect(
      existingOptionsPage.getByRole("button", { name: "General" })
    ).toBeVisible()

    const sp = await context.newPage()
    await sp.goto(`chrome-extension://${extensionId}/sidepanel.html`, {
      waitUntil: "domcontentloaded",
    })
    await expect(sp.locator("#root")).toBeVisible()
    await sp.getByRole("tab", { name: "Recent" }).click()
    await expect(
      sp.getByRole("button", { name: "View history in Options" })
    ).toBeVisible({ timeout: 15000 })

    await sp.getByRole("button", { name: "View history in Options" }).click()

    await expect
      .poll(() => existingOptionsPage.url())
      .toContain("options.html?tab=activity")
    await expect(
      existingOptionsPage.getByRole("button", { name: /Activity/i })
    ).toBeVisible()
    await expect(
      existingOptionsPage.getByText("Active Downloads", { exact: true })
    ).toBeVisible()
    await sp.close()
    await existingOptionsPage.close()
  })
})
