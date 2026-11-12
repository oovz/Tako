import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { test, expect } from "./fixtures/extension"
import {
  makeChapter,
  makeTask,
  openTaskFeedback,
  seedGlobalQueue,
} from "./fixtures/queue-test-helpers"
import { buildExampleUrl } from "./fixtures/test-domains-constants"

test("opens the affected Activity card from a folder error, even outside the virtual list viewport", async ({
  context,
  extensionId,
  page,
}) => {
  const now = Date.now()
  const taskId = "folder-recovery&activity"
  const seriesTitle = "Folder recovery title"
  const previousFailures = Array.from({ length: 55 }, (_, index) =>
    makeTask({
      id: `previous-failure-${index}`,
      seriesTitle: `Previous failure ${index}`,
      status: "failed",
      created: now - 1000 - index,
      completed: now - index - 1,
      chapters: [makeChapter(buildExampleUrl(`/failed/${index}`), "failed")],
    })
  )
  await seedGlobalQueue(context, [
    ...previousFailures,
    makeTask({
      id: taskId,
      seriesTitle,
      status: "failed",
      created: now - 500,
      started: now - 100,
      completed: now,
      settingsSnapshot: createTaskSettingsSnapshot(
        {
          ...DEFAULT_SETTINGS,
          downloads: {
            ...DEFAULT_SETTINGS.downloads,
            destination: "file-system-access",
            customDirectoryHandleId: "recorded-folder",
          },
        },
        "mangadex"
      ),
      chapters: [
        {
          ...makeChapter(buildExampleUrl("/folder-failure"), "failed"),
          errorCategory: "folder_permission_required",
        },
      ],
    }),
  ])
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`)

  const feedback = await openTaskFeedback(
    page.locator("[data-task-id]").filter({ hasText: seriesTitle })
  )
  const [activity] = await Promise.all([
    context.waitForEvent("page"),
    feedback.getByRole("button", { name: "Open folder actions" }).click(),
  ])
  await expect(activity).toHaveURL(/options\.html\?tab=activity&task=/)
  expect(new URL(activity.url()).searchParams.get("task")).toBe(taskId)
  const card = activity.getByRole("group", { name: seriesTitle })
  await expect(card).toBeFocused()
  await expect(card).toBeInViewport()
})
