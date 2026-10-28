import { afterEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import {
  CURRENT_STATE_SCHEMA_EPOCH,
  migrateDurableStateForCurrentSchema,
} from "@/src/runtime/state-schema-migration"
import { HistoryRepository } from "@/src/storage/history-repository"
import { QueueProjectionService } from "@/src/storage/queue-projection-service"
import { QueueRepository } from "@/src/storage/queue-repository"

function fixture(committed: number) {
  const settings = structuredClone(DEFAULT_SETTINGS)
  settings.downloads.destination = "file-system-access"
  settings.downloads.customDirectoryHandleId = "captured-folder"
  const task = {
    id: "task",
    siteIntegrationId: "mangadex",
    mangaId: "series",
    seriesTitle: "Series",
    status: "queued",
    created: 1,
    settingsSnapshot: createTaskSettingsSnapshot(settings, "mangadex"),
    activeBlock: "destination_action_required",
    destinationBlockRevision: 2,
    destinationIssue: {
      id: "issue",
      taskId: "task",
      chapterId: "chapter",
      kind: "fsa_write_failed",
      occurredAt: 10,
    },
    errorCategory: "folder_write_failed",
    errorMessage: "Native writable stream failed",
    chapters: [
      {
        id: "chapter",
        url: "https://mangadex.org/chapter/1",
        title: "Chapter",
        index: 0,
        requestedPath: "Series/Chapter.cbz",
        status: "queued",
        lastUpdated: 10,
        outputs: { requested: 2, committed, failed: 2 - committed },
      },
      {
        id: "later",
        url: "https://mangadex.org/chapter/2",
        title: "Later",
        index: 1,
        requestedPath: "Series/Later.cbz",
        status: "queued",
        lastUpdated: 1,
      },
    ],
  }
  const stored: Record<string, unknown> = {
    stateSchemaEpoch: 7,
    downloadQueue: [task],
    pendingUndoActions: [
      {
        token: "undo",
        type: "remove_history",
        taskSnapshot: {
          ...task,
          id: "undo-task",
          destinationIssue: { ...task.destinationIssue, taskId: "undo-task" },
        },
        previousQueuePosition: 0,
        createdAt: 11,
        expiresAt: 9999999999999,
      },
    ],
  }
  const storage = {
    get: vi.fn(async (keys: string | string[]) =>
      Object.fromEntries(
        [keys]
          .flat()
          .filter((key) => key in stored)
          .map((key) => [key, structuredClone(stored[key])])
      )
    ),
    set: vi.fn(async (values: Record<string, unknown>) => {
      Object.assign(stored, structuredClone(values))
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const key of [keys].flat()) delete stored[key]
    }),
  }
  vi.stubGlobal("chrome", {
    storage: { local: storage, session: { set: vi.fn(async () => undefined) } },
  })
  return { stored, storage }
}
afterEach(() => vi.unstubAllGlobals())
describe("terminal folder save upgrades", () => {
  it.each([0, 1])(
    "retains %s committed files and original destination through queue and Undo conversion",
    async (committed) => {
      const { stored } = fixture(committed)
      await migrateDurableStateForCurrentSchema()
      const queue = new QueueRepository(
        new QueueProjectionService(),
        new HistoryRepository()
      )
      await queue.initialize()
      expect(await queue.getTask("task")).toMatchObject({
        status: committed ? "partial_success" : "failed",
        errorMessage: "Native writable stream failed",
        errorCategory: "folder_write_failed",
        chapters: [
          {
            status: committed ? "partial_success" : "failed",
            outputs: { committed },
          },
          { status: "skipped" },
        ],
        settingsSnapshot: {
          destination: {
            kind: "file-system-access",
            handleId: "captured-folder",
          },
        },
      })
      expect(stored.pendingUndoActions).toMatchObject([
        {
          taskSnapshot: {
            status: committed ? "partial_success" : "failed",
            chapters: [{ outputs: { committed } }, { status: "skipped" }],
          },
        },
      ])
      expect(await queue.getTask("task")).not.toHaveProperty("destinationIssue")
      expect(await queue.getTask("task")).not.toHaveProperty(
        "destinationBlockRevision"
      )
      expect(stored.stateSchemaEpoch).toBe(CURRENT_STATE_SCHEMA_EPOCH)
      const before = structuredClone(stored)
      await migrateDurableStateForCurrentSchema()
      expect(stored).toEqual(before)
    }
  )
  it("resumes a prepared terminal conversion after the canonical write fails", async () => {
    const { stored, storage } = fixture(1)
    let fail = true
    storage.set.mockImplementation(async (values) => {
      if (fail && "downloadQueue" in values) {
        fail = false
        throw new Error("Storage unavailable")
      }
      Object.assign(stored, structuredClone(values))
    })
    await expect(migrateDurableStateForCurrentSchema()).rejects.toThrow(
      "Storage unavailable"
    )
    expect(stored.stateSchemaEpoch).toBe(7)
    await migrateDurableStateForCurrentSchema()
    expect(stored.downloadQueue).toMatchObject([
      {
        status: "partial_success",
        errorMessage: "Native writable stream failed",
      },
    ])
    expect(stored).not.toHaveProperty("stateSchemaMigrationJournal")
  })
})
