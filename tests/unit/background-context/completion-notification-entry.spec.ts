import { afterEach, expect, it, vi } from "vitest"

import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import type { DownloadTaskState } from "@/src/domain/queue/state"
import { DownloadTaskStateSchema } from "@/src/runtime/queue-state-schemas"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import {
  SETTINGS_STORAGE_KEY,
  SettingsRepository,
} from "@/src/storage/settings-repository"

afterEach(() => vi.unstubAllGlobals())

it("delivers an enabled completed-task notification through the cold production service entry", async () => {
  vi.resetModules()
  const settings = structuredClone(DEFAULT_SETTINGS)
  settings.notifications = true
  const task: DownloadTaskState = DownloadTaskStateSchema.parse({
    id: "completed-notification-task",
    siteIntegrationId: "mangadex",
    mangaId: "series",
    seriesTitle: "Completed series",
    created: 100,
    completed: 200,
    status: "completed",
    settingsSnapshot: createTaskSettingsSnapshot(settings, "mangadex"),
    chapters: [
      {
        id: "chapter",
        url: "https://mangadex.org/chapter/chapter",
        title: "Chapter",
        index: 0,
        requestedPath: "Completed series/Chapter.cbz",
        status: "completed",
        lastUpdated: 200,
        saveConfirmedAt: 200,
        outputDestination: "downloads-api",
        outputs: { requested: 1, committed: 1, failed: 0 },
      },
    ],
  })
  const delivery = Promise.withResolvers<void>()
  const createStarted = Promise.withResolvers<void>()
  const visible: Array<{
    id: string
    options: chrome.notifications.NotificationCreateOptions
  }> = []
  const create = vi.fn(
    async (
      id: string,
      options: chrome.notifications.NotificationCreateOptions
    ) => {
      createStarted.resolve()
      await delivery.promise
      visible.push({ id, options })
      return id
    }
  )
  vi.stubGlobal("chrome", {
    ...chrome,
    runtime: { getURL: (path: string) => `chrome-extension://test/${path}` },
    storage: {
      local: { get: async () => ({ [SETTINGS_STORAGE_KEY]: settings }) },
    },
    notifications: { create },
  })
  const { notifyTerminalDownloadTask } =
    await import("@/entrypoints/background/download-queue-finalization")
  const settled = vi.fn()
  const completion = notifyTerminalDownloadTask({
    task,
    finalStatus: task.status,
    completedCount: 1,
    totalChapters: 1,
    settingsRepository: new SettingsRepository("warn"),
  }).then(settled)
  try {
    await Promise.race([createStarted.promise, completion])
    expect(create).toHaveBeenCalledOnce()
    expect(visible).toEqual([])
    expect(settled).not.toHaveBeenCalled()
    delivery.resolve()
    await expect(completion).resolves.toBeUndefined()

    expect(visible).toHaveLength(1)
    expect(visible[0].id).toContain(task.id)
    expect(visible[0].options.message).toContain(task.seriesTitle)
    expect(settled).toHaveBeenCalledOnce()
  } finally {
    delivery.resolve()
    await completion
  }
})
