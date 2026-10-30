import { expect, it } from "vitest"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { buildTaskDestinationWrites } from "@/src/runtime/state-schema-migration-task-destinations"

it("preserves finished chapters and committed files when the historical folder identity cannot be recovered", () => {
  const settings = structuredClone(DEFAULT_SETTINGS)
  settings.downloads.destination = "file-system-access"
  const snapshot = createTaskSettingsSnapshot(settings, "mangadex")
  const chapter = {
    url: "https://mangadex.org/chapter/1",
    title: "Chapter",
    index: 0,
    lastUpdated: 2,
  }
  const writes = buildTaskDestinationWrites({
    downloadQueue: [
      {
        id: "task",
        siteIntegrationId: "mangadex",
        mangaId: "series",
        seriesTitle: "Series",
        created: 1,
        status: "downloading",
        settingsSnapshot: { ...snapshot, destination: "file-system-access" },
        chapters: [
          {
            ...chapter,
            id: "finished",
            status: "completed",
            outputs: { requested: 1, committed: 1, failed: 0 },
          },
          {
            ...chapter,
            id: "in-flight",
            status: "downloading",
            outputs: { requested: 2, committed: 1, failed: 0 },
          },
          { ...chapter, id: "unstarted", status: "queued" },
          { ...chapter, id: "skipped", status: "skipped" },
        ],
      },
    ],
  })
  expect(writes.downloadQueue).toMatchObject([
    {
      status: "partial_success",
      errorCategory: "folder_unavailable",
      settingsSnapshot: {
        destination: { kind: "file-system-access", handleId: null },
      },
      chapters: [
        {
          id: "finished",
          status: "completed",
          lastUpdated: 2,
          outputs: { requested: 1, committed: 1, failed: 0 },
        },
        {
          id: "in-flight",
          status: "partial_success",
          errorCategory: "folder_unavailable",
          outputs: { requested: 2, committed: 1, failed: 1 },
        },
        {
          id: "unstarted",
          status: "failed",
          errorCategory: "folder_unavailable",
        },
        { id: "skipped", status: "skipped", lastUpdated: 2 },
      ],
    },
  ])
})
