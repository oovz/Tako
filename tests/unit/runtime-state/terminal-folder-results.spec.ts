import { describe, expect, it } from "vitest"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { buildTerminalSaveWrites } from "@/src/runtime/state-schema-migration-terminal-saves"

function blockedTask() {
  const settings = structuredClone(DEFAULT_SETTINGS)
  settings.downloads.destination = "file-system-access"
  settings.downloads.customDirectoryHandleId = "folder"
  return {
    id: "task",
    siteIntegrationId: "mangadex",
    mangaId: "series",
    seriesTitle: "Series",
    status: "queued",
    created: 1,
    settingsSnapshot: createTaskSettingsSnapshot(settings, "mangadex"),
    activeBlock: "destination_action_required",
    destinationIssue: {
      id: "issue",
      taskId: "task",
      chapterId: "later",
      kind: "fsa_permission_required",
      occurredAt: 10,
    },
    chapters: [
      {
        id: "first",
        url: "https://mangadex.org/chapter/1",
        title: "First",
        index: 0,
        status: "queued",
        requestedPath: "Series/First.cbz",
        lastUpdated: 1,
      },
      {
        id: "later",
        url: "https://mangadex.org/chapter/2",
        title: "Later",
        index: 1,
        status: "queued",
        requestedPath: "Series/Later.cbz",
        lastUpdated: 1,
      },
    ],
  }
}

describe("terminal conversion of folder-action blocks", () => {
  it.each([
    ["fsa_permission_required", "folder_permission_required"],
    ["fsa_write_failed", "folder_write_failed"],
    ["disk_full", "disk_full"],
    ["fsa_folder_missing", "folder_unavailable"],
  ])(
    "retains the recorded %s cause and fails the indicated pending chapter",
    (kind, errorCategory) => {
      const task = blockedTask()
      task.destinationIssue.kind = kind
      const writes = buildTerminalSaveWrites({ downloadQueue: [task] })
      expect(writes.downloadQueue).toMatchObject([
        {
          status: "failed",
          errorCategory,
          chapters: [
            { status: "skipped" },
            { status: "failed", errorCategory },
          ],
        },
      ])
    }
  )

  it("uses the downloading chapter when the issue identifies a finished chapter", () => {
    const task = blockedTask()
    task.status = "downloading"
    task.chapters[0].status = "downloading"
    task.chapters[1].status = "completed"
    const writes = buildTerminalSaveWrites({ downloadQueue: [task] })
    expect(writes.downloadQueue).toMatchObject([
      {
        status: "partial_success",
        chapters: [{ status: "failed" }, { status: "completed" }],
      },
    ])
  })
})
