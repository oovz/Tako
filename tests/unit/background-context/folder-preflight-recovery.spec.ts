import { afterEach, describe, expect, it, vi } from "vitest"
import { ChapterDispatchCoordinator } from "@/entrypoints/background/chapter-dispatch-coordinator"
import { DownloadTaskCancellationCoordinator } from "@/entrypoints/background/download-task-cancellation-coordinator"
import { DownloadTaskExecutor } from "@/entrypoints/background/download-task-executor"
import {
  DestinationPreflightError,
  DestinationService,
} from "@/entrypoints/background/destination"
import { NativeOutputCoordinator } from "@/entrypoints/background/native-output-coordinator"
import { ProviderPolicyQueueCoordinator } from "@/entrypoints/background/provider-policy-queue-coordinator"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import { getEffectiveTaskDestination } from "@/src/domain/queue/task-destination"
import type { DownloadTaskState } from "@/src/domain/queue/state"
import { parseCurrentDownloadQueue } from "@/src/storage/queue-state-codecs"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { buildTaskDestinationWrites } from "@/src/runtime/state-schema-migration-task-destinations"
import { LOCAL_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import { SiteIntegrationSessionRuleManager } from "@/src/site-integrations/session-rule-manager"
import { HistoryRepository } from "@/src/storage/history-repository"
import { NativeOutputRepository } from "@/src/storage/native-output-repository"
import { QueueProjectionService } from "@/src/storage/queue-projection-service"
import { QueueRepository } from "@/src/storage/queue-repository"
import {
  SETTINGS_STORAGE_KEY,
  SettingsRepository,
} from "@/src/storage/settings-repository"

function exposeHandles(handles: Map<string, unknown>) {
  const get = vi.fn((key: string) => {
    const request = {
      result: handles.get(key),
      onsuccess: undefined as (() => void) | undefined,
    }
    queueMicrotask(() => {
      request.onsuccess?.()
      transaction.oncomplete?.()
    })
    return request
  })
  const transaction = {
    objectStore: () => ({ get }),
    oncomplete: undefined as (() => void) | undefined,
    onerror: undefined as (() => void) | undefined,
    onabort: undefined as (() => void) | undefined,
  }
  const database = { transaction: () => transaction, close: vi.fn() }
  const open = vi.fn(() => {
    const request = {
      result: database,
      onsuccess: undefined as (() => void) | undefined,
    }
    queueMicrotask(() => request.onsuccess?.())
    return request
  })
  vi.stubGlobal("indexedDB", { open })
  return { open, get }
}

function storageArea(values: Record<string, unknown>) {
  return {
    get: async (keys: string | string[]) =>
      Object.fromEntries(
        [keys].flat().map((key) => [key, structuredClone(values[key])])
      ),
    set: async (next: Record<string, unknown>) => {
      Object.assign(values, structuredClone(next))
    },
    remove: async (keys: string | string[]) => {
      for (const key of [keys].flat()) delete values[key]
    },
  }
}

function folderSettings() {
  const settings = structuredClone(DEFAULT_SETTINGS)
  settings.downloads.destination = "file-system-access"
  settings.downloads.customDirectoryHandleId = "captured-folder"
  settings.downloads.allowChromeFallback = false
  settings.notifications = false
  return settings
}

async function fixture(permission: PermissionState | "missing") {
  const settings = folderSettings()
  const local: Record<string, unknown> = { [SETTINGS_STORAGE_KEY]: settings }
  vi.stubGlobal("chrome", {
    runtime: { id: "folder-preflight" },
    storage: { local: storageArea(local), session: storageArea({}) },
    action: {
      setBadgeText: vi.fn(async () => undefined),
      setBadgeBackgroundColor: vi.fn(async () => undefined),
    },
  })
  const directory = {
    queryPermission: vi.fn(async () =>
      permission === "missing" ? "granted" : permission
    ),
    requestPermission: vi.fn(),
    getDirectoryHandle: vi.fn(),
    getFileHandle: vi.fn(),
  }
  const handles = new Map<string, unknown>([["captured-folder", directory]])
  const database = exposeHandles(handles)
  const history = new HistoryRepository()
  const queue = new QueueRepository(new QueueProjectionService(), history)
  const task: DownloadTaskState = {
    id: "folder-task",
    siteIntegrationId: "mangadex",
    mangaId: "series",
    seriesTitle: "Series",
    created: 100,
    status: "queued",
    settingsSnapshot: createTaskSettingsSnapshot(settings, "mangadex"),
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
  if (permission === "missing") handles.delete("captured-folder")
  const settingsRepository = new SettingsRepository("warn")
  const native = new NativeOutputCoordinator({
    settingsRepository,
    repository: new NativeOutputRepository(),
    queueRepository: queue,
    queryOffscreenJob: async () => null,
    requestBlobRevocation: async () => undefined,
    ensureLivenessAlarm: async () => undefined,
  })
  const cancellation = new DownloadTaskCancellationCoordinator(queue, native, {
    settingsRepository,
    historyRepository: history,
  })
  const policy = vi.mockObject(ProviderPolicyQueueCoordinator.prototype)
  policy.acknowledgeAfterAdmission.mockResolvedValue(undefined)
  const rules = vi.mockObject(SiteIntegrationSessionRuleManager.prototype)
  rules.ensureNetworkReady.mockResolvedValue(undefined)
  const offscreenFault = new Error("Unrelated offscreen startup failed")
  const ensureOffscreenReady = vi.fn(async () => {
    throw offscreenFault
  })
  const executor = new DownloadTaskExecutor(
    queue,
    ensureOffscreenReady,
    cancellation,
    policy,
    vi.mockObject(ChapterDispatchCoordinator.prototype),
    rules,
    new DestinationService(),
    { getAll: async () => ({ mangadex: true }) },
    { settingsRepository, historyRepository: history }
  )
  return { queue, executor, directory, database, ensureOffscreenReady }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("captured folder preflight recovery", () => {
  it("retains the missing captured-folder cause before an unrelated offscreen startup failure", async () => {
    const runtime = await fixture("missing")
    await expect(runtime.executor.execute("folder-task")).resolves.toBe(
      "queue-continuation"
    )
    await expect(runtime.queue.getTask("folder-task")).resolves.toMatchObject({
      status: "failed",
      errorCategory: "folder_unavailable",
      chapters: [{ status: "failed", errorCategory: "folder_unavailable" }],
    })
    expect(runtime.database.get).toHaveBeenCalledWith("captured-folder")
    expect(runtime.ensureOffscreenReady).not.toHaveBeenCalled()
    expect(runtime.directory.queryPermission).not.toHaveBeenCalled()
    expect(runtime.directory.getDirectoryHandle).not.toHaveBeenCalled()
    expect(runtime.directory.getFileHandle).not.toHaveBeenCalled()
  })

  it.each(["denied", "prompt"] as const)(
    "retains the typed permission cause for %s write access without filesystem work",
    async (permission) => {
      const runtime = await fixture(permission)
      await runtime.executor.execute("folder-task")
      await expect(runtime.queue.getTask("folder-task")).resolves.toMatchObject(
        {
          status: "failed",
          errorCategory: "folder_permission_required",
          chapters: [
            { status: "failed", errorCategory: "folder_permission_required" },
          ],
        }
      )
      expect(runtime.directory.queryPermission).toHaveBeenCalledExactlyOnceWith(
        {
          mode: "readwrite",
        }
      )
      expect(runtime.directory.requestPermission).not.toHaveBeenCalled()
      expect(runtime.directory.getDirectoryHandle).not.toHaveBeenCalled()
      expect(runtime.directory.getFileHandle).not.toHaveBeenCalled()
      expect(runtime.ensureOffscreenReady).not.toHaveBeenCalled()
    }
  )

  it("rejects an unconfigured original folder retained by the destination migration before opening IndexedDB", async () => {
    const database = exposeHandles(new Map())
    const settings = folderSettings()
    const snapshot = createTaskSettingsSnapshot(settings, "mangadex")
    const writes = buildTaskDestinationWrites({
      [LOCAL_STORAGE_KEYS.downloadQueue]: [
        {
          id: "retained-task",
          siteIntegrationId: "mangadex",
          mangaId: "series",
          seriesTitle: "Series",
          created: 100,
          completed: 200,
          status: "failed",
          settingsSnapshot: { ...snapshot, destination: "file-system-access" },
          chapters: [
            {
              id: "chapter",
              title: "Chapter",
              url: "https://mangadex.org/chapter/chapter",
              index: 0,
              status: "failed",
              lastUpdated: 200,
            },
          ],
        },
      ],
    })
    const [task] = parseCurrentDownloadQueue(
      writes[LOCAL_STORAGE_KEYS.downloadQueue]
    )
    const context = {
      taskId: task.id,
      destination: getEffectiveTaskDestination(task),
    }
    const result = await new DestinationService().preflight(context)
    expect(result).toEqual({ ready: false, reason: "not_configured" })
    if (!result.ready) {
      expect(new DestinationPreflightError(context, result).errorCategory).toBe(
        "folder_unavailable"
      )
    }
    expect(database.open).not.toHaveBeenCalled()
  })
})
