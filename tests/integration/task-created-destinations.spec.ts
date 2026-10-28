import { afterEach, describe, expect, it, vi } from "vitest"
import { buildStartDownloadTask } from "@/entrypoints/background/download-queue-enqueue"
import { resolveDownloadPlan } from "@/entrypoints/background/queue-helpers"
import { DestinationHandleCollector } from "@/entrypoints/background/destination-handle-collector"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import { QueueRepository } from "@/src/storage/queue-repository"
import { QueueProjectionService } from "@/src/storage/queue-projection-service"
import { HistoryRepository } from "@/src/storage/history-repository"
import { LOCAL_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import { migrateDurableStateForCurrentSchema } from "@/src/runtime/state-schema-migration"
import { createDispatchLease } from "@/src/runtime/dispatch-lease"
import type { DownloadTaskState } from "@/src/domain/queue/state"

const handles = vi.hoisted(() => new Map<string, object>())
const managed = vi.hoisted(() => new Set<string>())
vi.mock("@/src/storage/fs-access", () => ({
  DOWNLOAD_ROOT_HANDLE_ID: "download-root",
  adoptDownloadRootHandle: vi.fn(async (id: string) => {
    managed.add(id)
  }),
  collectUnusedDownloadRootHandles: vi.fn(
    async (retained: ReadonlySet<string>) => {
      for (const id of managed)
        if (!retained.has(id)) {
          managed.delete(id)
          handles.delete(id)
        }
    }
  ),
}))

function newTask(now = new Date(2026, 9, 21, 23, 59).getTime()) {
  const settings = structuredClone(DEFAULT_SETTINGS)
  settings.downloads.destination = "file-system-access"
  settings.downloads.customDirectoryHandleId = "original"
  settings.downloads.pathTemplate = "<YYYY>/<MM>/<DD>/<SERIES_TITLE>"
  const chapter = {
    id: "chapter",
    title: "Chapter",
    url: "https://mangadex.org/chapter/chapter",
    index: 0,
    status: "queued" as const,
    lastUpdated: now,
  }
  return buildStartDownloadTask({
    taskId: "task",
    now,
    settingsInputs: {
      settings,
      siteSettings: {},
      siteOverride: {},
      sitePolicyDefaults: undefined,
    },
    selectedChapters: [chapter],
    context: {
      sourceUrl: "https://mangadex.org/title/series",
      siteIntegrationId: "mangadex",
      mangaId: "series",
      seriesTitle: "Series",
      chapters: [chapter],
      volumes: [],
      lastUpdated: now,
    },
  })
}

const storageListeners: Array<
  (
    changes: Record<string, chrome.storage.StorageChange>,
    area: chrome.storage.AreaName
  ) => void
> = []

function runtime(stored: Record<string, unknown>) {
  storageListeners.length = 0
  vi.stubGlobal("chrome", {
    action: {
      setBadgeText: vi.fn(async () => undefined),
      setBadgeBackgroundColor: vi.fn(async () => undefined),
    },
    storage: {
      onChanged: {
        addListener: (listener: (typeof storageListeners)[number]) => {
          storageListeners.push(listener)
        },
      },
      session: { set: vi.fn(async () => undefined) },
      local: {
        get: vi.fn(async () => structuredClone(stored)),
        set: vi.fn(async (values: Record<string, unknown>) => {
          const changes = Object.fromEntries(
            Object.entries(values).map(([key, newValue]) => [
              key,
              {
                oldValue: structuredClone(stored[key]),
                newValue: structuredClone(newValue),
              },
            ])
          )
          Object.assign(stored, structuredClone(values))
          for (const listener of storageListeners) listener(changes, "local")
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          for (const key of [keys].flat()) delete stored[key]
        }),
      },
    },
  })
  return new QueueRepository(
    new QueueProjectionService(),
    new HistoryRepository()
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  handles.clear()
  managed.clear()
})

describe("task-created destinations through durable queue boundaries", () => {
  it("keeps the captured folder and date path through defaults changes, cold Retry and Undo", async () => {
    const task = newTask()
    const captured = task.chapters[0].requestedPath
    expect(captured).toBe("2026/10/21/Series/Chapter.cbz")
    const settings = structuredClone(DEFAULT_SETTINGS)
    settings.downloads.customDirectoryHandleId = "replacement"
    const stored: Record<string, unknown> = {
      [LOCAL_STORAGE_KEYS.settings]: settings,
    }
    const queue = runtime(stored)
    await queue.enqueueDownloadTask(task)
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 22, 12))
    expect(
      (await resolveDownloadPlan((await queue.getTask(task.id))!)).chapters[0]
        .resolvedPath
    ).toBe(captured)
    await queue.interruptDownloadTask({
      taskId: task.id,
      errorMessage: "save failed",
      now: Date.now(),
    })
    const cold = new QueueRepository(
      new QueueProjectionService(),
      new HistoryRepository()
    )
    const restarted = await cold.restartDownloadTask({
      taskId: task.id,
      restartTaskId: "restart",
      now: Date.now(),
    })
    expect(restarted.outcome).toBe("applied")
    const retry = (await cold.getTask("restart"))!
    expect(retry.settingsSnapshot.destination).toEqual({
      kind: "file-system-access",
      handleId: "original",
    })
    expect(retry.chapters[0].requestedPath).toBe(captured)
    const removal = await cold.removeTerminalDownloadTask({
      taskId: task.id,
      undoToken: "undo",
      now: Date.now(),
    })
    expect(removal.outcome).toBe("applied")
    await cold.restorePendingUndoAction({ token: "undo", now: Date.now() })
    expect((await cold.getTask(task.id))?.settingsSnapshot.destination).toEqual(
      task.settingsSnapshot.destination
    )
  })

  it("retains task, Undo and live lease owners across collector reconstruction", async () => {
    const task: DownloadTaskState = {
      ...newTask(),
      status: "failed",
      chapters: newTask().chapters.map((chapter) => ({
        ...chapter,
        status: "failed",
      })),
    }
    const settings = structuredClone(DEFAULT_SETTINGS)
    const stored: Record<string, unknown> = {
      [LOCAL_STORAGE_KEYS.settings]: settings,
      [LOCAL_STORAGE_KEYS.downloadQueue]: [task],
    }
    handles.set("original", {})
    handles.set("stage", {})
    managed.add("original")
    const queue = runtime(stored)
    const collect = () =>
      new DestinationHandleCollector({
        queueRepository: queue,
        settingsRepository: { reload: async () => settings },
        pendingHandleIds: () => new Set(),
      }).collect()
    await collect()
    expect(handles.has("original")).toBe(true)
    await queue.removeTerminalDownloadTask({
      taskId: task.id,
      undoToken: "undo",
      now: 1,
    })
    await collect()
    expect(handles.has("original")).toBe(true)
    stored[LOCAL_STORAGE_KEYS.activeDispatchLease] = createDispatchLease({
      jobId: "job",
      attempt: 1,
      taskId: task.id,
      chapterId: "chapter",
      fingerprint: "a".repeat(64),
      saveMode: "fsa",
      destinationHandleId: "original",
      now: 1,
    })
    await queue.initialize()
    await queue.finalizePendingUndoAction("undo")
    await collect()
    expect(handles.has("original")).toBe(true)
    stored[LOCAL_STORAGE_KEYS.activeDispatchLease] = null
    await queue.initialize()
    await collect()
    expect(handles.has("original")).toBe(false)
    expect(handles.has("stage")).toBe(true)
  })

  it("collects a folder from the registered event path when its final dispatch lease clears", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS)
    const lease = createDispatchLease({
      jobId: "job",
      attempt: 1,
      taskId: "gone",
      chapterId: "chapter",
      fingerprint: "a".repeat(64),
      saveMode: "fsa",
      destinationHandleId: "original",
      now: 1,
    })
    const stored = {
      [LOCAL_STORAGE_KEYS.settings]: settings,
      [LOCAL_STORAGE_KEYS.activeDispatchLease]: lease,
    }
    const queue = runtime(stored)
    handles.set("original", {})
    managed.add("original")
    const reload = vi.fn(async () => settings)
    const collector = new DestinationHandleCollector({
      queueRepository: queue,
      settingsRepository: { reload },
      pendingHandleIds: () => new Set(),
    })
    collector.register(async () => undefined)
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce())
    expect(handles.has("original")).toBe(true)
    await queue.clearDispatchLease(lease)
    await vi.waitFor(() => expect(handles.has("original")).toBe(false))
  })

  it("preserves a historical explicit Chrome choice and releases its obsolete folder block", async () => {
    const current = newTask()
    const source = {
      ...current,
      destinationOverride: "downloads-api",
      activeBlock: "destination_action_required",
      destinationIssue: {
        id: "issue",
        taskId: current.id,
        kind: "fsa_permission_required",
        occurredAt: 1,
      },
      settingsSnapshot: {
        ...current.settingsSnapshot,
        destination: "file-system-access",
      },
      chapters: current.chapters.map(
        ({ requestedPath: _path, ...chapter }) => chapter
      ),
    }
    const stored: Record<string, unknown> = {
      stateSchemaEpoch: 5,
      [LOCAL_STORAGE_KEYS.downloadQueue]: [source],
      [LOCAL_STORAGE_KEYS.pendingUndoActions]: [],
    }
    const queue = runtime(stored)
    await migrateDurableStateForCurrentSchema()
    expect(await queue.getTask(current.id)).toMatchObject({
      status: "queued",
      activeBlock: undefined,
      destinationIssue: undefined,
      settingsSnapshot: { destination: { kind: "downloads-api" } },
    })
  })

  it("replays the prepared target and unavailable-path facts after a canonical write fails", async () => {
    const current = newTask()
    const source = {
      ...current,
      settingsSnapshot: {
        ...current.settingsSnapshot,
        destination: "file-system-access",
        fileNameTemplate: "<INVALID>",
      },
      chapters: current.chapters.map(
        ({ requestedPath: _path, ...chapter }) => chapter
      ),
    }
    const stored: Record<string, unknown> = {
      stateSchemaEpoch: 5,
      [LOCAL_STORAGE_KEYS.downloadQueue]: [source],
      [LOCAL_STORAGE_KEYS.pendingUndoActions]: [],
    }
    const queue = runtime(stored)
    const write = vi.mocked(chrome.storage.local.set)
    const commit = write.getMockImplementation()!
    let fail = true
    write.mockImplementation(async (values) => {
      if (fail && LOCAL_STORAGE_KEYS.downloadQueue in values) {
        fail = false
        throw new Error("Storage unavailable")
      }
      return commit(values, () => undefined)
    })
    await expect(migrateDurableStateForCurrentSchema()).rejects.toThrow(
      "Storage unavailable"
    )
    const prepared = structuredClone(
      (
        stored.stateSchemaMigrationJournal as {
          writes: Record<string, unknown>
        }
      ).writes[LOCAL_STORAGE_KEYS.downloadQueue]
    )
    await migrateDurableStateForCurrentSchema()
    expect(await queue.getQueue()).toEqual(prepared)
    expect(
      (await queue.getTask(current.id))?.chapters[0].requestedPath
    ).toBeNull()
  })

  it.each([
    {
      label: "bound active archive",
      format: "cbz",
      status: "downloading",
      files: ["2026/10/22/Series/Chapter.cbz"],
      leaseReference: true,
      expected: "2026/10/22/Series/Chapter.cbz",
    },
    {
      label: "recorded archive",
      format: "cbz",
      status: "completed",
      files: ["2026/10/22/Series/Chapter.cbz"],
      expected: "2026/10/22/Series/Chapter.cbz",
    },
    {
      label: "pruned archive",
      format: "cbz",
      status: "completed",
      files: [],
      expected: null,
    },
    {
      label: "different task archive",
      format: "cbz",
      status: "completed",
      files: ["2026/10/22/Other/Chapter.cbz"],
      wrongOwner: true,
      expected: null,
    },
    {
      label: "undispatched archive",
      format: "cbz",
      status: "queued",
      files: [],
      expected: "2026/10/21/Series/Chapter.cbz",
    },
    {
      label: "static archive",
      format: "cbz",
      status: "completed",
      files: [],
      staticPath: true,
      expected: "Library/Series/Chapter.cbz",
    },
    {
      label: "consistent loose directory",
      format: "none",
      status: "completed",
      files: [
        "2026/10/22/Series/Chapter/001.jpg",
        "2026/10/22/Series/Chapter/002.jpg",
      ],
      expected: "2026/10/22/Series/Chapter",
    },
    {
      label: "pruned loose directory",
      pruned: true,
      format: "none",
      status: "completed",
      files: [
        "2026/10/22/Series/Chapter/001.jpg",
        "2026/10/22/Series/Chapter/002.jpg",
      ],
      expected: "2026/10/22/Series/Chapter",
    },
    {
      label: "fully pruned loose directory",
      prunedAll: true,
      format: "none",
      status: "completed",
      files: [
        "2026/10/22/Series/Chapter/001.jpg",
        "2026/10/22/Series/Chapter/002.jpg",
      ],
      expected: null,
    },
    {
      label: "inconsistent loose directories",
      format: "none",
      status: "completed",
      files: [
        "2026/10/22/Series/Chapter/001.jpg",
        "2026/10/23/Series/Chapter/002.jpg",
      ],
      expected: null,
    },
  ] as const)(
    "preserves only provable requested paths for historical $label",
    async (scenario) => {
      const current = newTask()
      const dispatchedAt = new Date(2026, 9, 22, 0, 1).getTime()
      const count = scenario.files.length || 1
      const source = {
        ...current,
        status: scenario.status,
        settingsSnapshot: {
          ...current.settingsSnapshot,
          archiveFormat: scenario.format,
          destination: "downloads-api",
          pathTemplate:
            "staticPath" in scenario
              ? "Library/<SERIES_TITLE>"
              : current.settingsSnapshot.pathTemplate,
        },
        chapters: current.chapters.map(
          ({ requestedPath: _path, ...chapter }) => ({
            ...chapter,
            status: scenario.status,
            ...("leaseReference" in scenario ? { dispatchAttempt: 1 } : {}),
            ...(scenario.status === "completed"
              ? {
                  dispatchAttempt: 1,
                  nativeOutputSettlement: {
                    jobId: "job",
                    attempt: 1,
                    taskId: current.id,
                    chapterId: chapter.id,
                    requested: count,
                    completed: count,
                    interrupted: 0,
                    appliedAt: dispatchedAt + 2,
                  },
                }
              : {}),
          })
        ),
      }
      const stored: Record<string, unknown> = {
        stateSchemaEpoch: 5,
        [LOCAL_STORAGE_KEYS.downloadQueue]: [source],
        [LOCAL_STORAGE_KEYS.pendingUndoActions]: [],
      }
      if (scenario.files.length) {
        const identity = {
          jobId: "job",
          attempt: 1,
          taskId: "wrongOwner" in scenario ? "another-task" : current.id,
          chapterId: current.chapters[0].id,
          fingerprint: "a".repeat(64),
          documentInstanceId: "document",
        }
        if ("leaseReference" in scenario)
          stored[LOCAL_STORAGE_KEYS.activeDispatchLease] = {
            ...identity,
            saveMode: "downloads-api",
            stage: "saving",
            startedAt: dispatchedAt,
            lastActivityAt: dispatchedAt,
            leaseExpiresAt: dispatchedAt + 10000,
            sequence: 1,
          }
        stored["pendingOutputs:index"] = {
          jobIds: ["job"],
          outputIds: scenario.files.map((_, index) => `output-${index}`),
          downloadIdToOutputId: Object.fromEntries(
            scenario.files.map((_, index) => [
              String(17 + index),
              `output-${index}`,
            ])
          ),
        }
        stored["pendingOutputs:manifest:job"] = {
          ...identity,
          phase: "sealed",
          outputsRequested: count,
          outputsFailedBeforeHandoff: 0,
          slots: scenario.files.map((_, index) => ({
            disposition: "tracked",
            outputId: `output-${index}`,
          })),
          createdAt: dispatchedAt,
          sealedAt: dispatchedAt + 2,
        }
        scenario.files.forEach((filename, index) => {
          stored[`pendingOutputs:output:output-${index}`] = {
            ...identity,
            outputId: `output-${index}`,
            outputIndex: index,
            outputCount: count,
            blobUrl: `blob:output-${index}`,
            filename,
            outputKind: scenario.format === "none" ? "image" : "archive",
            phase: "complete",
            createdAt: dispatchedAt,
            acceptanceStartedAt: dispatchedAt + 1,
            terminalAt: dispatchedAt + 10,
            downloadId: 17 + index,
            accountingDisposition:
              "leaseReference" in scenario ? "pending" : "accounted",
            ...("leaseReference" in scenario
              ? {}
              : { accountingDispositionAt: dispatchedAt + 2 }),
          }
        })
      }
      if ("pruned" in scenario || "prunedAll" in scenario) {
        delete stored["pendingOutputs:output:output-0"]
        if ("prunedAll" in scenario)
          delete stored["pendingOutputs:output:output-1"]
        stored["pendingOutputs:index"] = {
          jobIds: ["job"],
          outputIds: "prunedAll" in scenario ? [] : ["output-1"],
          downloadIdToOutputId:
            "prunedAll" in scenario ? {} : { "18": "output-1" },
        }
      }
      const queue = runtime(stored)
      await migrateDurableStateForCurrentSchema()
      expect((await queue.getTask(current.id))?.chapters[0].requestedPath).toBe(
        scenario.expected
      )
    }
  )

  it("preserves unrecoverable historical folders and paths as terminal records without assigning current defaults", async () => {
    const current = newTask()
    const source = {
      ...current,
      settingsSnapshot: {
        ...current.settingsSnapshot,
        destination: "file-system-access",
        fileNameTemplate: "<INVALID_MACRO>",
      },
      chapters: current.chapters.map(
        ({ requestedPath: _path, ...chapter }) => chapter
      ),
    }
    const settings = structuredClone(DEFAULT_SETTINGS)
    settings.downloads.customDirectoryHandleId = "replacement"
    const stored: Record<string, unknown> = {
      stateSchemaEpoch: 5,
      [LOCAL_STORAGE_KEYS.settings]: settings,
      [LOCAL_STORAGE_KEYS.downloadQueue]: [source],
      [LOCAL_STORAGE_KEYS.pendingUndoActions]: [],
    }
    const queue = runtime(stored)
    await migrateDurableStateForCurrentSchema()
    const task = (await queue.getTask(current.id))!
    expect(task).toMatchObject({
      status: "failed",
      settingsSnapshot: {
        destination: { kind: "file-system-access", handleId: null },
      },
      chapters: [{ requestedPath: null, status: "failed" }],
    })
    expect(task.errorMessage).toContain("Create a new task")
    expect(
      await queue.restartDownloadTask({
        taskId: current.id,
        restartTaskId: "retry",
        now: Date.now(),
      })
    ).toMatchObject({ outcome: "rejected", reason: "invalid-status" })
  })
})
