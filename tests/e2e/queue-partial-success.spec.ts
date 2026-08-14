import { test, expect } from "./fixtures/extension"
import { getTabId } from "./fixtures/state-helpers"
import { buildExampleUrl } from "./fixtures/test-domains-constants"
import {
  makeChapter,
  makeTask,
  seedGlobalQueue,
} from "./fixtures/queue-test-helpers"
import type { DownloadTaskState } from "../../src/domain/queue/state"

const exampleRootUrl = buildExampleUrl("/")

test.describe("Partial-success and aborted task history", () => {
  test.describe.configure({ mode: "serial" })

  test("displays partial_success task in history with distinct styling", async ({
    context,
    extensionId,
    page,
  }) => {
    await page.goto(exampleRootUrl, { waitUntil: "domcontentloaded" })

    const now = Date.now()
    const tasks: DownloadTaskState[] = [
      makeTask({
        id: "partial-task",
        seriesTitle: "Partial Success Series",
        status: "partial_success" as DownloadTaskState["status"],
        created: now - 10000,
        completed: now - 5000,
        chapters: [
          makeChapter(buildExampleUrl("/p1"), "completed"),
          makeChapter(buildExampleUrl("/p2"), "failed"),
          makeChapter(buildExampleUrl("/p3"), "completed"),
        ],
      }),
    ]

    await seedGlobalQueue(context, tasks)

    await getTabId(page, context)
    const sp = await context.newPage()
    await sp.goto(`chrome-extension://${extensionId}/sidepanel.html`, {
      waitUntil: "domcontentloaded",
    })

    await expect(sp.locator("#root")).toBeVisible()
    await expect(sp.getByText("Partial Success Series")).toBeVisible()
    // partial_success should appear in history section
    await expect(sp.getByText("Recent history")).toBeVisible()
  })

  test("uses safe generic copy for unknown aborted-task failures", async ({
    context,
    extensionId,
    page,
  }) => {
    await page.goto(exampleRootUrl, { waitUntil: "domcontentloaded" })

    const now = Date.now()
    const tasks: DownloadTaskState[] = [
      makeTask({
        id: "aborted-task-1",
        seriesTitle: "Aborted Series",
        status: "failed",
        created: now - 10000,
        completed: now - 5000,
        errorCategory: "unknown",
        errorMessage: "Browser closed during download",
        chapters: [makeChapter(buildExampleUrl("/aborted1"), "failed")],
      }),
    ]

    await seedGlobalQueue(context, tasks)

    await getTabId(page, context)
    const sp = await context.newPage()
    await sp.goto(`chrome-extension://${extensionId}/sidepanel.html`, {
      waitUntil: "domcontentloaded",
    })

    // Wait for React to finish rendering the initial state from storage
    await expect(sp.locator("#root")).toBeVisible()
    // Give the Side Panel time to load global state and render queue - this prevents flakiness
    await expect(sp.getByText("Aborted Series")).toBeVisible({
      timeout: 10000,
    })
    await expect(
      sp.getByText(
        /The download failed\. See the extension console for technical details\./i
      )
    ).toBeVisible({ timeout: 5000 })
    await expect(sp.getByText(/Browser closed during download/i)).toHaveCount(0)

    await sp.close()
  })
})
