import type { Page } from "@playwright/test"
import { test, expect } from "./fixtures/extension"
import {
  expectTransformOriginFromTrigger,
  readTransformOriginInfo,
} from "./fixtures/transform-origin"
import {
  seedDownloadQueueState,
  setDownloadedChapterHistory,
} from "./fixtures/state-helpers"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { DEFAULT_SETTINGS } from "../../src/domain/settings/defaults"
import type { DownloadTaskState } from "../../src/domain/queue/state"
import type { ChapterState } from "../../src/types/tab-state"
import type {
  DownloadedChapterRecord,
  DownloadHistoryClearCutoffs,
} from "../../src/domain/history/types"

function chapterRecord(): DownloadedChapterRecord {
  return {
    siteIntegrationId: "mangadex",
    chapterId: "done",
    url: "https://example.com/done",
    title: "Chapter done",
    seriesId: "series-done",
    seriesTitle: "Series done",
    downloadedAt: Date.now(),
    format: "cbz",
  }
}

const LONG_SERIES_TITLE =
  "The Irregular at Magic High School: Anniversary Anthology Light Novel Edition Volume One"

function longTitleRecord(
  siteIntegrationId: string,
  seriesId: string
): DownloadedChapterRecord {
  return {
    ...chapterRecord(),
    siteIntegrationId,
    chapterId: `long-${siteIntegrationId}`,
    url: `https://example.com/long-${siteIntegrationId}`,
    seriesId,
    seriesTitle: LONG_SERIES_TITLE,
  }
}

function makeChapter(
  id: string,
  status: ChapterState["status"]
): ChapterState & { requestedPath: string } {
  return {
    requestedPath: "Tako/Chapter.cbz",
    id,
    url: `https://example.com/${id}`,
    title: `Chapter ${id}`,
    index: 1,
    status,
    lastUpdated: Date.now(),
  }
}

function makeTask(
  id: string,
  status: DownloadTaskState["status"]
): DownloadTaskState {
  const now = Date.now()
  return {
    id,
    siteIntegrationId: "mangadex",
    mangaId: `series-${id}`,
    seriesTitle: `Series ${id}`,
    chapters: [
      makeChapter(
        id,
        status === "queued"
          ? "queued"
          : status === "downloading"
            ? "downloading"
            : "completed"
      ),
    ],
    status,
    created: now,
    completed:
      status === "queued" || status === "downloading" ? undefined : now,
    settingsSnapshot: createTaskSettingsSnapshot(DEFAULT_SETTINGS, "mangadex"),
  }
}

type DialogMotionCapture = {
  generation: number
  animations: Animation[]
}

type DialogMotionHost = Window & {
  __takoDialogMotion?: DialogMotionCapture
}

/** Runs inside the page via page.evaluate; keep it self-contained. */
function captureDialogMotion(role: string): void {
  const host = window as DialogMotionHost
  if (host.__takoDialogMotion) return
  const state: DialogMotionCapture = { generation: 0, animations: [] }
  host.__takoDialogMotion = state
  document.addEventListener(
    "animationstart",
    (event) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      if (target.getAttribute("role") !== role) return
      const animations = target.getAnimations()
      if (animations.length === 0) return
      state.generation += 1
      state.animations = animations
      for (const animation of animations) animation.pause()
    },
    true
  )
}

async function armDialogMotion(page: Page, role: string): Promise<void> {
  await page.evaluate(captureDialogMotion, role)
}

/**
 * Reads the armed, already-paused enter/exit animation pair: the content's
 * center at the first and last frame. Modal motion must be scale/fade only,
 * so the center cannot move more than a pixel.
 */
async function readDialogTravel(
  page: Page,
  generation: number
): Promise<{ animations: number; dx: number; dy: number } | null> {
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as DialogMotionHost).__takoDialogMotion?.generation ?? 0
      )
    )
    .toBe(generation)
  return page.evaluate(async () => {
    const animations =
      (window as DialogMotionHost).__takoDialogMotion?.animations ?? []
    const element = (animations[0]?.effect as KeyframeEffect | null)
      ?.target as Element | null
    if (!element || animations.length === 0) return null
    const sample = async (time: number) => {
      for (const animation of animations) animation.currentTime = time
      await new Promise((resolve) => requestAnimationFrame(resolve))
      const rect = element.getBoundingClientRect()
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
    }
    const duration = Math.max(
      ...animations.map(
        (animation) =>
          Number(animation.effect?.getComputedTiming().duration) || 0
      )
    )
    const start = await sample(0)
    const end = await sample(duration)
    for (const animation of animations) animation.finish()
    return {
      animations: animations.length,
      dx: Math.abs(end.x - start.x),
      dy: Math.abs(end.y - start.y),
    }
  })
}

test.describe("Options Downloads history management", () => {
  test("loads Options and clears chapter history for a series with an empty title", async ({
    page,
    context,
    extensionId,
  }) => {
    const record = { ...chapterRecord(), seriesTitle: "" }
    await setDownloadedChapterHistory(context, [record])
    await page.goto(
      `chrome-extension://${extensionId}/options.html?tab=activity`
    )

    const clearSeries = page.getByRole("button", {
      name: "Clear series chapter history",
      exact: true,
    })
    await expect(clearSeries).toBeEnabled()
    await clearSeries.click()
    const dialog = page.getByRole("dialog", {
      name: "Clear series chapter history",
    })
    await dialog.getByRole("combobox").click()
    await page
      .getByRole("option", { name: `${record.seriesId} (MangaDex)` })
      .click()
    await dialog.getByRole("button", { name: "Clear Selected" }).click()

    await expect(dialog).toBeHidden()
    await expect(clearSeries).toBeDisabled()
  })

  test("clearing task history preserves chapter history and current work", async ({
    page,
    extensionId,
  }) => {
    const seededQueue: DownloadTaskState[] = [
      makeTask("active", "downloading"),
      makeTask("queued", "queued"),
      makeTask("done", "completed"),
      makeTask("partial", "partial_success"),
      makeTask("failed", "failed"),
      makeTask("canceled", "canceled"),
    ]

    await page.goto(
      `chrome-extension://${extensionId}/options.html?tab=activity`,
      { waitUntil: "domcontentloaded" }
    )
    await expect(page.locator("#root")).toBeVisible({ timeout: 10000 })

    await seedDownloadQueueState(page, seededQueue)
    const record = chapterRecord()
    await setDownloadedChapterHistory(page.context(), [record])

    await page.getByRole("button", { name: /Activity/i }).click()
    await expect(page.getByText("Series done")).toBeVisible()
    await expect(page.getByText("Series failed")).toBeVisible()
    await expect(page.getByText("Series active")).toBeVisible()

    await page
      .getByRole("button", { name: "Clear task history", exact: true })
      .click()
    const dialog = page.getByRole("alertdialog", {
      name: "Clear task history?",
    })
    await dialog
      .getByRole("button", { name: "Clear task history", exact: true })
      .click()
    await expect(dialog).toHaveCount(0)

    await expect(page.getByText("Series done")).toHaveCount(0)
    await expect(page.getByText("Series failed")).toHaveCount(0)
    await expect(page.getByText("Series partial")).toHaveCount(0)
    await expect(page.getByText("Series canceled")).toHaveCount(0)

    await expect(page.getByText("Series active")).toBeVisible()
    await expect(page.getByText("Series queued")).toBeVisible()

    const remainingStatuses = await page.evaluate(async () => {
      const result = await chrome.storage.local.get("downloadQueue")
      const queue = (result.downloadQueue ?? []) as Array<{ status: string }>
      return queue.map((task) => task.status)
    })

    expect(remainingStatuses).toEqual(["downloading", "queued"])
    const history = await page.evaluate(async () => {
      const result = await chrome.storage.local.get("downloadedChapters")
      return result.downloadedChapters
    })
    expect(history).toContainEqual(record)
  })

  test("rejects CLEAR_ALL_HISTORY from sidepanel sender context", async ({
    page,
    extensionId,
  }) => {
    const seededQueue: DownloadTaskState[] = [
      makeTask("active", "downloading"),
      makeTask("done", "completed"),
    ]

    await page.goto(
      `chrome-extension://${extensionId}/options.html?tab=activity`,
      { waitUntil: "domcontentloaded" }
    )
    await expect(page.locator("#root")).toBeVisible({ timeout: 10000 })
    await seedDownloadQueueState(page, seededQueue)

    const sidepanelPage = await page.context().newPage()
    await sidepanelPage.goto(
      `chrome-extension://${extensionId}/sidepanel.html`,
      { waitUntil: "domcontentloaded" }
    )

    const clearResult = await sidepanelPage.evaluate(async () => {
      const issuedAt = Date.now()
      return (await chrome.runtime.sendMessage({
        target: "background",
        type: "CLEAR_ALL_HISTORY",
        commandId: crypto.randomUUID(),
        issuedAt,
        payload: {},
      })) as {
        success?: boolean
        error?: string
      }
    })

    await sidepanelPage.close()

    expect(clearResult.success).toBe(false)
    expect(clearResult.error).toBe(
      "CLEAR_ALL_HISTORY is not authorized for sidepanel"
    )

    const remainingStatuses = await page.evaluate(async () => {
      const result = await chrome.storage.local.get("downloadQueue")
      const queue = (result.downloadQueue ?? []) as Array<{ status: string }>
      return queue.map((task) => task.status)
    })

    expect(remainingStatuses).toEqual(["downloading", "completed"])
  })

  test("clearing chapter history preserves task records through reload and later task clearing", async ({
    page,
    extensionId,
  }) => {
    await page.goto(
      `chrome-extension://${extensionId}/options.html?tab=activity`
    )
    await seedDownloadQueueState(page, [
      makeTask("active", "downloading"),
      makeTask("queued", "queued"),
      makeTask("done", "completed"),
    ])
    const record = chapterRecord()
    await setDownloadedChapterHistory(page.context(), [
      record,
      { ...record, chapterId: "second", url: "https://example.com/second" },
      {
        ...record,
        siteIntegrationId: "coolmic",
        chapterId: "coolmic-one",
        seriesId: "coolmic-series",
        url: "https://example.com/coolmic",
      },
    ])
    await page.reload()

    const bySite = page.getByRole("region", { name: "Chapter history by site" })
    await expect(bySite).toBeVisible()
    const counts = bySite.getByRole("listitem")
    await expect(
      counts.filter({ hasText: "MangaDex" }).getByText("2", { exact: true })
    ).toBeVisible()
    await expect(
      counts.filter({ hasText: /coolmic/i }).getByText("1", { exact: true })
    ).toBeVisible()

    await page
      .getByRole("button", { name: "Clear chapter history", exact: true })
      .click()
    const dialog = page.getByRole("alertdialog", {
      name: "Clear chapter history?",
    })
    await dialog
      .getByRole("button", { name: "Clear chapter history", exact: true })
      .click()
    await expect(dialog).toHaveCount(0)
    await expect(bySite).toHaveCount(0)
    await expect(
      page.getByText("Chapter history cleared", { exact: true })
    ).toBeVisible()

    const stored = await page.evaluate(async () => {
      const result = await chrome.storage.local.get([
        "downloadedChapters",
        "downloadQueue",
        "downloadHistoryClearCutoffs",
      ])
      return {
        chapters: result.downloadedChapters,
        taskIds: (result.downloadQueue as Array<{ id: string }>).map(
          (task) => task.id
        ),
        clearCutoffs:
          result.downloadHistoryClearCutoffs as DownloadHistoryClearCutoffs,
      }
    })
    expect(stored.chapters).toEqual([])
    expect(stored.taskIds).toEqual(["active", "queued", "done"])
    expect(stored.clearCutoffs.allBefore).toBeGreaterThan(0)

    await page.reload()
    await expect(page.getByText("Series done")).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Clear chapter history", exact: true })
    ).toBeDisabled()
    await page
      .getByRole("button", { name: "Clear task history", exact: true })
      .click()
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Clear task history", exact: true })
      .click()
    await expect(page.getByText("Series done")).toHaveCount(0)
    await expect(page.getByText("Series active")).toBeVisible()
    await expect(page.getByText("Series queued")).toBeVisible()
    expect(
      await page.evaluate(
        async () =>
          (await chrome.storage.local.get("downloadedChapters"))
            .downloadedChapters
      )
    ).toEqual([])
  })

  // "opening" only: this AlertDialog unmounts on close, so no exit animation exists to measure.
  test("task history alert dialog keeps its content centered while opening and closing", async ({
    page,
    extensionId,
  }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" })
    await page.goto(
      `chrome-extension://${extensionId}/options.html?tab=activity`,
      { waitUntil: "domcontentloaded" }
    )
    await expect(page.locator("#root")).toBeVisible({ timeout: 10000 })
    await seedDownloadQueueState(page, [makeTask("done", "completed")])
    await page.getByRole("button", { name: /Activity/i }).click()
    await expect(page.locator("html")).not.toHaveAttribute("data-tako-motion")

    await armDialogMotion(page, "alertdialog")
    await page
      .getByRole("button", { name: "Clear task history", exact: true })
      .click()
    const dialog = page.getByRole("alertdialog", {
      name: "Clear task history?",
    })
    await expect(dialog).toBeVisible()

    const openTravel = await readDialogTravel(page, 1)
    expect(openTravel).not.toBeNull()
    expect(openTravel!.animations).toBeGreaterThan(0)
    expect(openTravel!.dx).toBeLessThanOrEqual(1)
    expect(openTravel!.dy).toBeLessThanOrEqual(1)

    await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
    const closeTravel = await readDialogTravel(page, 2)
    expect(closeTravel).not.toBeNull()
    expect(closeTravel!.animations).toBeGreaterThan(0)
    expect(closeTravel!.dx).toBeLessThanOrEqual(1)
    expect(closeTravel!.dy).toBeLessThanOrEqual(1)
    await expect(dialog).toHaveCount(0)
  })

  test("series history dialog keeps its content centered and its select scales from the trigger", async ({
    page,
    context,
    extensionId,
  }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" })
    // Narrow viewport so min-content sizing of the select popper/trigger is
    // observable: at desktop widths even the unfixed layout fits.
    await page.setViewportSize({ width: 480, height: 800 })
    await page.goto(
      `chrome-extension://${extensionId}/options.html?tab=activity`,
      { waitUntil: "domcontentloaded" }
    )
    await expect(page.locator("#root")).toBeVisible({ timeout: 10000 })
    await seedDownloadQueueState(page, [makeTask("done", "completed")])
    // One short record plus the same long title on two site integrations so
    // the select must keep the "(Site)" suffix visible to stay distinguishable.
    await setDownloadedChapterHistory(context, [
      chapterRecord(),
      longTitleRecord("mangadex", "long-title-md"),
      longTitleRecord("coolmic", "long-title-cm"),
    ])
    // History stats load once on mount; reload so the seeded records enable
    // the series-history row before the dialog is opened.
    await page.reload()
    await expect(page.locator("#root")).toBeVisible({ timeout: 10000 })
    await expect(page.getByText("Series done")).toBeVisible()
    await expect(page.locator("html")).not.toHaveAttribute("data-tako-motion")

    await armDialogMotion(page, "dialog")
    await page
      .getByRole("button", {
        name: "Clear series chapter history",
        exact: true,
      })
      .click()
    const dialog = page.getByRole("dialog", {
      name: "Clear series chapter history",
    })
    await expect(dialog).toBeVisible()

    const openTravel = await readDialogTravel(page, 1)
    expect(openTravel).not.toBeNull()
    expect(openTravel!.animations).toBeGreaterThan(0)
    expect(openTravel!.dx).toBeLessThanOrEqual(1)
    expect(openTravel!.dy).toBeLessThanOrEqual(1)

    await dialog.getByRole("combobox").click()
    const listbox = page.getByRole("listbox")
    await expect(listbox).toBeVisible()

    // The popper must stay inside the viewport and the trigger inside the
    // dialog even with ~100-char titles (regression: popper/trigger used to
    // size to min-content and overflow both). While the listbox is open Radix
    // marks the dialog aria-hidden, so address the trigger by id and the
    // dialog by attribute selector rather than by role.
    const viewportWidth = page.viewportSize()?.width ?? 0
    const listboxBox = await listbox.boundingBox()
    expect(listboxBox).not.toBeNull()
    expect(listboxBox!.x + listboxBox!.width).toBeLessThanOrEqual(
      viewportWidth + 0.5
    )
    const trigger = page.locator("#series-select")
    const dialogBox = await page.locator('[role="dialog"]').boundingBox()
    const triggerBox = await trigger.boundingBox()
    expect(triggerBox).not.toBeNull()
    expect(dialogBox).not.toBeNull()
    expect(triggerBox!.x + triggerBox!.width).toBeLessThanOrEqual(
      dialogBox!.x + dialogBox!.width + 0.5
    )

    const origin = await listbox.evaluate(
      readTransformOriginInfo,
      "--radix-select-content-transform-origin"
    )
    expectTransformOriginFromTrigger(origin)

    // The selected value keeps its site suffix so same-title series on
    // different integrations remain distinguishable in the trigger.
    // Choosing an option closes the listbox, so the dialog is interactive again.
    await listbox.getByRole("option", { name: /\(Coolmic\)/ }).click()
    const site = trigger.locator("[data-series-site]")
    await expect(site).toHaveText("(Coolmic)")
    const siteBox = await site.boundingBox()
    const valueBox = await trigger
      .locator(":scope > span")
      .first()
      .boundingBox()
    expect(siteBox).not.toBeNull()
    expect(valueBox).not.toBeNull()
    expect(siteBox!.x + siteBox!.width).toBeLessThanOrEqual(
      valueBox!.x + valueBox!.width + 0.5
    )

    await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
    const closeTravel = await readDialogTravel(page, 2)
    expect(closeTravel).not.toBeNull()
    expect(closeTravel!.animations).toBeGreaterThan(0)
    expect(closeTravel!.dx).toBeLessThanOrEqual(1)
    expect(closeTravel!.dy).toBeLessThanOrEqual(1)
    await expect(dialog).toHaveCount(0)
  })

  for (const scope of ["task", "chapter"] as const) {
    test(`failed ${scope}-history clearing keeps its confirmation open and can be retried`, async ({
      page,
      extensionId,
      _extensionContextState,
    }) => {
      await page.goto(
        `chrome-extension://${extensionId}/options.html?tab=activity`
      )
      await seedDownloadQueueState(page, [
        makeTask("active", "downloading"),
        makeTask("queued", "queued"),
        makeTask("done", "completed"),
      ])
      const record = chapterRecord()
      await setDownloadedChapterHistory(page.context(), [record])
      await page.reload()
      await expect(page.getByText("Series done")).toBeVisible()

      await _extensionContextState.backgroundWorker.evaluate(
        (key) => {
          const persist = chrome.storage.local.set.bind(chrome.storage.local)
          Object.defineProperty(chrome.storage.local, "set", {
            configurable: true,
            value: async (values: Record<string, unknown>) => {
              if (key in values) {
                Object.defineProperty(chrome.storage.local, "set", {
                  value: persist,
                })
                throw new Error("History storage unavailable")
              }
              await persist(values)
            },
          })
        },
        scope === "task" ? "downloadQueue" : "downloadedChapters"
      )

      const label = `Clear ${scope} history`
      await page.getByRole("button", { name: label, exact: true }).click()
      const dialog = page.getByRole("alertdialog", { name: `${label}?` })
      const confirm = dialog.getByRole("button", { name: label, exact: true })
      await confirm.click()
      await expect(dialog.getByRole("alert")).toHaveText(
        "History could not be cleared. Try again."
      )
      await expect(confirm).toBeEnabled()
      await expect(
        page.getByText("Task history cleared", { exact: true })
      ).toHaveCount(0)
      await expect(
        page.getByText("Chapter history cleared", { exact: true })
      ).toHaveCount(0)
      const retained = await page.evaluate(async () => {
        const result = await chrome.storage.local.get([
          "downloadedChapters",
          "downloadQueue",
        ])
        return {
          chapters: result.downloadedChapters,
          taskIds: (result.downloadQueue as Array<{ id: string }>).map(
            (task) => task.id
          ),
        }
      })
      expect(retained.chapters).toEqual([record])
      expect(retained.taskIds).toEqual(["active", "queued", "done"])

      await confirm.click()
      await expect(dialog).toHaveCount(0)
      await expect(
        page.getByText(
          `${scope === "task" ? "Task" : "Chapter"} history cleared`,
          { exact: true }
        )
      ).toBeVisible()
      await expect(page.getByText("Series active")).toBeVisible()
      await expect(page.getByText("Series queued")).toBeVisible()
      if (scope === "task") {
        await expect(page.getByText("Series done")).toHaveCount(0)
        expect(
          await page.evaluate(
            async () =>
              (await chrome.storage.local.get("downloadedChapters"))
                .downloadedChapters
          )
        ).toEqual([record])
      } else {
        await expect(page.getByText("Series done")).toBeVisible()
        expect(
          await page.evaluate(
            async () =>
              (await chrome.storage.local.get("downloadedChapters"))
                .downloadedChapters
          )
        ).toEqual([])
      }
    })
  }
})
