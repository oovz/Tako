import { test, expect } from "./fixtures/extension"
import { seedDownloadQueueState } from "./fixtures/state-helpers"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { DEFAULT_SETTINGS } from "../../src/domain/settings/defaults"
import type { DownloadTaskState } from "../../src/domain/queue/state"
import type { ChapterState } from "../../src/types/tab-state"

function makeChapter(id: string, status: ChapterState["status"]): ChapterState {
  return {
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
  status: DownloadTaskState["status"],
  overrides: Partial<DownloadTaskState> = {}
): DownloadTaskState {
  const now = Date.now()
  const siteIntegrationId = overrides.siteIntegrationId ?? "mangadex"
  return {
    id,
    siteIntegrationId,
    mangaId: overrides.mangaId ?? `series-${id}`,
    seriesTitle: overrides.seriesTitle ?? `Series ${id}`,
    chapters: overrides.chapters ?? [
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
    created: overrides.created ?? now,
    completed:
      overrides.completed ??
      (status === "queued" || status === "downloading" ? undefined : now),
    settingsSnapshot:
      overrides.settingsSnapshot ??
      createTaskSettingsSnapshot(DEFAULT_SETTINGS, siteIntegrationId),
    ...overrides,
  }
}

test.describe("Options UI behavior", () => {
  test.describe.configure({ mode: "serial" })

  test("Downloads tab confirms active cancellation and cancels queued tasks immediately", async ({
    page,
    extensionId,
  }) => {
    const seededQueue: DownloadTaskState[] = [
      makeTask("active-spec-options", "downloading", {
        seriesTitle: "Active Spec Options",
      }),
      makeTask("queued-spec-options", "queued", {
        seriesTitle: "Queued Spec Options",
      }),
    ]

    await page.goto(
      `chrome-extension://${extensionId}/options.html?tab=downloads`,
      {
        waitUntil: "domcontentloaded",
      }
    )
    await expect(page.locator("#root")).toBeVisible({ timeout: 10000 })
    await seedDownloadQueueState(page, seededQueue)

    await expect(page.getByText("Active Spec Options")).toBeVisible()
    await expect(page.getByText("Queued Spec Options")).toBeVisible()

    const activeTaskCard = page
      .getByRole("heading", { name: "Active Spec Options" })
      .locator("xpath=ancestor::*[@aria-busy][1]")
    const queuedTaskCard = page
      .getByRole("heading", { name: "Queued Spec Options" })
      .locator("xpath=ancestor::*[@aria-busy][1]")

    await activeTaskCard.getByRole("button", { name: "Cancel" }).click()
    await expect(page.getByText("Cancel this download?")).toBeVisible()
    await page.getByRole("button", { name: "No" }).click()
    await expect(page.getByText("Cancel this download?")).toHaveCount(0)

    await queuedTaskCard.getByRole("button", { name: "Cancel" }).click()
    await expect(page.getByText("Cancel this download?")).toHaveCount(0)

    await expect
      .poll(async () => {
        const result = await page.evaluate(async () => {
          const queue = ((await chrome.storage.local.get("downloadQueue"))
            .downloadQueue ?? []) as Array<{
            id: string
          }>
          const pendingUndoActions = ((
            await chrome.storage.local.get("pendingUndoActions")
          ).pendingUndoActions ?? []) as Array<{
            type?: string
            taskSnapshot?: { id?: string }
          }>
          return {
            queuedTaskPresent: queue.some(
              (task) => task.id === "queued-spec-options"
            ),
            hasQueuedCancellationUndo: pendingUndoActions.some(
              (action) =>
                action.type === "cancel_queued" &&
                action.taskSnapshot?.id === "queued-spec-options"
            ),
          }
        })
        return result
      })
      .toEqual({ queuedTaskPresent: false, hasQueuedCancellationUndo: true })
  })

  test("Downloads tab states the task-wide scope of forgetting an unobservable download", async ({
    page,
    extensionId,
  }) => {
    await page.goto(
      `chrome-extension://${extensionId}/options.html?tab=downloads`,
      { waitUntil: "domcontentloaded" }
    )
    await expect(page.locator("#root")).toBeVisible({ timeout: 10000 })
    await seedDownloadQueueState(page, [
      makeTask("unobservable-options", "downloading", {
        seriesTitle: "Unobservable Options",
        errorCategory: "network_unavailable",
        chapters: [
          {
            ...makeChapter("earlier-failure", "downloading"),
            errorCategory: "network_unavailable",
          },
          {
            ...makeChapter("erased-output", "downloading"),
            errorCategory: "browser_download_unobservable",
          },
        ],
      }),
    ])

    const taskCard = page
      .getByRole("heading", { name: "Unobservable Options" })
      .locator("xpath=ancestor::*[@aria-busy][1]")
    await taskCard.getByRole("button", { name: "Cancel" }).click()

    await expect(
      taskCard.getByText("Forget all pending downloads for this task?")
    ).toBeVisible()
    await expect(
      taskCard.getByText(
        "The browser download can no longer be inspected. Forgetting it releases all of Tako's pending outputs for this task; files may be incomplete."
      )
    ).toBeVisible()
    await expect(
      taskCard.getByRole("button", { name: "Forget all downloads" })
    ).toBeVisible()
  })

  test("Downloads tab shows retried badge and terminal timestamp labels for restarted tasks", async ({
    page,
    extensionId,
  }) => {
    const now = Date.now()
    const seededQueue: DownloadTaskState[] = [
      makeTask("retried-canceled-options", "canceled", {
        seriesTitle: "Retried Canceled Options",
        created: now - 5000,
        completed: now - 1000,
        isRetried: true,
      }),
      makeTask("retried-failed-options", "failed", {
        seriesTitle: "Retried Failed Options",
        created: now - 7000,
        completed: now - 2000,
        isRetried: true,
        errorMessage: "Network error",
      }),
    ]

    await page.goto(
      `chrome-extension://${extensionId}/options.html?tab=downloads`,
      {
        waitUntil: "domcontentloaded",
      }
    )
    await expect(page.locator("#root")).toBeVisible({ timeout: 10000 })
    await seedDownloadQueueState(page, seededQueue)

    await expect
      .poll(async () => {
        return await page.evaluate(async () => {
          const result = (await chrome.storage.local.get("downloadQueue")) as {
            downloadQueue?: Array<{
              seriesTitle?: string
              isRetried?: boolean
            }>
          }
          return (
            result.downloadQueue
              ?.filter((task) => task.isRetried)
              .map((task) => task.seriesTitle)
              .sort() ?? []
          )
        })
      })
      .toEqual(["Retried Canceled Options", "Retried Failed Options"])

    await expect(page.getByText("Retried Canceled Options")).toBeVisible({
      timeout: 15000,
    })
    await expect(page.getByText("Retried Failed Options")).toBeVisible({
      timeout: 15000,
    })
    await expect(page.getByText(/^retried$/i)).toHaveCount(2)
    await expect(page.getByText(/Canceled at/i)).toBeVisible()
    await expect(page.getByText(/Failed at/i)).toBeVisible()
    await expect(page.getByRole("button", { name: "Restart" })).toHaveCount(0)
    await expect(
      page.getByRole("button", { name: "Retry failed chapters" })
    ).toHaveCount(0)
  })

  test("Site Integrations tab renders integrations and search filters the list", async ({
    page,
    extensionId,
  }) => {
    await page.goto(
      `chrome-extension://${extensionId}/options.html?tab=integrations`,
      {
        waitUntil: "domcontentloaded",
      }
    )
    await expect(page.locator("#root")).toBeVisible({ timeout: 10000 })
    await expect(
      page.getByRole("button", { name: "Site Integrations" })
    ).toBeVisible()

    const searchInput = page.getByPlaceholder(
      "Search site integrations by name or domain..."
    )
    await expect(searchInput).toBeVisible()
    await expect
      .poll(
        async () =>
          await page.locator('[data-testid^="site-integration-card-"]').count()
      )
      .toBeGreaterThan(0)

    await searchInput.fill("mangadex")
    await expect(
      page.locator('[data-testid="site-integration-card-mangadex"]')
    ).toBeVisible()

    await searchInput.fill("definitely-no-such-integration")
    await expect(page.getByText("No integrations found")).toBeVisible()
  })

  test("About / Debug tab persists log level changes", async ({
    page,
    extensionId,
  }) => {
    await page.goto(
      `chrome-extension://${extensionId}/options.html?tab=debug`,
      {
        waitUntil: "domcontentloaded",
      }
    )
    await expect(page.locator("#root")).toBeVisible({ timeout: 10000 })
    await expect(page.getByText("Debug Settings")).toBeVisible()

    await page.getByTestId("log-level-select").click()
    // E2E builds run in development mode, where Debug is the default. Select
    // a different value so this test exercises the unsaved-settings footer.
    await page.getByRole("option", { name: "Error" }).click()
    await page.getByRole("button", { name: "Save Changes" }).click()

    await expect
      .poll(async () => {
        return await page.evaluate(async () => {
          const result = (await chrome.storage.local.get(
            "settings:global"
          )) as {
            settings?: { advanced?: { logLevel?: string } }
            "settings:global"?: { advanced?: { logLevel?: string } }
          }
          return result["settings:global"]?.advanced?.logLevel ?? null
        })
      })
      .toBe("error")

    await page.reload({ waitUntil: "domcontentloaded" })
    await expect(
      page.getByRole("button", { name: "About & Debug" })
    ).toBeVisible()
    await expect(page.getByText("Debug Settings")).toBeVisible()
    await expect(page.getByTestId("log-level-select")).toContainText("Error")
  })
})
