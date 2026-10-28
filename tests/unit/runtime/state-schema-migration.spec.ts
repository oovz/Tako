import { beforeEach, describe, expect, it, vi, type Mock } from "vitest"

import {
  CURRENT_STATE_SCHEMA_EPOCH,
  migrateDurableStateForCurrentSchema,
} from "@/src/runtime/state-schema-migration"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import { createTaskSettingsSnapshot as createCurrentSnapshot } from "@/src/runtime/settings-snapshot"
function createTaskSettingsSnapshot(
  ...args: Parameters<typeof createCurrentSnapshot>
) {
  const snapshot = createCurrentSnapshot(...args)
  return { ...snapshot, destination: snapshot.destination.kind }
}

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

function epoch2Task(id = "task-epoch-2") {
  const settingsSnapshot = createTaskSettingsSnapshot(
    DEFAULT_SETTINGS,
    "mangadex",
    {
      comicInfo: {
        author: "Author",
        coverUrl: "http://127.0.0.1/private-metadata-cover",
      },
    }
  )
  return {
    id,
    siteIntegrationId: "mangadex",
    mangaId: "series-epoch-2",
    seriesTitle: "Epoch 2 Series",
    seriesCoverUrl: "http://127.0.0.1/private-cover",
    chapters: [
      {
        id: "chapter-epoch-2",
        url: "https://mangadex.org/chapter/epoch-2",
        title: "Chapter",
        index: 0,
        status: "queued",
        outputs: { requested: 2, committed: 2, failed: 0 },
        nativeOutputSettlement: {
          jobId: "job-epoch-2",
          attempt: 2,
          taskId: id,
          chapterId: "chapter-epoch-2",
          requested: 2,
          completed: 2,
          interrupted: 0,
          appliedAt: 30,
        },
        dispatchAttempt: 2,
        lastUpdated: 10,
      },
    ],
    status: "queued",
    activeBlock: "provider_network_policy_action_required",
    destinationBlockRevision: 7,
    destinationResume: {
      commandId: "destination-command",
      blockRevision: 7,
    },
    activeCancel: { commandId: "cancel-command" },
    created: 1,
    started: 2,
    settingsSnapshot,
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
              "stateSchemaEpoch" in values
                ? "marker"
                : "stateSchemaMigrationJournal" in values
                  ? "journal"
                  : "documents"
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

  it.each(["downloadQueue", "pendingUndoActions"])(
    "preserves explicit null %s as malformed at the current upgrade boundary",
    async (key) => {
      local = {
        stateSchemaEpoch: 8,
        downloadQueue: [],
        pendingUndoActions: [],
        [key]: null,
      }
      await expect(migrateDurableStateForCurrentSchema()).rejects.toThrow()
      expect(local.stateSchemaEpoch).toBe(8)
      expect(local[key]).toBeNull()
      expect(chrome.storage.local.set).not.toHaveBeenCalled()
    }
  )

  it("adds a disabled global fallback default without authorizing historical tasks or Undo", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS)
    const downloads = { ...settings.downloads }
    Reflect.deleteProperty(downloads, "allowChromeFallback")
    const source = {
      ...epoch2Task(),
      status: "queued",
      activeBlock: undefined,
      destinationBlockRevision: undefined,
      destinationResume: undefined,
      activeCancel: undefined,
    }
    local = {
      stateSchemaEpoch: 2,
      [SETTINGS_KEY]: { ...settings, downloads },
      downloadQueue: [source],
      pendingUndoActions: [
        {
          token: "undo",
          type: "cancel_queued",
          taskSnapshot: { ...source, id: "undo-task" },
          previousQueuePosition: 1,
          createdAt: 1,
          expiresAt: 20,
        },
      ],
    }
    await migrateDurableStateForCurrentSchema()
    expect(local[SETTINGS_KEY]).toMatchObject({
      downloads: { allowChromeFallback: false },
    })
    for (const task of [
      ...(local.downloadQueue as object[]),
      ...(local.pendingUndoActions as { taskSnapshot: object }[]).map(
        (action) => action.taskSnapshot
      ),
    ]) {
      expect(task).not.toHaveProperty("fsaFallbackEligible")
      expect(task).not.toHaveProperty("useChromeFallback")
      expect(task).not.toHaveProperty("settingsSnapshot.allowChromeFallback")
    }
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
    expect(operationOrder).toEqual([
      "journal",
      "documents",
      "journal",
      "remove",
      "journal",
      "marker",
      "remove",
      "journal",
      "documents",
      "journal",
      "journal",
      "marker",
      "remove",
      "journal",
      "documents",
      "journal",
      "journal",
      "marker",
      "remove",
      "journal",
      "documents",
      "journal",
      "journal",
      "marker",
      "remove",
      "journal",
      "documents",
      "journal",
      "journal",
      "marker",
      "remove",
      "journal",
      "documents",
      "journal",
      "journal",
      "marker",
      "remove",
      "journal",
      "documents",
      "journal",
      "journal",
      "marker",
      "remove",
    ])
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
      downloadQueue: [
        { ...legacyTask(), activeBlock: "destination_action_required" },
      ],
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
    expect(local.downloadQueue).toEqual([
      expect.objectContaining({
        id: "task-1",
        status: "partial_success",

        errorCategory: "folder_unavailable",
      }),
    ])
    expect(local).not.toHaveProperty("destinationIssues")
    expect(local.persistent_errors).toEqual([
      expect.objectContaining({ code: "current", severity: "error" }),
    ])
  })

  it("correctly migrates v1.5.5.0 vintage settings and tasks with skip and overwriteExisting fallbacks", async () => {
    local = {
      [SETTINGS_KEY]: {
        downloads: {
          downloadMode: "custom",
          customDirectoryHandleId: "legacy-root",
          fsaCollisionPolicy: "skip",
          overwriteExisting: false,
          pathTemplate: "Manga/<SERIES_TITLE>",
          defaultFormat: "cbz",
          fileNameTemplate: "<CHAPTER_TITLE>",
          suppressSaveAsDialog: true,
          includeComicInfo: true,
          includeCoverImage: true,
        },
        globalPolicy: {
          image: { concurrency: 2, delayMs: 100 },
          chapter: { concurrency: 1, delayMs: 500 },
        },
        globalRetries: { image: 3, chapter: 1 },
      },
      downloadQueue: [
        {
          id: "task-v155",
          siteIntegrationId: "mangadex",
          mangaId: "series-155",
          seriesTitle: "Series 155",
          chapters: [
            {
              id: "chapter-155",
              url: "https://mangadex.org/chapter/c-155",
              title: "Chapter 155",
              index: 0,
              status: "queued",
              lastUpdated: 100,
            },
          ],
          status: "queued",
          created: 50,
          taskSettingsSnapshot: {
            archiveFormat: "zip",
            destination: "file-system-access",
            fsaCollisionPolicy: "skip",
            pathTemplate: "Manga/<SERIES_TITLE>",
          },
        },
      ],
    }

    await migrateDurableStateForCurrentSchema()

    expect(local[SETTINGS_KEY]).toMatchObject({
      downloads: {
        destination: "file-system-access",
        customDirectoryHandleId: "legacy-root",
        conflictPolicy: "uniquify",
      },
    })

    expect(local.downloadQueue).toEqual([
      expect.objectContaining({
        id: "task-v155",
        settingsSnapshot: expect.objectContaining({
          destination: { kind: "file-system-access", handleId: null },
          conflictPolicy: "uniquify",
          archiveFormat: "zip",
        }),
      }),
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

  it.each([
    "journal-prepared",
    "canonical-write",
    "journal-canonical",
    "obsolete-remove",
    "journal-obsolete",
    "marker",
    "journal-remove",
  ] as const)(
    "replays after a %s migration interruption",
    async (failurePoint) => {
      local = {
        stateSchemaEpoch: 2,
        [SETTINGS_KEY]: {
          ...structuredClone(DEFAULT_SETTINGS),
          downloads: {
            ...DEFAULT_SETTINGS.downloads,
            destination: "file-system-access",
            customDirectoryHandleId: "selected-capability",
          },
        },
        commandResults: { old: true },
        downloadQueue: [epoch2Task()],
        unrelatedUserState: { keep: true },
      }
      const set = vi.mocked(chrome.storage.local.set)
      const remove = vi.mocked(chrome.storage.local.remove)
      const originalSet = set.getMockImplementation()!
      const originalRemove = remove.getMockImplementation()!

      set.mockImplementation(async (values) => {
        const valuesRecord = values as Record<string, unknown>
        const journal = valuesRecord.stateSchemaMigrationJournal as
          { phase?: string } | undefined
        if (
          failurePoint === "journal-prepared" &&
          journal?.phase === "prepared"
        ) {
          throw new Error("prepared journal failed")
        }
        if (
          failurePoint === "canonical-write" &&
          Object.hasOwn(valuesRecord, "downloadQueue")
        ) {
          throw new Error("canonical write failed")
        }
        if (
          failurePoint === "journal-canonical" &&
          journal?.phase === "canonical-written"
        ) {
          throw new Error("canonical journal failed")
        }
        if (
          failurePoint === "journal-obsolete" &&
          journal?.phase === "obsolete-removed"
        ) {
          throw new Error("obsolete journal failed")
        }
        if (
          failurePoint === "marker" &&
          Object.hasOwn(valuesRecord, "stateSchemaEpoch")
        ) {
          throw new Error("marker write failed")
        }
        return await (
          originalSet as unknown as (
            values: Record<string, unknown>
          ) => Promise<void>
        )(valuesRecord)
      })
      remove.mockImplementation(async (keys) => {
        const keyList: string[] = Array.isArray(keys)
          ? (keys as string[])
          : [keys as string]
        if (
          failurePoint === "obsolete-remove" &&
          keyList.includes("commandResults")
        ) {
          throw new Error("obsolete removal failed")
        }
        if (
          failurePoint === "journal-remove" &&
          keyList.includes("stateSchemaMigrationJournal")
        ) {
          throw new Error("journal removal failed")
        }
        return await (
          originalRemove as unknown as (
            keys: string | string[]
          ) => Promise<void>
        )(keys as string | string[])
      })

      await expect(migrateDurableStateForCurrentSchema()).rejects.toThrow()
      set.mockImplementation(originalSet)
      remove.mockImplementation(originalRemove)

      await migrateDurableStateForCurrentSchema()
      expect(local.stateSchemaEpoch).toBe(CURRENT_STATE_SCHEMA_EPOCH)
      expect(local).not.toHaveProperty("stateSchemaMigrationJournal")
      expect(local).not.toHaveProperty("commandResults")
      expect(local.downloadQueue).toEqual([
        expect.objectContaining({
          id: "task-epoch-2",
          chapters: [expect.objectContaining({ id: "chapter-epoch-2" })],
        }),
      ])
      expect(local.unrelatedUserState).toEqual({ keep: true })
      expect(local[SETTINGS_KEY]).toMatchObject({
        downloads: {
          destination: "file-system-access",
          customDirectoryHandleId: "selected-capability",
        },
      })
    }
  )

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

  it("rejects a future schema epoch before writing or removing anything", async () => {
    local = {
      stateSchemaEpoch: CURRENT_STATE_SCHEMA_EPOCH + 1,
      downloadQueue: { unsupported: true },
    }

    await expect(migrateDurableStateForCurrentSchema()).rejects.toThrow(
      "newer than supported"
    )
    expect(local).toEqual({
      stateSchemaEpoch: CURRENT_STATE_SCHEMA_EPOCH + 1,
      downloadQueue: { unsupported: true },
    })
    expect(chrome.storage.local.set).not.toHaveBeenCalled()
    expect(chrome.storage.local.remove).not.toHaveBeenCalled()
  })

  it("converts the epoch 2 destination issue document into paired queue state", async () => {
    local = {
      stateSchemaEpoch: 2,
      downloadQueue: [
        {
          ...epoch2Task(),
          activeBlock: "destination_action_required",
        },
      ],
      destinationIssues: [
        {
          id: "issue-epoch-2",
          taskId: "task-epoch-2",
          chapterId: "chapter-epoch-2",
          kind: "fsa_folder_missing",
          occurredAt: 50,
        },
      ],
    }

    await migrateDurableStateForCurrentSchema()

    const prepared = vi
      .mocked(chrome.storage.local.set)
      .mock.calls.map(
        ([values]) =>
          (
            values as {
              stateSchemaMigrationJournal?: {
                targetEpoch: number
                phase: string
                writes: { downloadQueue: unknown }
              }
            }
          ).stateSchemaMigrationJournal
      )
      .find(
        (journal) => journal?.targetEpoch === 3 && journal.phase === "prepared"
      )
    expect(prepared?.writes.downloadQueue).toMatchObject([
      {
        activeBlock: "destination_action_required",
        destinationIssue: { id: "issue-epoch-2" },
      },
    ])
    expect(local.stateSchemaEpoch).toBe(CURRENT_STATE_SCHEMA_EPOCH)
    expect(local.downloadQueue).toEqual([
      expect.objectContaining({
        id: "task-epoch-2",
        activeBlock: undefined,

        chapters: [
          expect.objectContaining({
            nativeOutputSettlement: expect.objectContaining({
              jobId: "job-epoch-2",
            }),
          }),
        ],
      }),
    ])
    expect(local).not.toHaveProperty("destinationIssues")
  })

  it("repairs a blocked task without an issue and drops orphan derived issues", async () => {
    local = {
      stateSchemaEpoch: 2,
      downloadQueue: [
        {
          ...epoch2Task("task-blocked"),
          errorCategory: "folder_permission_required",
          activeBlock: "destination_action_required",
        },
      ],
      destinationIssues: [
        {
          id: "orphan",
          taskId: "missing-task",
          kind: "disk_full",
          occurredAt: 50,
        },
      ],
    }

    await migrateDurableStateForCurrentSchema()

    const prepared = vi
      .mocked(chrome.storage.local.set)
      .mock.calls.map(
        ([values]) =>
          (
            values as {
              stateSchemaMigrationJournal?: {
                targetEpoch: number
                phase: string
                writes: { downloadQueue: unknown }
              }
            }
          ).stateSchemaMigrationJournal
      )
      .find(
        (journal) => journal?.targetEpoch === 3 && journal.phase === "prepared"
      )
    expect(prepared?.writes.downloadQueue).toMatchObject([
      {
        activeBlock: "destination_action_required",
        destinationIssue: {
          taskId: "task-blocked",
          kind: "fsa_permission_required",
        },
      },
    ])
    expect(local.downloadQueue).toEqual([
      expect.objectContaining({
        id: "task-blocked",
        activeBlock: undefined,
      }),
    ])
    expect(local).not.toHaveProperty("destinationIssues")
  })

  it("rejects a journal with an unapproved write key before replay", async () => {
    local = {
      stateSchemaEpoch: 2,
      stateSchemaMigrationJournal: {
        sourceEpoch: 2,
        targetEpoch: 3,
        phase: "prepared",
        writes: {
          downloadQueue: [],
          pendingUndoActions: [],
          unrelatedState: true,
        },
        obsoleteKeys: [],
      },
    }

    await expect(migrateDurableStateForCurrentSchema()).rejects.toThrow(
      "invalid write key"
    )
    expect(local).toEqual({
      stateSchemaEpoch: 2,
      stateSchemaMigrationJournal: {
        sourceEpoch: 2,
        targetEpoch: 3,
        phase: "prepared",
        writes: {
          downloadQueue: [],
          pendingUndoActions: [],
          unrelatedState: true,
        },
        obsoleteKeys: [],
      },
    })
    expect(chrome.storage.local.set).not.toHaveBeenCalled()
    expect(chrome.storage.local.remove).not.toHaveBeenCalled()
  })

  it("drops unsafe persisted cover URLs while preserving the other task metadata", async () => {
    local = {
      stateSchemaEpoch: 2,
      downloadQueue: [epoch2Task()],
      pendingUndoActions: [
        {
          token: "undo-epoch-2",
          type: "cancel_queued",
          taskSnapshot: epoch2Task("undo-epoch-2"),
          previousQueuePosition: 0,
          createdAt: 5,
          expiresAt: 10,
        },
      ],
    }

    await migrateDurableStateForCurrentSchema()

    expect(local.downloadQueue).toEqual([
      expect.objectContaining({
        seriesCoverUrl: undefined,
        settingsSnapshot: expect.objectContaining({
          comicInfo: { author: "Author" },
        }),
        activeBlock: "provider_network_policy_action_required",
      }),
    ])
    expect(local.pendingUndoActions).toEqual([
      expect.objectContaining({
        taskSnapshot: expect.objectContaining({
          id: "undo-epoch-2",
          seriesCoverUrl: undefined,

          chapters: [
            expect.objectContaining({
              nativeOutputSettlement: expect.objectContaining({
                jobId: "job-epoch-2",
              }),
            }),
          ],
        }),
      }),
    ])
  })

  it("preserves a valid epoch-2 dispatch lease while removing only obsolete documents", async () => {
    local = {
      stateSchemaEpoch: 2,
      downloadQueue: [],
      pendingUndoActions: [],
      activeDispatchLease: {
        jobId: "job-valid",
        taskId: "task-valid",
        chapterId: "chapter-valid",
        attempt: 1,
        fingerprint: "a".repeat(64),
        documentInstanceId: "document-valid",
        saveMode: "fsa",
        stage: "saving",
        startedAt: 1,
        lastActivityAt: 2,
        leaseExpiresAt: 3,
        sequence: 1,
      },
    }

    await migrateDurableStateForCurrentSchema()

    expect(local.stateSchemaEpoch).toBe(CURRENT_STATE_SCHEMA_EPOCH)
    expect(local.activeDispatchLease).toEqual(
      expect.objectContaining({ jobId: "job-valid" })
    )
  })
})

describe("ordered stored-state migration steps", () => {
  function releasedTask() {
    const task = epoch2Task()
    delete (task as { seriesCoverUrl?: string }).seriesCoverUrl
    delete (task.settingsSnapshot as { comicInfo?: unknown }).comicInfo
    return {
      ...task,
      activeBlock: "native_output_action_required",
      errorCategory: "browser_download_unobservable",
      chapters: task.chapters.map((chapter) => ({
        ...chapter,
        errorCategory: "browser_download_unobservable",
        nativeOutputSettlement: {
          ...chapter.nativeOutputSettlement,
          completed: 1,
          surrendered: 1,
        },
      })),
    }
  }

  function storageHarness(initial: Record<string, unknown>) {
    const local = structuredClone(initial)
    const storage = {
      get: vi.fn(async (keys: string[]) =>
        Object.fromEntries(
          keys.flatMap((key) =>
            key in local ? [[key, structuredClone(local[key])]] : []
          )
        )
      ),
      set: vi.fn(async (values: Record<string, unknown>) => {
        Object.assign(local, structuredClone(values))
      }),
      remove: vi.fn(async (keys: string | string[]) => {
        for (const key of [keys].flat()) delete local[key]
      }),
    }
    vi.stubGlobal("chrome", { storage: { local: storage } })
    return { local, storage }
  }

  it("converts removed settlement representations from a released epoch-2 profile", async () => {
    const { local } = storageHarness({
      stateSchemaEpoch: 2,
      downloadQueue: [releasedTask()],
      pendingUndoActions: [],
    })
    await migrateDurableStateForCurrentSchema()
    expect(local.stateSchemaEpoch).toBe(CURRENT_STATE_SCHEMA_EPOCH)
    expect(local.downloadQueue).toMatchObject([
      {
        errorCategory: "browser_output_unconfirmed",
        chapters: [
          {
            nativeOutputSettlement: {
              completed: 1,
              interrupted: 1,
              outputUncertain: true,
            },
          },
        ],
      },
    ])
  })

  it("resumes an already prepared earlier journal before the next conversion", async () => {
    const task = releasedTask()
    const { local, storage } = storageHarness({
      stateSchemaEpoch: 2,
      stateSchemaMigrationJournal: {
        sourceEpoch: 2,
        targetEpoch: 3,
        phase: "prepared",
        writes: { downloadQueue: [task], pendingUndoActions: [] },
        obsoleteKeys: [],
      },
    })
    await migrateDurableStateForCurrentSchema()
    expect(
      storage.set.mock.calls
        .filter(([values]) => "stateSchemaEpoch" in values)
        .map(([values]) => values.stateSchemaEpoch)
    ).toEqual([3, 4, 5, 6, 7, 8, 9])
    expect(local.downloadQueue).toMatchObject([
      {
        activeBlock: undefined,
        errorCategory: "browser_output_unconfirmed",
        chapters: [
          {
            nativeOutputSettlement: {
              completed: 1,
              interrupted: 1,
              outputUncertain: true,
            },
          },
        ],
      },
    ])
    expect(local.stateSchemaMigrationJournal).toBeUndefined()
    storage.set.mockClear()
    storage.remove.mockClear()
    await migrateDurableStateForCurrentSchema()
    expect(storage.set).not.toHaveBeenCalled()
    expect(storage.remove).not.toHaveBeenCalled()
  })

  it.each([
    "prepared",
    "documents",
    "canonical-written",
    "obsolete-removed",
    "marker",
    "journal-remove",
  ])("resumes the output conversion after %s fails", async (failurePoint) => {
    const task = releasedTask()
    const { local, storage } = storageHarness({
      stateSchemaEpoch: 3,
      downloadQueue: [task],
      pendingUndoActions: [],
    })
    const set = storage.set.getMockImplementation()!
    const remove = storage.remove.getMockImplementation()!
    storage.set.mockImplementation(async (values) => {
      const journal = values.stateSchemaMigrationJournal as
        { phase?: string } | undefined
      if (
        journal?.phase === failurePoint ||
        (failurePoint === "documents" && "downloadQueue" in values) ||
        (failurePoint === "marker" && "stateSchemaEpoch" in values)
      )
        throw new Error("Temporary storage failure")
      await set(values)
    })
    storage.remove.mockImplementation(async (keys) => {
      if (failurePoint === "journal-remove")
        throw new Error("Temporary storage failure")
      await remove(keys)
    })
    await expect(migrateDurableStateForCurrentSchema()).rejects.toThrow(
      "Temporary storage failure"
    )
    storage.set.mockImplementation(set)
    storage.remove.mockImplementation(remove)
    await migrateDurableStateForCurrentSchema()
    expect(local.stateSchemaEpoch).toBe(CURRENT_STATE_SCHEMA_EPOCH)
    expect(local.stateSchemaMigrationJournal).toBeUndefined()
    expect(local.downloadQueue).toMatchObject([
      {
        chapters: [
          {
            nativeOutputSettlement: {
              completed: 1,
              interrupted: 1,
              outputUncertain: true,
            },
          },
        ],
      },
    ])
  })

  it.each(["downloadQueue", "pendingUndoActions", "pendingOutputs:index"])(
    "preserves an explicit null %s document as invalid",
    async (key) => {
      const initial = {
        stateSchemaEpoch: 3,
        downloadQueue: [],
        pendingUndoActions: [],
        [key]: null,
      }
      const { local, storage } = storageHarness(initial)
      await expect(migrateDurableStateForCurrentSchema()).rejects.toMatchObject(
        {
          name: "InvalidDurableStateError",
          fatal: true,
        }
      )
      expect(local).toEqual(initial)
      expect(storage.set).not.toHaveBeenCalled()
      expect(storage.remove).not.toHaveBeenCalled()
    }
  )

  it("preserves malformed indexed native output before any writes", async () => {
    const initial = {
      stateSchemaEpoch: 3,
      downloadQueue: [],
      pendingOutputs: { retain: true },
      "pendingOutputs:index": {
        jobIds: ["job"],
        outputIds: ["output"],
        downloadIdToOutputId: {},
      },
      "pendingOutputs:manifest:job": { malformed: true },
      "pendingOutputs:output:output": {
        phase: "surrendered",
        surrenderedAt: "invalid",
      },
    }
    const { local, storage } = storageHarness(initial)
    await expect(migrateDurableStateForCurrentSchema()).rejects.toThrow()
    expect(local).toEqual(initial)
    expect(storage.set).not.toHaveBeenCalled()
    expect(storage.remove).not.toHaveBeenCalled()
  })
})
