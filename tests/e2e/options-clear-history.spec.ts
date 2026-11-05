import { test, expect } from "./fixtures/extension"
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

test.describe("Options Downloads history management", () => {
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
