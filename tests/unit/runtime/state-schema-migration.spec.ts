import { beforeEach, describe, expect, it, vi, type Mock } from "vitest"

import {
  CURRENT_STATE_SCHEMA_EPOCH,
  migrateDurableStateForCurrentSchema,
} from "@/src/runtime/state-schema-migration"

const SETTINGS_KEY = "settings:global"

function legacyTask(id = "task-1") {
  return {
    id,
    siteIntegrationId: "mangadex",
    mangaId: "series-1",
    seriesTitle: "Series",
    chapters: [
      {
        id: "chapter-1",
        url: "https://mangadex.org/chapter/chapter-1",
        title: "Chapter",
        index: 0,
        status: "downloading",
        outputs: { requested: 2, committed: 1, failed: 0 },
        lastUpdated: 10,
      },
    ],
    status: "downloading",
    created: 1,
    started: 2,
    taskSettingsSnapshot: {
      archiveFormat: "cbz",
      destination: "file-system-access",
      fsaCollisionPolicy: "overwrite",
      pathTemplate: "Library/<SERIES_TITLE>",
      rateLimitSettings: {
        image: { concurrency: 50, delayMs: -1 },
        chapter: { concurrency: 4, delayMs: 100 },
      },
      retrySettings: { image: 20, chapter: -2 },
    },
  }
}

describe("migrateDurableStateForCurrentSchema", () => {
  let local: Record<string, unknown>
  let operationOrder: string[]
  let deleteDatabase: Mock

  beforeEach(() => {
    local = {}
    operationOrder = []
    deleteDatabase = vi.fn()
    vi.stubGlobal("indexedDB", { deleteDatabase })
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn(async (keys: string[]) =>
            Object.fromEntries(
              keys.flatMap((key) =>
                key in local ? [[key, structuredClone(local[key])]] : []
              )
            )
          ),
          set: vi.fn(async (values: Record<string, unknown>) => {
            operationOrder.push(
              "stateSchemaEpoch" in values ? "marker" : "documents"
            )
            Object.assign(local, structuredClone(values))
          }),
          remove: vi.fn(async (keys: string | string[]) => {
            operationOrder.push("remove")
            for (const key of Array.isArray(keys) ? keys : [keys]) {
              delete local[key]
            }
          }),
          clear: vi.fn(),
        },
        session: {},
      },
    } as unknown as typeof chrome)
  })

  it("migrates released durable state without clearing local data or FSA handles", async () => {
    local = {
      unrelatedUserState: { keep: true },
      [SETTINGS_KEY]: {
        downloads: {
          downloadMode: "custom",
          customDirectoryHandleId: "download-root",
          fsaCollisionPolicy: "overwrite",
          pathTemplate: "Manga/<SERIES_TITLE>",
        },
        globalPolicy: {
          image: { concurrency: 4, delayMs: 250 },
          chapter: { concurrency: 4, delayMs: 750 },
        },
        globalRetries: { image: 2, chapter: 1 },
        notifications: false,
      },
      downloadQueue: [legacyTask()],
      activeDispatchLease: {
        jobId: "job-1",
        taskId: "task-1",
        chapterId: "chapter-1",
        attempt: 0,
        stage: "saving",
        startedAt: 1,
        lastActivityAt: 2,
        leaseExpiresAt: 3,
        sequence: 1,
      },
      pendingOutputs: {
        "output-1": {
          outputId: "output-1",
          taskId: "task-1",
          chapterId: "chapter-1",
          state: "in_progress",
        },
      },
      commandResults: { obsolete: true },
      downloadedChapters: [
        {
          chapterId: "chapter-1",
          url: "https://mangadex.org/chapter/chapter-1",
          title: "Chapter",
          seriesId: "series-1",
          seriesTitle: "Series",
          downloadedAt: 100,
          format: "cbz",
        },
      ],
      seriesDownloadHistory: {},
      persistent_errors: [{ code: "legacy", message: "warning", ts: 5 }],
      siteIntegrationEnablement: {
        mangadex: true,
        removedProvider: false,
      },
    }

    await migrateDurableStateForCurrentSchema()

    expect(local.unrelatedUserState).toEqual({ keep: true })
    expect(local[SETTINGS_KEY]).toMatchObject({
      downloads: {
        destination: "file-system-access",
        customDirectoryHandleId: "download-root",
        conflictPolicy: "overwrite",
        pathTemplate: "Manga/<SERIES_TITLE>",
      },
      globalPolicy: {
        image: { concurrency: 4, delayMs: 250 },
        chapter: { concurrency: 1, delayMs: 750 },
      },
      notifications: false,
    })
    expect(local.downloadQueue).toEqual([
      expect.objectContaining({
        id: "task-1",
        status: "partial_success",
        activeBlock: undefined,
        chapters: [
          expect.objectContaining({
            id: "chapter-1",
            status: "partial_success",
            outputs: { requested: 2, committed: 1, failed: 1 },
          }),
        ],
      }),
    ])
    expect(local.downloadHistoryClearCutoffs).toEqual({
      bySeries: {},
      byChapter: {},
    })
    expect(local.seriesDownloadHistory).toHaveProperty("mangadex#series-1")
    expect(local.persistent_errors).toEqual([
      {
        code: "legacy",
        message: "warning",
        severity: "warning",
        ts: 5,
      },
    ])
    expect(local.siteIntegrationEnablement).toEqual({ mangadex: true })
    expect(local).not.toHaveProperty("activeDispatchLease")
    expect(local).not.toHaveProperty("pendingOutputs")
    expect(local).not.toHaveProperty("commandResults")
    expect(local.stateSchemaEpoch).toBe(CURRENT_STATE_SCHEMA_EPOCH)
    expect(operationOrder).toEqual(["documents", "remove", "marker"])
    expect(chrome.storage.local.clear).not.toHaveBeenCalled()
    expect(deleteDatabase).not.toHaveBeenCalled()
  })

  it("migrates pending Undo task snapshots through the same task codec", async () => {
    local = {
      pendingUndoActions: [
        {
          token: "undo-1",
          type: "cancel_queued",
          taskSnapshot: {
            ...legacyTask("queued-task"),
            status: "queued",
            chapters: [
              {
                ...legacyTask().chapters[0],
                status: "queued",
              },
            ],
          },
          previousQueuePosition: 0,
          createdAt: 1,
          expiresAt: 2,
        },
      ],
    }

    await migrateDurableStateForCurrentSchema()

    expect(local.pendingUndoActions).toEqual([
      expect.objectContaining({
        token: "undo-1",
        taskSnapshot: expect.objectContaining({
          id: "queued-task",
          settingsSnapshot: expect.objectContaining({
            fileNameTemplate: "<CHAPTER_TITLE>",
          }),
        }),
      }),
    ])
  })

  it("canonicalizes released provider documents and bounded settings", async () => {
    local = {
      [SETTINGS_KEY]: {
        downloads: {
          downloadMode: "browser",
          overwriteExisting: true,
          customDirectoryHandleId: null,
          defaultFormat: "zip",
          suppressSaveAsDialog: true,
          includeComicInfo: false,
          includeCoverImage: true,
          normalizeImageFilenames: false,
          imagePaddingDigits: 4,
        },
        globalPolicy: {
          image: { concurrency: 99, delayMs: -20 },
          chapter: { delayMs: 99_999 },
        },
        globalRetries: { image: 99, chapter: -5 },
        advanced: { logLevel: "debug" },
        notifications: true,
        uiLanguage: "en",
        motionPreference: "reduce",
      },
      siteIntegrationEnablement: {
        mangadex: true,
        removedProvider: false,
      },
      siteIntegrationSettings: {
        mangadex: {
          imageQuality: "data",
          chapterLanguageFilter: ["en", "ja"],
          autoReadMangaDexSettings: false,
          removedField: true,
        },
        removedProvider: { field: true },
      },
      siteOverrides: {
        mangadex: {
          outputFormat: "zip",
          pathTemplate: "Library/<SERIES_TITLE>",
          imagePolicy: { concurrency: 99, delayMs: -20 },
          chapterPolicy: { delayMs: 99_999 },
          retries: { image: 99, chapter: -5 },
        },
        removedProvider: { outputFormat: "cbz" },
      },
      destinationIssues: [
        {
          id: "issue-1",
          taskId: "task-1",
          kind: "disk_full",
          occurredAt: 10,
        },
      ],
      persistent_errors: [
        {
          code: "current",
          message: "already canonical",
          severity: "error",
          ts: 10,
        },
      ],
    }

    await migrateDurableStateForCurrentSchema()

    expect(local[SETTINGS_KEY]).toMatchObject({
      downloads: {
        destination: "downloads-api",
        customDirectoryHandleId: null,
        defaultFormat: "zip",
        conflictPolicy: "overwrite",
        suppressSaveAsDialog: true,
        includeComicInfo: false,
        includeCoverImage: true,
        normalizeImageFilenames: false,
        imagePaddingDigits: 4,
      },
      globalPolicy: {
        image: { concurrency: 10, delayMs: 0 },
        chapter: { concurrency: 1, delayMs: 5000 },
      },
      globalRetries: { image: 10, chapter: 0 },
      advanced: { logLevel: "debug" },
      notifications: true,
      uiLanguage: "en",
      motionPreference: "reduce",
    })
    expect(local.siteIntegrationSettings).toEqual({
      mangadex: {
        imageQuality: "data",
        chapterLanguageFilter: ["en", "ja"],
        autoReadMangaDexSettings: false,
      },
    })
    expect(local.siteOverrides).toEqual({
      mangadex: {
        outputFormat: "zip",
        pathTemplate: "Library/<SERIES_TITLE>",
        imagePolicy: { concurrency: 10, delayMs: 0 },
        chapterPolicy: { delayMs: 5000 },
        retries: { image: 10, chapter: 0 },
      },
    })
    expect(local.destinationIssues).toEqual([
      expect.objectContaining({ id: "issue-1", kind: "disk_full" }),
    ])
    expect(local.persistent_errors).toEqual([
      expect.objectContaining({ code: "current", severity: "error" }),
    ])
  })

  it("does not mark malformed released queue data as migrated", async () => {
    local = { downloadQueue: { malformed: true } }

    await expect(migrateDurableStateForCurrentSchema()).rejects.toThrow(
      "Stored download queue is not an array"
    )
    expect(local).not.toHaveProperty("stateSchemaEpoch")
    expect(chrome.storage.local.set).not.toHaveBeenCalled()
  })

  it("writes the marker last and retries after an obsolete-key removal failure", async () => {
    local = { commandResults: { old: true } }
    vi.mocked(chrome.storage.local.remove).mockRejectedValueOnce(
      new Error("remove failed")
    )

    await expect(migrateDurableStateForCurrentSchema()).rejects.toThrow(
      "remove failed"
    )
    expect(local).not.toHaveProperty("stateSchemaEpoch")

    await migrateDurableStateForCurrentSchema()
    expect(local.stateSchemaEpoch).toBe(CURRENT_STATE_SCHEMA_EPOCH)
  })

  it("does no migration work after the current marker is present", async () => {
    local = {
      stateSchemaEpoch: CURRENT_STATE_SCHEMA_EPOCH,
      downloadQueue: [{ current: true }],
    }

    await migrateDurableStateForCurrentSchema()

    expect(local.downloadQueue).toEqual([{ current: true }])
    expect(chrome.storage.local.set).not.toHaveBeenCalled()
    expect(chrome.storage.local.remove).not.toHaveBeenCalled()
    expect(deleteDatabase).not.toHaveBeenCalled()
  })
})
