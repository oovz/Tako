import { beforeEach, describe, expect, it, vi, type Mock } from "vitest"

import {
  CURRENT_STATE_SCHEMA_EPOCH,
  migrateDurableStateForCurrentSchema,
} from "@/src/runtime/state-schema-migration"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"

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
          surrendered: 0,
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
        destinationIssue: expect.objectContaining({
          id: "issue-1",
          kind: "disk_full",
        }),
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
          destination: "file-system-access",
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
    "canonical-write",
    "journal-canonical",
    "obsolete-remove",
    "journal-obsolete",
    "marker",
    "journal-remove",
  ] as const)(
    "replays after a %s migration interruption",
    async (failurePoint) => {
      local = { stateSchemaEpoch: 2, commandResults: { old: true } }
      const set = vi.mocked(chrome.storage.local.set)
      const remove = vi.mocked(chrome.storage.local.remove)
      const originalSet = set.getMockImplementation()!
      const originalRemove = remove.getMockImplementation()!

      set.mockImplementation(async (values) => {
        const valuesRecord = values as Record<string, unknown>
        const journal = valuesRecord.stateSchemaMigrationJournal as
          { phase?: string } | undefined
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

    expect(local.stateSchemaEpoch).toBe(CURRENT_STATE_SCHEMA_EPOCH)
    expect(local.downloadQueue).toEqual([
      expect.objectContaining({
        id: "task-epoch-2",
        activeBlock: "destination_action_required",
        destinationIssue: expect.objectContaining({ id: "issue-epoch-2" }),
        destinationBlockRevision: 7,
        destinationResume: expect.objectContaining({
          commandId: "destination-command",
        }),
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

    expect(local.downloadQueue).toEqual([
      expect.objectContaining({
        id: "task-blocked",
        activeBlock: "destination_action_required",
        destinationIssue: expect.objectContaining({
          taskId: "task-blocked",
          kind: "fsa_permission_required",
        }),
      }),
    ])
    expect(local).not.toHaveProperty("destinationIssues")
  })

  it("rejects a journal with an unapproved write key before replay", async () => {
    local = {
      stateSchemaEpoch: 2,
      stateSchemaMigrationJournal: {
        sourceEpoch: 2,
        targetEpoch: CURRENT_STATE_SCHEMA_EPOCH,
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
        targetEpoch: CURRENT_STATE_SCHEMA_EPOCH,
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
        destinationBlockRevision: 7,
        destinationResume: expect.objectContaining({
          commandId: "destination-command",
        }),
      }),
    ])
    expect(local.pendingUndoActions).toEqual([
      expect.objectContaining({
        taskSnapshot: expect.objectContaining({
          id: "undo-epoch-2",
          seriesCoverUrl: undefined,
          destinationBlockRevision: 7,
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
