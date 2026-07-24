import { beforeEach, describe, expect, it, vi } from "vitest"

import type {
  DownloadTaskState,
  PendingOutputRecord,
} from "@/src/types/queue-state"

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  initializeSettingsSync: vi.fn(),
  initializeSiteIntegrations: vi.fn(async () => undefined),
  reconcileBroadPermission: vi.fn(async () => undefined),
  showDownloadComplete: vi.fn(),
  notifyTaskFailed: vi.fn(),
}))

vi.mock("@/src/runtime/logger", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock("@/src/runtime/i18n", () => ({
  applyUiLanguagePreference: vi.fn(async () => undefined),
}))

vi.mock("@/src/storage/settings-service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/src/storage/settings-service")>()
  return {
    ...actual,
    settingsService: {
      ...actual.settingsService,
      getSettings: mocks.getSettings,
    },
  }
})

vi.mock("@/src/storage/settings-sync-service", () => ({
  settingsSyncService: {
    initialize: mocks.initializeSettingsSync,
  },
}))

vi.mock("@/src/runtime/background-site-integration-initialization", () => ({
  initializeBackgroundSiteIntegrations: mocks.initializeSiteIntegrations,
  getBackgroundSiteAdapterById: vi.fn(async () => undefined),
}))

vi.mock("@/src/site-integrations/host-permission-service", () => ({
  reconcileBroadHttpsPermissionEnablement: mocks.reconcileBroadPermission,
}))

vi.mock("@/src/storage/site-integration-enablement-service", () => ({
  siteIntegrationEnablementService: {
    getAll: vi.fn(async () => ({ mangadex: true })),
  },
}))

vi.mock("@/entrypoints/background/offscreen-lifecycle", () => ({
  getOffscreenContexts: vi.fn(async () => []),
  hasOffscreenDocument: vi.fn(async () => false),
  queryOffscreenJob: vi.fn(async () => null),
  queryOffscreenStatus: vi.fn(async () => null),
  recordOffscreenActivity: vi.fn(async () => undefined),
}))

vi.mock("@/entrypoints/background/notification-service", () => ({
  getNotificationService: () => ({
    showDownloadCompleteNotification: mocks.showDownloadComplete,
    notifyTaskFailed: mocks.notifyTaskFailed,
  }),
}))

function readStorage(
  store: Record<string, unknown>,
  keys?: string | string[] | Record<string, unknown> | null
): Record<string, unknown> {
  if (keys === undefined || keys === null) return { ...store }
  if (typeof keys === "string") return { [keys]: store[keys] }
  if (Array.isArray(keys)) {
    return Object.fromEntries(
      keys.filter((key) => key in store).map((key) => [key, store[key]])
    )
  }
  return Object.fromEntries(
    Object.entries(keys).map(([key, fallback]) => [
      key,
      key in store ? store[key] : fallback,
    ])
  )
}

describe("native output cold-start recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("hydrates, observes terminal Chrome output, clears the lease, and finalizes without redownloading", async () => {
    const { DEFAULT_SETTINGS } = await import("@/src/storage/default-settings")
    const { createTaskSettingsSnapshot } =
      await import("@/src/runtime/settings-snapshot")
    const { createDispatchLease } =
      await import("@/src/runtime/active-dispatch-lease")
    const { LOCAL_STORAGE_KEYS } = await import("@/src/runtime/storage-keys")
    const { createPendingDownloadsStore } =
      await import("@/entrypoints/background/pending-downloads")

    mocks.getSettings.mockResolvedValue(DEFAULT_SETTINGS)

    const task: DownloadTaskState = {
      id: "task-cold-start",
      siteIntegrationId: "mangadex",
      mangaId: "series-1",
      seriesTitle: "Cold Start Series",
      chapters: [
        {
          id: "chapter-1",
          url: "https://example.com/chapter-1",
          title: "Chapter 1",
          index: 1,
          status: "downloading",
          dispatchAttempt: 1,
          outputs: { requested: 1, committed: 0, failed: 0 },
          lastUpdated: 1_000,
        },
      ],
      status: "downloading",
      created: 500,
      started: 600,
      settingsSnapshot: createTaskSettingsSnapshot(
        DEFAULT_SETTINGS,
        "mangadex"
      ),
    }
    const pendingOutput: PendingOutputRecord = {
      outputId: "job-cold-start:archive:0",
      jobId: "job-cold-start",
      attempt: 1,
      taskId: task.id,
      chapterId: task.chapters[0]!.id,
      downloadId: 42,
      blobUrl: "blob:chrome-extension://test/cold-start",
      filename: "Cold Start Series/Chapter 1.cbz",
      outputIndex: 0,
      outputCount: 1,
      outputKind: "archive",
      state: "in_progress",
      createdAt: 700,
    }
    const lease = createDispatchLease({
      jobId: pendingOutput.jobId,
      taskId: task.id,
      chapterId: task.chapters[0]!.id,
      attempt: 1,
      now: 700,
    })
    const local: Record<string, unknown> = {
      [LOCAL_STORAGE_KEYS.downloadQueue]: [task],
      [LOCAL_STORAGE_KEYS.pendingOutputs]: {
        [pendingOutput.outputId]: pendingOutput,
      },
      [LOCAL_STORAGE_KEYS.activeDispatchLease]: lease,
    }
    const session: Record<string, unknown> = {}
    const search = vi.fn(async ({ id }: { id?: number }) =>
      id === 42
        ? [
            {
              id: 42,
              state: "complete" as const,
              url: pendingOutput.blobUrl,
            },
          ]
        : []
    )
    const download = vi.fn()
    const ensureOffscreenDocumentReady = vi.fn(async () => undefined)
    const ensureLivenessAlarm = vi.fn(async () => undefined)

    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn(async (keys) => readStorage(local, keys)),
          set: vi.fn(async (values: Record<string, unknown>) => {
            Object.assign(local, values)
          }),
          remove: vi.fn(async (keys: string | string[]) => {
            for (const key of typeof keys === "string" ? [keys] : keys) {
              delete local[key]
            }
          }),
        },
        session: {
          get: vi.fn(async (keys) => readStorage(session, keys)),
          set: vi.fn(async (values: Record<string, unknown>) => {
            Object.assign(session, values)
          }),
          remove: vi.fn(async (keys: string | string[]) => {
            for (const key of typeof keys === "string" ? [keys] : keys) {
              delete session[key]
            }
          }),
          setAccessLevel: vi.fn(async () => undefined),
        },
      },
      downloads: { search, download },
      offscreen: { hasDocument: vi.fn(async () => false) },
      tabs: { query: vi.fn(async () => []) },
      notifications: { create: vi.fn(async () => undefined) },
    } as unknown as typeof chrome)

    const { initializeBackgroundRuntime } =
      await import("@/entrypoints/background/background-startup")
    const runtime = await initializeBackgroundRuntime({
      pendingDownloadsStore: createPendingDownloadsStore(),
      ensureLivenessAlarm,
      ensureOffscreenDocumentReady,
      requestBlobRevocation: vi.fn(async () => undefined),
    })

    await runtime.activateQueue()

    const recoveredQueue = local[
      LOCAL_STORAGE_KEYS.downloadQueue
    ] as DownloadTaskState[]
    expect(recoveredQueue).toEqual([
      expect.objectContaining({
        id: task.id,
        status: "completed",
        lastSuccessfulDownloadId: 42,
        chapters: [
          expect.objectContaining({
            id: "chapter-1",
            status: "completed",
            outputs: { requested: 1, committed: 1, failed: 0 },
          }),
        ],
      }),
    ])
    expect(local[LOCAL_STORAGE_KEYS.activeDispatchLease]).toBeUndefined()
    expect(local[LOCAL_STORAGE_KEYS.pendingOutputs]).toEqual({})
    expect(search).toHaveBeenCalledWith({ id: 42 })
    expect(download).not.toHaveBeenCalled()
    expect(ensureOffscreenDocumentReady).toHaveBeenCalledTimes(1)
    expect(ensureLivenessAlarm).toHaveBeenCalledTimes(1)
  })
})
