import type { Locator } from "@playwright/test"
import { expect, test } from "./fixtures/extension"
import {
  makeChapter,
  makeTask,
  seedGlobalQueue,
} from "./fixtures/queue-test-helpers"
import { waitForGlobalState } from "./fixtures/state-helpers"
import { buildExampleUrl } from "./fixtures/test-domains-constants"

const cancelControl = 'button[aria-label="Cancel download"]'
const feedbackControl = "[data-task-feedback-trigger]"
const feedbackSummary = "[data-task-feedback-summary]"

function measureRow(row: Locator, nextTaskId: string, control: string) {
  return row.evaluate(
    (node, { nextTaskId, control, feedbackSummary }) => {
      const following = document.querySelector(
        `[data-task-id="${CSS.escape(nextTaskId)}"]`
      )
      const title = node.querySelector(".task-heading h3")
      const action = node.querySelector(control)
      const summary = node.querySelector(feedbackSummary)
      if (!following || !title || !action)
        throw new Error("The row needs a title, action, and following task")
      const bounds = node.getBoundingClientRect()
      const actionBounds = action.getBoundingClientRect()
      return {
        top: bounds.top,
        height: bounds.height,
        nextTop: following.getBoundingClientRect().top,
        titleLeft: title.getBoundingClientRect().left,
        summaryLeft: summary?.getBoundingClientRect().left,
        actionLeft: actionBounds.left,
        actionTop: actionBounds.top,
        actionWidth: actionBounds.width,
        actionHeight: actionBounds.height,
      }
    },
    { nextTaskId, control, feedbackSummary }
  )
}

type RowPlacement = Awaited<ReturnType<typeof measureRow>>

function expectSameRowPlacement(before: RowPlacement, after: RowPlacement) {
  for (const key of [
    "top",
    "height",
    "nextTop",
    "titleLeft",
    "actionLeft",
    "actionTop",
    "actionWidth",
    "actionHeight",
  ] as const) {
    expect(after[key], key).toBeCloseTo(before[key], 0)
  }
  expect(after.summaryLeft, "summary starts with the title").toBeCloseTo(
    after.titleLeft,
    0
  )
}

test("an active task keeps its row and exposes recovery when a chapter fails", async ({
  context,
  extensionId,
  page,
}) => {
  const now = Date.now()
  const savedChapter = {
    ...makeChapter(buildExampleUrl("/task-feedback-active-1"), "completed"),
    saveConfirmedAt: now,
    outputDestination: "downloads-api" as const,
  }
  const currentChapter = makeChapter(
    buildExampleUrl("/task-feedback-active-2"),
    "downloading",
    2
  )
  const active = makeTask({
    id: "task-feedback-active",
    seriesTitle: "An active series",
    status: "downloading",
    created: now - 10_000,
    started: now - 8_000,
    chapters: [savedChapter, currentChapter],
  })
  const waiting = makeTask({
    id: "task-feedback-waiting",
    seriesTitle: "The next series",
    status: "queued",
    created: now - 4_000,
  })
  await seedGlobalQueue(context, [active, waiting])
  await page.setViewportSize({ width: 360, height: 800 })
  await page.emulateMedia({ reducedMotion: "no-preference" })
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`)
  const row = page.locator(`[data-task-id="${active.id}"]`)
  const following = page.locator(`[data-task-id="${waiting.id}"]`)
  await expect(row.locator(cancelControl)).toBeVisible()
  await expect(following).toBeVisible()
  const before = await measureRow(row, waiting.id, cancelControl)

  await seedGlobalQueue(context, [
    {
      ...active,
      status: "partial_success",
      completed: now + 1,
      errorCategory: "provider_changed",
      chapters: [
        savedChapter,
        {
          ...currentChapter,
          status: "failed",
          errorCategory: "provider_changed",
        },
      ],
    },
    waiting,
  ])
  await expect(row.locator(feedbackSummary)).toBeVisible()
  const trigger = row.locator(feedbackControl)
  await expect(trigger).toBeVisible()
  expectSameRowPlacement(
    before,
    await measureRow(row, waiting.id, feedbackControl)
  )
  await trigger.focus()
  await page.keyboard.press("Enter")
  const feedback = row.locator("[data-task-feedback-panel]")
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  await expect(feedback.getByText("This site may have changed.")).toBeVisible()
  const retry = feedback.getByRole("button", {
    name: "Retry remaining chapters",
  })
  await expect(retry).toBeVisible()
  await expect
    .poll(async () => {
      const open = await measureRow(row, waiting.id, feedbackControl)
      return open.nextTop - before.nextTop
    })
    .toBeGreaterThan(40)
  await retry.focus()
  await page.keyboard.press("Escape")
  await expect(trigger).toBeFocused()
  await expect(trigger).toHaveAttribute("aria-expanded", "false")
  await expect
    .poll(
      async () => (await measureRow(row, waiting.id, feedbackControl)).nextTop
    )
    .toBeCloseTo(before.nextTop, 0)
  expectSameRowPlacement(
    before,
    await measureRow(row, waiting.id, feedbackControl)
  )
})

test("a rejected queued cancel keeps its row and can be retried from feedback", async ({
  context,
  extensionId,
  page,
}) => {
  const now = Date.now()
  const active = makeTask({
    id: "task-feedback-other-active",
    seriesTitle: "Another active series",
    status: "downloading",
    created: now - 10_000,
    chapters: [
      makeChapter(
        buildExampleUrl("/task-feedback-other-active"),
        "downloading"
      ),
    ],
  })
  const waiting = makeTask({
    id: "task-feedback-cancel",
    seriesTitle: "Series to cancel",
    status: "queued",
    created: now - 4_000,
  })
  const next = makeTask({
    id: "task-feedback-after-cancel",
    seriesTitle: "Following series",
    status: "queued",
    created: now - 2_000,
  })
  await seedGlobalQueue(context, [active, waiting, next])
  await page.addInitScript((taskId) => {
    const send = chrome.runtime.sendMessage.bind(chrome.runtime)
    let rejectFirstCancel = true
    Object.defineProperty(chrome.runtime, "sendMessage", {
      value: (message: { type: string; payload?: { taskId?: string } }) => {
        if (
          message.type === "CANCEL_TASK" &&
          message.payload?.taskId === taskId &&
          rejectFirstCancel
        ) {
          rejectFirstCancel = false
          return Promise.resolve({ success: false, error: "Cancel failed" })
        }
        return send(message)
      },
    })
  }, waiting.id)
  await page.setViewportSize({ width: 360, height: 800 })
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`)
  const row = page.locator(`[data-task-id="${waiting.id}"]`)
  const following = page.locator(`[data-task-id="${next.id}"]`)
  await expect(row.locator(cancelControl)).toBeVisible()
  await expect(following).toBeVisible()
  const before = await measureRow(row, next.id, cancelControl)

  await row.locator(cancelControl).click()
  await expect(row.locator(feedbackSummary)).toBeVisible()
  const trigger = row.locator(feedbackControl)
  await expect(trigger).toBeVisible()
  expectSameRowPlacement(
    before,
    await measureRow(row, next.id, feedbackControl)
  )
  await expect(trigger).toBeFocused()
  await page.keyboard.press("Enter")
  const feedback = row.locator("[data-task-feedback-panel]")
  await expect(feedback.getByText("Failed to cancel task")).toBeVisible()
  expect(
    await feedback.evaluate((element) => element.getAnimations().length)
  ).toBe(0)
  await feedback.getByRole("button", { name: "Cancel download" }).click()
  await waitForGlobalState(context, ({ downloadQueue }) =>
    downloadQueue.every((task) => task.id !== waiting.id)
  )
  await expect(row).toHaveCount(0)
  await expect(following).toBeVisible()
})
