import { describe, expect, it } from "vitest"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { DownloadTaskStateSchema as CurrentTaskSchema } from "@/src/runtime/queue-state-schemas"
import { DownloadTaskStateSchema as Epoch6TaskSchema } from "@/src/runtime/state-schema-migration-task-destination-schemas"
import { DownloadTaskStateSchema as Epoch7TaskSchema } from "@/src/runtime/state-schema-migration-final-save-schemas"
import { DownloadTaskStateSchema as Epoch8TaskSchema } from "@/src/runtime/state-schema-migration-terminal-save-schemas"
import { DownloadTaskStateSchema as Epoch3TaskSchema } from "@/src/runtime/state-schema-migration-queue-schemas"

function task() {
  return {
    id: "task",
    siteIntegrationId: "mangadex",
    mangaId: "series",
    seriesTitle: "Series",
    created: 1,
    status: "queued",
    settingsSnapshot: createTaskSettingsSnapshot(DEFAULT_SETTINGS, "mangadex"),
    chapters: [
      {
        id: "chapter",
        url: "https://mangadex.org/chapter/1",
        title: "Chapter",
        index: 0,
        status: "queued",
        requestedPath: "Series/Chapter.cbz",
        lastUpdated: 1,
      },
    ],
  }
}

const capturedSchemas = [
  ["epoch6", Epoch6TaskSchema],
  ["epoch7", Epoch7TaskSchema],
  ["epoch8", Epoch8TaskSchema],
  ["current", CurrentTaskSchema],
] as const

describe.each(capturedSchemas)("%s captured destinations", (_epoch, schema) => {
  it("accepts complete active targets and retains unavailable destination facts on terminal tasks", () => {
    expect(schema.safeParse(task()).success).toBe(true)
    const original = task()
    expect(
      schema.safeParse({
        ...original,
        status: "failed",
        settingsSnapshot: {
          ...original.settingsSnapshot,
          destination: { kind: "file-system-access", handleId: null },
        },
        chapters: [
          { ...original.chapters[0], status: "failed", requestedPath: null },
        ],
      }).success
    ).toBe(true)
  })
  it.each(["queued", "downloading"])(
    "requires the folder and path before %s work can continue",
    (status) => {
      const original = task()
      const parsed = schema.safeParse({
        ...original,
        status,
        settingsSnapshot: {
          ...original.settingsSnapshot,
          destination: { kind: "file-system-access", handleId: null },
        },
        chapters: [{ ...original.chapters[0], status, requestedPath: null }],
      })
      expect(parsed.success).toBe(false)
      expect(parsed.error?.issues.map((issue) => issue.path)).toEqual([
        ["settingsSnapshot", "destination"],
        ["chapters"],
      ])
    }
  )
})

function legacyTask() {
  const original = task()
  const chapters = original.chapters.map((chapter) => {
    const legacy: Partial<typeof chapter> = { ...chapter }
    delete legacy.requestedPath
    return legacy
  })
  return {
    ...original,
    chapters,
    settingsSnapshot: {
      ...original.settingsSnapshot,
      destination: "downloads-api",
    },
  }
}

const pairedSchemas = [
  ["epoch3", Epoch3TaskSchema, legacyTask],
  ["epoch6", Epoch6TaskSchema, task],
  ["epoch7", Epoch7TaskSchema, task],
] as const

describe.each(pairedSchemas)(
  "%s paired folder issues",
  (_epoch, schema, source) => {
    const issue = {
      id: "issue",
      taskId: "task",
      chapterId: "chapter",
      kind: "fsa_permission_required",
      occurredAt: 2,
    }
    it("accepts the paired task and rejects missing, orphaned or foreign issue identities", () => {
      const original = source()
      expect(
        schema.safeParse({
          ...original,
          activeBlock: "destination_action_required",
          destinationIssue: issue,
        }).success
      ).toBe(true)
      const missing = schema.safeParse({
        ...original,
        activeBlock: "destination_action_required",
      })
      expect(missing.error?.issues.map((value) => value.path)).toEqual([
        ["destinationIssue"],
      ])
      const orphaned = schema.safeParse({
        ...original,
        destinationIssue: issue,
      })
      expect(orphaned.error?.issues.map((value) => value.path)).toEqual([
        ["destinationIssue"],
      ])
      const foreign = schema.safeParse({
        ...original,
        activeBlock: "destination_action_required",
        destinationIssue: { ...issue, taskId: "other", chapterId: "other" },
      })
      expect(foreign.error?.issues.map((value) => value.path)).toEqual([
        ["destinationIssue", "taskId"],
        ["destinationIssue", "chapterId"],
      ])
    })
  }
)

describe("current captured fallback consent", () => {
  it("requires captured folder consent and one effective fallback state", () => {
    const original = task()
    expect(
      CurrentTaskSchema.safeParse({ ...original, fsaFallbackEligible: true })
        .success
    ).toBe(false)
    const consented = {
      ...original,
      settingsSnapshot: {
        ...original.settingsSnapshot,
        allowChromeFallback: true,
        destination: { kind: "file-system-access", handleId: "folder" },
      },
    }
    expect(
      CurrentTaskSchema.safeParse({ ...consented, fsaFallbackEligible: true })
        .success
    ).toBe(true)
    expect(
      CurrentTaskSchema.safeParse({ ...consented, useChromeFallback: true })
        .success
    ).toBe(true)
    const ambiguous = CurrentTaskSchema.safeParse({
      ...consented,
      fsaFallbackEligible: true,
      useChromeFallback: true,
    })
    expect(ambiguous.error?.issues.map((value) => value.path)).toEqual([[]])
  })
  it("reports fallback consent before destination and path errors", () => {
    const original = task()
    const parsed = CurrentTaskSchema.safeParse({
      ...original,
      fsaFallbackEligible: true,
      settingsSnapshot: {
        ...original.settingsSnapshot,
        destination: { kind: "file-system-access", handleId: null },
      },
      chapters: [{ ...original.chapters[0], requestedPath: null }],
    })
    expect(parsed.error?.issues.map((value) => value.path)).toEqual([
      [],
      ["settingsSnapshot", "destination"],
      ["chapters"],
    ])
  })
})
