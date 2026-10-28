import { test, expect } from "./fixtures/extension"
import { buildExampleUrl } from "./fixtures/test-domains-constants"
import { waitForGlobalState } from "./fixtures/state-helpers"
import {
  makeChapter,
  makeTask,
  seedGlobalQueue,
} from "./fixtures/queue-test-helpers"

test("offers an interrupted handoff retry with a duplicate warning and fresh accounting", async ({
  context,
  extensionId,
  page,
}) => {
  const now = Date.now()
  const interrupted = makeTask({
    id: "interrupted-handoff",
    seriesTitle: "Interrupted chapter",
    status: "failed",
    errorCategory: "browser_handoff_interrupted",
    created: now - 1000,
    completed: now,
    chapters: [
      {
        ...makeChapter(buildExampleUrl("/uncertain-chapter"), "failed"),
        errorCategory: "browser_handoff_interrupted",
        outputs: { requested: 1, committed: 0, failed: 1 },
        nativeOutputSettlement: {
          jobId: "interrupted-job",
          attempt: 1,
          taskId: "interrupted-handoff",
          chapterId: buildExampleUrl("/uncertain-chapter"),
          requested: 1,
          completed: 0,
          interrupted: 1,
          surrendered: 0,
          acceptanceUncertain: true,
          appliedAt: now,
        },
      },
    ],
  })
  // Keep the fresh retry queued so its new ownership can be inspected.
  await seedGlobalQueue(context, [
    makeTask({
      id: "active-task",
      seriesTitle: "Active chapter",
      status: "downloading",
      created: now,
      chapters: [
        makeChapter(buildExampleUrl("/active-chapter"), "downloading"),
      ],
    }),
    interrupted,
  ])
  await page.goto(`chrome-extension://${extensionId}/options.html?tab=activity`)
  const warning =
    "Chrome handoff interrupted. Acceptance could not be confirmed. Retrying may create duplicate files."
  await expect(page.getByText(warning, { exact: false })).toBeVisible()
  await expect(
    page.getByRole("button", {
      name: "Retry all chapters (may create duplicates)",
      exact: true,
    })
  ).toBeVisible()

  const sidepanel = await context.newPage()
  await sidepanel.setViewportSize({ width: 360, height: 720 })
  await sidepanel.goto(`chrome-extension://${extensionId}/sidepanel.html`)
  await expect(sidepanel.getByText(warning, { exact: true })).toBeVisible()
  await sidepanel
    .getByRole("button", {
      name: "Retry all chapters (may create duplicates)",
      exact: true,
    })
    .click()
  const state = await waitForGlobalState(context, (state) =>
    state.downloadQueue.some(
      (task) => task.id !== interrupted.id && task.isRetryTask === true
    )
  )
  const retry = state.downloadQueue.find((task) => task.isRetryTask === true)
  expect(retry).toMatchObject({
    status: "queued",
    chapters: [
      { status: "queued", outputs: { requested: 0, committed: 0, failed: 0 } },
    ],
  })
  expect(retry?.chapters[0].nativeOutputSettlement).toBeUndefined()
  expect(retry?.chapters[0].errorCategory).toBeUndefined()
  expect(
    state.downloadQueue.find((task) => task.id === interrupted.id)
  ).toMatchObject({ status: "failed", isRetried: true })
  await sidepanel.close()
})
