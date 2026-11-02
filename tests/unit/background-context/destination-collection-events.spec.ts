import { setImmediate as nextTurn } from "node:timers/promises"
import { afterEach, describe, expect, it, vi } from "vitest"
import { runDestinationAccessExclusive } from "@/entrypoints/background/destination-access"
import { DestinationHandleCollector } from "@/entrypoints/background/destination-handle-collector"
import {
  DestinationService,
  type DestinationPreflight,
} from "@/entrypoints/background/destination"
import type { DownloadTaskState } from "@/src/domain/queue/state"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import { createDispatchLease } from "@/src/runtime/dispatch-lease"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { LOCAL_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import { HistoryRepository } from "@/src/storage/history-repository"
import { NativeOutputRepository } from "@/src/storage/native-output-repository"
import { QueueProjectionService } from "@/src/storage/queue-projection-service"
import { QueueRepository } from "@/src/storage/queue-repository"
import {
  SETTINGS_STORAGE_KEY,
  SettingsRepository,
} from "@/src/storage/settings-repository"

function exposeHandleStores(handles: Map<string, unknown>) {
  const managed = new Map<string, unknown>(
    [...handles.keys()].map((key) => [key, true])
  )
  const stores = new Map([
    ["handles", handles],
    ["managed-handles", managed],
  ])
  vi.stubGlobal("indexedDB", {
    open: () => {
      const database = {
        close: () => undefined,
        transaction: () => {
          const transaction = {
            oncomplete: undefined as (() => void) | undefined,
            pending: 0,
            completed: false,
            objectStore: (name: string) => {
              const store = stores.get(name)!
              const request = (operation: () => unknown) => {
                transaction.pending++
                const result = {
                  result: undefined as unknown,
                  onsuccess: undefined as (() => void) | undefined,
                }
                queueMicrotask(() => {
                  result.result = operation()
                  result.onsuccess?.()
                  transaction.pending--
                  queueMicrotask(() => {
                    if (transaction.pending === 0 && !transaction.completed) {
                      transaction.completed = true
                      transaction.oncomplete?.()
                    }
                  })
                })
                return result
              }
              return {
                get: (key: string) => request(() => store.get(key)),
                put: (value: unknown, key: string) =>
                  request(() => store.set(key, value)),
                delete: (key: string) => request(() => store.delete(key)),
                getAllKeys: () => request(() => [...store.keys()]),
              }
            },
          }
          return transaction
        },
      }
      const request = {
        result: database,
        onsuccess: undefined as (() => void) | undefined,
      }
      queueMicrotask(() => request.onsuccess?.())
      return request
    },
  })
  return { handles, managed }
}

function folderSettings(handleId: string) {
  const settings = structuredClone(DEFAULT_SETTINGS)
  settings.downloads.destination = "file-system-access"
  settings.downloads.customDirectoryHandleId = handleId
  return settings
}

async function fixture() {
  const local: Record<string, unknown> = {}
  const session: Record<string, unknown> = {}
  const releaseRead = Promise.withResolvers<void>()
  let blockSettingsReads = false
  let localChangedKeys: string[] = []
  let sessionChangedKeys: string[] = []
  let listener:
    Parameters<typeof chrome.storage.onChanged.addListener>[0] | undefined
  const area = (values: Record<string, unknown>, localArea = false) => ({
    get: async (keys: string | string[]) => {
      const requested = [keys].flat()
      if (
        localArea &&
        blockSettingsReads &&
        requested.includes(SETTINGS_STORAGE_KEY)
      )
        await releaseRead.promise
      return Object.fromEntries(
        requested.map((key) => [key, structuredClone(values[key])])
      )
    },
    set: async (valuesToSet: Record<string, unknown>) => {
      Object.assign(values, structuredClone(valuesToSet))
      if (localArea) localChangedKeys = Object.keys(valuesToSet)
      else sessionChangedKeys = Object.keys(valuesToSet)
    },
    remove: async (keys: string | string[]) => {
      for (const key of [keys].flat()) delete values[key]
    },
  })
  vi.stubGlobal("chrome", {
    runtime: { id: "collection-events" },
    storage: {
      local: area(local, true),
      session: area(session),
      onChanged: {
        addListener: (callback: NonNullable<typeof listener>) => {
          listener = callback
        },
      },
    },
    action: {
      setBadgeText: async () => undefined,
      setBadgeBackgroundColor: async () => undefined,
    },
  })
  const handles = new Map<string, unknown>(
    ["task-folder", "default-a", "default-b", "retired"].map((id) => [
      id,
      { queryPermission: async () => "granted" },
    ])
  )
  const database = exposeHandleStores(handles)
  const settingsRepository = new SettingsRepository("warn")
  const taskSettings = folderSettings("task-folder")
  await settingsRepository.replaceSettings(taskSettings)
  const projection = new QueueProjectionService()
  const queue = new QueueRepository(projection, new HistoryRepository())
  const task: DownloadTaskState = {
    id: "folder-task",
    siteIntegrationId: "mangadex",
    mangaId: "series",
    seriesTitle: "Series",
    created: 100,
    status: "queued",
    settingsSnapshot: createTaskSettingsSnapshot(taskSettings, "mangadex"),
    chapters: [
      {
        id: "chapter",
        title: "Chapter",
        url: "https://mangadex.org/chapter/chapter",
        requestedPath: "Series/Chapter.cbz",
        index: 0,
        status: "queued",
        lastUpdated: 100,
      },
    ],
  }
  await queue.enqueueDownloadTask(task)
  const chromeSettings = structuredClone(DEFAULT_SETTINGS)
  await queue.enqueueDownloadTask({
    ...task,
    id: "chrome-task",
    settingsSnapshot: createTaskSettingsSnapshot(chromeSettings, "mangadex"),
  })
  await queue.startDownloadTask({ taskId: "chrome-task", now: 200 })
  const lease = {
    ...createDispatchLease({
      jobId: "native-job",
      taskId: "chrome-task",
      chapterId: "chapter",
      attempt: 1,
      fingerprint: "a".repeat(64),
      saveMode: "downloads-api",
      now: 300,
    }),
    documentInstanceId: "native-document",
  }
  await queue.beginChapterDispatch({
    taskId: "chrome-task",
    chapterId: "chapter",
    lease,
    expectedPreviousLease: null,
    now: 300,
  })
  await settingsRepository.replaceSettings(folderSettings("default-a"))
  const pending = new Set(["default-b"])
  const collector = new DestinationHandleCollector({
    queueRepository: queue,
    settingsRepository,
    pendingHandleIds: () => pending,
  })
  const emit = (keys: string[], name: "local" | "session" = "local") => {
    const values = name === "local" ? local : session
    listener!(
      Object.fromEntries(keys.map((key) => [key, { newValue: values[key] }])),
      name
    )
  }
  const drainCollection = async () => {
    await nextTurn()
    await runDestinationAccessExclusive(async () => undefined)
  }
  collector.register(async () => undefined)
  await drainCollection()
  return {
    queue,
    projection,
    settingsRepository,
    collector,
    pending,
    database,
    emit,
    drainCollection,
    lease,
    session,
    localChangedKeys: () => [...localChangedKeys],
    sessionChangedKeys: () => [...sessionChangedKeys],
    holdSettingsReads: () => {
      blockSettingsReads = true
    },
    releaseSettingsReads: () => releaseRead.resolve(),
  }
}

afterEach(() => vi.unstubAllGlobals())

describe("registered destination capability collection", () => {
  it("follows committed default, task and Undo reference changes before reclaiming capabilities", async () => {
    const runtime = await fixture()
    expect(runtime.database.handles.has("retired")).toBe(false)
    expect(runtime.database.handles.has("task-folder")).toBe(true)
    await runtime.settingsRepository.replaceSettings(
      folderSettings("default-b")
    )
    runtime.pending.delete("default-b")
    runtime.emit([SETTINGS_STORAGE_KEY])
    await runtime.drainCollection()
    expect(runtime.database.handles.has("default-a")).toBe(false)
    expect(runtime.database.handles.has("default-b")).toBe(true)

    await runtime.queue.cancelDownloadTask({
      taskId: "folder-task",
      commandId: "cancel-folder",
      now: 400,
    })
    runtime.emit([
      LOCAL_STORAGE_KEYS.downloadQueue,
      LOCAL_STORAGE_KEYS.pendingUndoActions,
    ])
    await runtime.drainCollection()
    expect(runtime.database.handles.has("task-folder")).toBe(true)
    await runtime.queue.finalizePendingUndoAction("cancel:cancel-folder")
    await runtime.queue.removeTerminalDownloadTask({
      taskId: "folder-task",
      undoToken: "remove-folder",
      now: 500,
    })
    runtime.emit([
      LOCAL_STORAGE_KEYS.downloadQueue,
      LOCAL_STORAGE_KEYS.pendingUndoActions,
    ])
    await runtime.drainCollection()
    expect(runtime.database.handles.has("task-folder")).toBe(true)
    await runtime.queue.finalizePendingUndoAction("remove-folder")
    runtime.emit([
      LOCAL_STORAGE_KEYS.downloadQueue,
      LOCAL_STORAGE_KEYS.pendingUndoActions,
    ])
    await runtime.drainCollection()
    expect(runtime.database.handles.has("task-folder")).toBe(false)
    expect(runtime.database.handles.has("default-b")).toBe(true)
  })

  it("keeps unrelated native and session updates from delaying a real destination operation", async () => {
    const runtime = await fixture()
    let operation: Promise<DestinationPreflight> | undefined
    runtime.holdSettingsReads()
    try {
      const native = new NativeOutputRepository()
      await native.ensureManifest({
        ...runtime.lease,
        outputsRequested: 0,
        now: 400,
      })
      runtime.emit(runtime.localChangedKeys())
      await runtime.projection.publish(await runtime.queue.getQueue())
      runtime.emit(runtime.sessionChangedKeys(), "session")
      await nextTurn()

      let completed = false
      operation = runDestinationAccessExclusive(async () => {
        const result = await new DestinationService().preflight({
          taskId: "destination-operation",
          destination: { kind: "file-system-access", handleId: "default-a" },
        })
        completed = true
        return result
      })
      await nextTurn()
      expect(completed).toBe(true)
      await expect(operation).resolves.toEqual({ ready: true })
    } finally {
      runtime.releaseSettingsReads()
      await operation
      await runtime.drainCollection()
    }
  })
})
