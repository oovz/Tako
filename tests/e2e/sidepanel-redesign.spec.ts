import { test, expect } from "./fixtures/extension"
import { mkdir } from "node:fs/promises"
import {
  openSidepanelHarness,
  reloadSidepanelHarness,
  seedTabContext,
  setDownloadedChapterHistory,
  waitForGlobalState,
} from "./fixtures/state-helpers"
import {
  makeChapter,
  makeTask,
  seedGlobalQueue,
} from "./fixtures/queue-test-helpers"
import {
  buildExampleUrl,
  buildMangadexUrl,
  MANGADEX_ORDER_TEST_SERIES_ID,
} from "./fixtures/test-domains-constants"

const title =
  "Lantern Road and the Cartographer’s Guide to the Towns Beyond the Last Ferry"
const author =
  "Aya Mori and Haruka Kazehaya-Matsumoto, with illustrations by the Observatory Studio"
const chapterTitle =
  "A Storm in Blue and the Letter the Lighthouse Keeper Never Sent"
const output = ".scratch/sidepanel-redesign-2026-11-08/screenshots"

test("approved panel: durable queue controls, conditional Manga, selection review, and Recent at supported widths", async ({
  context,
  extensionId,
  page,
}) => {
  await mkdir(output, { recursive: true })
  await page.goto(buildExampleUrl("/"), { waitUntil: "domcontentloaded" })
  const now = Date.now()
  const active = makeTask({
    id: "review-active",
    seriesTitle: title,
    status: "downloading",
    created: now - 30000,
    chapters: Array.from({ length: 3 }, (_, index) => ({
      ...makeChapter(
        buildExampleUrl("/review-active-" + index),
        index === 0 ? "completed" : index === 1 ? "downloading" : "queued",
        index + 1
      ),
      title: chapterTitle + " — " + (index + 1),
      ...(index === 0
        ? {
            saveConfirmedAt: now - 5000,
            outputDestination: "downloads-api" as const,
          }
        : {}),
    })),
  })
  const queued = Array.from({ length: 20 }, (_, index) =>
    makeTask({
      id: "review-queued-" + index,
      seriesTitle: title + " · " + (index + 1),
      status: "queued",
      created: now + index,
      chapters: [
        makeChapter(
          buildExampleUrl("/review-queued-" + index),
          "queued",
          index + 4
        ),
      ],
    })
  )
  await seedGlobalQueue(context, [active, ...queued])
  const sp = await openSidepanelHarness(context, extensionId, page)
  await sp.setViewportSize({ width: 360, height: 800 })
  await expect(sp.getByRole("tab")).toHaveText(["Queue", "Recent"])
  await expect(sp.getByRole("tab", { name: "Search" })).toHaveCount(0)
  const activeRow = sp.locator('[data-task-id="review-active"]')
  await expect(activeRow).toBeVisible()
  await activeRow.locator(".queue-task-toggle").click()
  await expect(activeRow.locator(".task-details")).toContainText(chapterTitle)
  await activeRow.locator(".task-ring").click()
  await sp.screenshot({ path: output + "/cancel-before-focus.png" })
  await expect(
    activeRow.getByRole("button", { name: "Keep downloading" })
  ).toBeFocused()
  await sp.screenshot({ path: output + "/cancel-360.png" })
  await activeRow.getByRole("button", { name: "Keep downloading" }).click()
  await expect(activeRow.locator(".task-ring")).toBeFocused()
  await activeRow.locator(".queue-task-toggle").click()

  const first = sp.locator('[data-task-id="review-queued-0"]')
  await first.getByRole("button", { name: "Reorder task" }).click()
  await first.getByRole("spinbutton", { name: "Queue position" }).fill("20")
  await first.getByRole("button", { name: "Move", exact: true }).click()
  await waitForGlobalState(
    context,
    (state) =>
      state.downloadQueue.filter((task) => task.status === "queued").at(-1)
        ?.id === "review-queued-0"
  )
  await expect(
    first.getByRole("button", { name: "Reorder task" })
  ).toBeFocused()
  await reloadSidepanelHarness(sp, page)
  await expect(sp.locator('[data-queued="true"]').first()).toHaveAttribute(
    "data-task-id",
    "review-queued-1"
  )
  await sp
    .locator('[data-task-id="review-queued-1"]')
    .getByRole("button", { name: "Cancel download" })
    .click()
  const undo = sp.locator(".queue-undo").getByRole("button", { name: "Undo" })
  await expect(undo).toBeFocused()
  await sp.waitForTimeout(6000)
  await expect(undo).toBeFocused()
  await undo.click()
  await waitForGlobalState(context, (state) =>
    state.downloadQueue.some(
      (task) => task.id === "review-queued-1" && task.status === "queued"
    )
  )

  const waitingRows = sp.locator('[data-queued="true"]')
  const draggedId = await waitingRows.first().getAttribute("data-task-id")
  const targetId = await waitingRows.nth(2).getAttribute("data-task-id")
  const targetBounds = await waitingRows.nth(2).boundingBox()
  await waitingRows
    .first()
    .getByRole("button", { name: "Reorder task" })
    .dragTo(waitingRows.nth(2), {
      // Give Chromium pointer moves to start the drag before reaching the drop row.
      steps: 10,
      targetPosition: { x: 20, y: targetBounds!.height - 4 },
    })
  await waitForGlobalState(context, (state) => {
    const ids = state.downloadQueue
      .filter((task) => task.status === "queued")
      .map((task) => task.id)
    return ids.indexOf(draggedId!) === ids.indexOf(targetId!) + 1
  })

  for (const width of [200, 360, 480]) {
    await sp.setViewportSize({ width, height: 800 })
    await expect
      .poll(() =>
        sp
          .locator("#root")
          .evaluate((root) => root.scrollWidth <= root.clientWidth)
      )
      .toBe(true)
    await expect
      .poll(() =>
        sp.evaluate(
          () =>
            document
              .getAnimations()
              .filter(
                (animation) =>
                  animation.playState === "running" || animation.pending
              ).length
        )
      )
      .toBe(0)
    await sp.screenshot({ path: output + "/queue-" + width + ".png" })
  }
  const mangaUrl = buildMangadexUrl(
    "/title/" + MANGADEX_ORDER_TEST_SERIES_ID + "/review"
  )
  await seedTabContext(
    page,
    context,
    {
      siteIntegrationId: "mangadex",
      mangaId: MANGADEX_ORDER_TEST_SERIES_ID,
      seriesTitle: title,
      metadata: { author },
      volumes: Array.from({ length: 5 }, (_, index) => ({
        id: "volume-" + index,
        title:
          "Volume " +
          (index + 1) +
          ": The Road at Dusk and the Towns the Surveyors Left Off Their Maps",
      })),
      chapters: Array.from({ length: 90 }, (_, index) => ({
        id: "review-chapter-" + index,
        url: buildMangadexUrl("/chapter/review-" + index),
        title: chapterTitle + " — " + (index + 1),
        chapterNumber: index + 1,
        volumeNumber: Math.floor(index / 18) + 1,
        volumeId: "volume-" + Math.floor(index / 18),
      })),
    },
    mangaUrl
  )
  await reloadSidepanelHarness(sp, page)
  await expect(sp.getByRole("tab")).toHaveText(["Queue", "Manga", "Recent"])
  await expect(sp.getByRole("tab", { name: "Queue" })).toHaveAttribute(
    "aria-selected",
    "true"
  )
  await sp.getByRole("tab", { name: "Manga" }).click()
  for (const width of [200, 360, 480]) {
    await sp.setViewportSize({ width, height: 800 })
    await expect
      .poll(() =>
        sp
          .locator("#root")
          .evaluate((root) => root.scrollWidth <= root.clientWidth)
      )
      .toBe(true)
    await expect
      .poll(() =>
        sp.evaluate(
          () =>
            document
              .getAnimations()
              .filter(
                (animation) =>
                  animation.playState === "running" || animation.pending
              ).length
        )
      )
      .toBe(0)
    await sp.screenshot({ path: output + "/manga-" + width + ".png" })
    if (width === 200) {
      await sp.getByRole("button", { name: "More details" }).click()
      await expect(sp.getByText(author, { exact: true })).toBeVisible()
      await sp.getByRole("button", { name: "Less detail" }).click()
    }
  }
  await sp.setViewportSize({ width: 360, height: 800 })
  await sp.getByRole("checkbox", { name: "Select all", exact: true }).click()
  await sp.getByRole("button", { name: "Review selection" }).click()
  const sheet = sp.getByRole("dialog")
  await expect(sheet).toBeVisible()
  const chapter = sheet.getByRole("checkbox", {
    name: chapterTitle + " — 1",
    exact: true,
  })
  await chapter.uncheck()
  await expect(chapter).toBeVisible()
  await expect(chapter).not.toBeChecked()
  await chapter.check()
  const reviewList = sheet.locator(".selection-review-list")
  await expect(reviewList).toHaveAttribute("data-virtualized", "true")
  expect(await sheet.locator(".manga-chapter").count()).toBeLessThan(90)
  await reviewList.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  await expect(
    sheet.getByRole("checkbox", { name: chapterTitle + " — 90", exact: true })
  ).toBeVisible()
  await reviewList.evaluate((element) => {
    element.scrollTop = 0
  })
  await expect(chapter).toBeChecked()
  await sp.screenshot({ path: output + "/selection-review-360.png" })
  await sheet.getByRole("button", { name: "Close review", exact: true }).click()
  await expect(
    sp.getByRole("button", { name: "Review selection" })
  ).toBeFocused()
  await sp.getByRole("button", { name: "Review selection" }).click()
  await sheet.getByRole("button", { name: "Clear all", exact: true }).click()
  await sheet.getByRole("button", { name: "Close review", exact: true }).click()
  await expect(
    sp.getByRole("checkbox", { name: "Select all", exact: true })
  ).toBeFocused()

  await setDownloadedChapterHistory(
    context,
    Array.from({ length: 20 }, (_, index) => ({
      siteIntegrationId: "mangadex",
      chapterId: "saved-" + index,
      url: buildMangadexUrl("/chapter/saved-" + index),
      title: chapterTitle,
      seriesId: MANGADEX_ORDER_TEST_SERIES_ID,
      seriesTitle: title,
      downloadedAt: now - index * 60000,
      saveConfirmedAt: now - index * 60000,
      outputDestination: "downloads-api" as const,
      format: "cbz" as const,
    }))
  )
  await sp.getByRole("tab", { name: "Recent" }).click()
  await expect(sp.locator(".recent-row")).toHaveCount(20)
  await expect(sp.locator(".recent-row").first()).toContainText("MangaDex")
  await expect
    .poll(() =>
      sp.evaluate(
        () =>
          document
            .getAnimations()
            .filter(
              (animation) =>
                animation.playState === "running" || animation.pending
            ).length
      )
    )
    .toBe(0)
  await sp.screenshot({ path: output + "/recent-360.png" })
  const optionsOpened = context.waitForEvent("page")
  await sp.getByRole("button", { name: "View history in Options" }).click()
  const options = await optionsOpened
  await expect(options).toHaveURL(/options\.html\?tab=activity/)
  await sp.emulateMedia({ reducedMotion: "reduce" })
  await sp.getByRole("tab", { name: "Queue" }).click()
  await expect
    .poll(() =>
      sp.evaluate(
        () =>
          document
            .getAnimations()
            .filter(
              (animation) => Number(animation.effect?.getTiming().duration) > 1
            ).length
      )
    )
    .toBe(0)
  await sp.close()
})
