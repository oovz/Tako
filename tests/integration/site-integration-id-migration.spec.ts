import { afterEach, describe, expect, it, vi } from "vitest"

import { NativeOutputCoordinator } from "@/entrypoints/background/native-output-coordinator"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import { rebuildSeriesHistory } from "@/src/domain/history/cleanup-policy"
import type { DownloadTaskState } from "@/src/domain/queue/state"
import { migrateDurableStateForCurrentSchema } from "@/src/runtime/state-schema-migration"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { HistoryRepository } from "@/src/storage/history-repository"
import { NativeOutputRepository } from "@/src/storage/native-output-repository"
import { ProgressTimingEstimator } from "@/src/storage/progress-timing-estimates-repository"
import { QueueProjectionService } from "@/src/storage/queue-projection-service"
import { QueueRepository } from "@/src/storage/queue-repository"
import { SiteIntegrationEnablementService } from "@/src/storage/site-integration-enablement-service"
import { SiteIntegrationSettingsService } from "@/src/storage/site-integration-settings-service"
import { SiteOverridesService } from "@/src/storage/site-overrides-service"
import { reconcileCompletedChapterHistory } from "@/src/storage/completed-chapter-history"

const renames = [
  ["aimanhua", "lovemanga"],
  ["comicnettai", "comictropics"],
  ["dm5", "animemangahouse"],
  ["manhuagui", "readmanga"],
  ["zaimanhua", "mangaagain"],
  ["mangakakalove", "mangakakalot"],
] as const

function task(siteIntegrationId = "manhuagui", id = "task"): DownloadTaskState {
  return {
    id,
    siteIntegrationId,
    mangaId: "publisher-manhuagui#series",
    seriesTitle: "manhuagui Series",
    created: 1,
    status: "queued",
    settingsSnapshot: {
      ...createTaskSettingsSnapshot(DEFAULT_SETTINGS, siteIntegrationId),
      pathTemplate: "Library/<INTEGRATION_NAME>",
      siteSettings: { publisherValue: "manhuagui" },
    },
    chapters: [
      {
        id: "publisher-dm5/chapter",
        url: "https://www.manhuagui.com/comic/123/456.html",
        title: "Chapter",
        index: 0,
        status: "queued",
        requestedPath: "Library/manhuagui/publisher-dm5.cbz",
        lastUpdated: 10,
      },
    ],
  }
}

function storageHarness(initial: Record<string, unknown>) {
  const local = structuredClone(initial)
  const storage = {
    get: vi.fn(async (keys: string | string[]) =>
      Object.fromEntries(
        [keys]
          .flat()
          .filter((key) => key in local)
          .map((key) => [key, structuredClone(local[key])])
      )
    ),
    set: vi.fn(async (values: Record<string, unknown>) => {
      Object.assign(local, structuredClone(values))
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const key of [keys].flat()) delete local[key]
    }),
  }
  vi.stubGlobal("chrome", {
    runtime: { id: "extension" },
    i18n: { getMessage: (key: string) => key },
    storage: { local: storage, session: { set: vi.fn(async () => undefined) } },
    downloads: {
      search: vi.fn(async () => [
        {
          id: 42,
          state: "in_progress",
          url: "blob:manhuagui-output",
          filename: "/Downloads/Library/manhuagui/publisher-dm5.cbz",
        },
      ]),
    },
  })
  return { local, storage }
}

afterEach(() => vi.unstubAllGlobals())

describe("released integration identity upgrades", () => {
  it("cold-hydrates renamed tasks, Undo, provider preferences, history and learned timings", async () => {
    const tasks = renames.map(([oldId]) => task(oldId, `task-${oldId}`))
    const undoTask = task("manhuagui", "undo-manhuagui")
    undoTask.settingsSnapshot.destination = {
      kind: "file-system-access",
      handleId: "manhuagui-folder",
    }
    undoTask.settingsSnapshot.allowChromeFallback = true
    undoTask.fsaFallbackEligible = true
    const records = [...renames.map(([oldId]) => oldId), "manganato"].map(
      (siteIntegrationId) => ({
        siteIntegrationId,
        seriesId: "publisher-manhuagui#series",
        seriesTitle: "manhuagui Series",
        chapterId: "publisher-dm5/chapter",
        title: "Chapter",
        url: "https://www.manhuagui.com/comic/123/456.html",
        downloadedAt: 10,
        saveConfirmedAt: 9,
        outputDestination: "fsa" as const,
        filePath: "Library/manhuagui/publisher-dm5.cbz",
        format: "cbz" as const,
      })
    )
    const enablement = Object.fromEntries(
      renames.map(([oldId], index) => [oldId, index % 2 === 1])
    )
    const overrides = Object.fromEntries(
      renames.map(([oldId]) => [
        oldId,
        {
          pathTemplate: `Library/${oldId}`,
          outputFormat: "zip",
          imagePolicy: { concurrency: 2, delayMs: 123 },
          retries: { image: 3 },
        },
      ])
    )
    const { local } = storageHarness({
      stateSchemaEpoch: 9,
      downloadQueue: tasks,
      pendingUndoActions: [
        {
          token: "undo",
          type: "cancel_queued",
          taskSnapshot: undoTask,
          previousQueuePosition: 1,
          createdAt: 1,
          expiresAt: 9999999999999,
        },
      ],
      siteIntegrationEnablement: enablement,
      siteIntegrationSettings: {
        ...Object.fromEntries(renames.map(([oldId]) => [oldId, {}])),
        mangadex: { imageQuality: "data", autoReadMangaDexSettings: false },
      },
      siteOverrides: overrides,
      downloadedChapters: records,
      seriesDownloadHistory: rebuildSeriesHistory(records),
      downloadHistoryClearCutoffs: {
        allBefore: 5,
        bySeries: { "manhuagui#other#manhuagui": 7 },
        byChapter: { "dm5\0series\0dm5-chapter": 8 },
      },
      progressTimingEstimates: {
        "manhuagui|downloading|cbz|downloads-api|none": 1234,
        "manganato|downloading|cbz|downloads-api|none": 2345,
        "unrelated-key": 55,
      },
      persistent_errors: [
        {
          code: "manhuagui",
          message: "manhuagui warning",
          severity: "warning",
          ts: 2,
        },
      ],
      unrelatedData: { handleId: "manhuagui-folder" },
    })
    await migrateDurableStateForCurrentSchema()
    const history = new HistoryRepository()
    const queue = new QueueRepository(new QueueProjectionService(), history)
    await queue.initialize()
    for (const [oldId, newId] of renames) {
      expect(await queue.getTask(`task-${oldId}`)).toEqual({
        ...tasks.find((candidate) => candidate.id === `task-${oldId}`),
        siteIntegrationId: newId,
        settingsSnapshot: {
          ...tasks.find((candidate) => candidate.id === `task-${oldId}`)!
            .settingsSnapshot,
          siteIntegrationId: newId,
        },
      })
      expect(
        (await new SiteIntegrationEnablementService().getAll())[newId]
      ).toBe(enablement[oldId])
      expect((await new SiteOverridesService().getAll())[newId]).toEqual(
        overrides[oldId]
      )
      expect(
        await history.getSeriesHistory(newId, "publisher-manhuagui#series")
      ).toMatchObject({
        siteIntegrationId: newId,
        downloadedChapters: [
          {
            saveConfirmedAt: 9,
            filePath: "Library/manhuagui/publisher-dm5.cbz",
          },
        ],
      })
      expect(
        await history.getSeriesHistory(oldId, "publisher-manhuagui#series")
      ).toBeNull()
    }
    expect(local.pendingUndoActions).toEqual([
      {
        token: "undo",
        type: "cancel_queued",
        taskSnapshot: {
          ...undoTask,
          siteIntegrationId: "readmanga",
          settingsSnapshot: {
            ...undoTask.settingsSnapshot,
            siteIntegrationId: "readmanga",
          },
        },
        previousQueuePosition: 1,
        createdAt: 1,
        expiresAt: 9999999999999,
      },
    ])
    expect(await new SiteIntegrationSettingsService().getAll()).toEqual({
      ...Object.fromEntries(renames.map(([, newId]) => [newId, {}])),
      mangadex: { imageQuality: "data", autoReadMangaDexSettings: false },
    })
    expect((await history.getAggregate()).clearCutoffs).toEqual({
      allBefore: 5,
      bySeries: { "readmanga#other#manhuagui": 7 },
      byChapter: { "animemangahouse\0series\0dm5-chapter": 8 },
    })
    expect(
      await history.isChapterDownloaded(
        "manganato",
        "publisher-manhuagui#series",
        "publisher-dm5/chapter"
      )
    ).toBe(true)
    expect(
      (
        await new ProgressTimingEstimator().getCosts({
          integrationId: "readmanga",
          archiveFormat: "cbz",
          destination: "downloads-api",
        })
      ).downloading
    ).toBe(1234)
    expect(local.progressTimingEstimates).toEqual({
      "readmanga|downloading|cbz|downloads-api|none": 1234,
      "manganato|downloading|cbz|downloads-api|none": 2345,
      "unrelated-key": 55,
    })
    expect(local.persistent_errors).toEqual([
      {
        code: "manhuagui",
        message: "manhuagui warning",
        severity: "warning",
        ts: 2,
      },
    ])
    expect(local.unrelatedData).toEqual({ handleId: "manhuagui-folder" })
    const before = structuredClone(local)
    await migrateDurableStateForCurrentSchema()
    expect(local).toEqual(before)
  })

  it("captures historical integration paths before applying the new identity", async () => {
    const source = task()
    const chapter = { ...source.chapters[0]! }
    Reflect.deleteProperty(chapter, "requestedPath")
    const completed = {
      ...source,
      id: "completed",
      status: "completed",
      completed: 10,
      settingsSnapshot: {
        ...source.settingsSnapshot,
        destination: "file-system-access",
      },
      chapters: [{ ...chapter, status: "completed", outputDestination: "fsa" }],
    }
    const { local } = storageHarness({
      stateSchemaEpoch: 2,
      downloadQueue: [
        {
          ...source,
          settingsSnapshot: {
            ...source.settingsSnapshot,
            destination: "downloads-api",
          },
          chapters: [chapter],
        },
        completed,
      ],
      pendingUndoActions: [],
      siteIntegrationEnablement: { manhuagui: false },
      siteIntegrationSettings: { manhuagui: {} },
      siteOverrides: { manhuagui: { pathTemplate: "Library/manhuagui" } },
      downloadedChapters: [
        {
          chapterId: chapter.id,
          url: chapter.url,
          title: chapter.title,
          seriesId: source.mangaId,
          seriesTitle: source.seriesTitle,
          downloadedAt: 10,
          format: "cbz",
        },
      ],
    })
    await migrateDurableStateForCurrentSchema()
    expect(local.downloadQueue).toMatchObject([
      {
        siteIntegrationId: "readmanga",
        chapters: [
          { requestedPath: expect.stringContaining("Library/manhuagui/") },
        ],
      },
      { siteIntegrationId: "readmanga", chapters: [{ saveConfirmedAt: 10 }] },
    ])
    expect(local.siteIntegrationEnablement).toEqual({ readmanga: false })
    expect(local.siteOverrides).toMatchObject({
      readmanga: { pathTemplate: "Library/manhuagui" },
    })
    expect(await new HistoryRepository().getDownloadedChapters()).toMatchObject(
      [
        {
          siteIntegrationId: "readmanga",
          saveConfirmedAt: 10,
          outputDestination: "fsa",
        },
      ]
    )
  })

  it("preserves native identities and settles the renamed task once after cold hydration", async () => {
    const active = task()
    active.status = "downloading"
    active.chapters[0]!.status = "downloading"
    active.chapters[0]!.dispatchAttempt = 1
    const identity = {
      jobId: "manhuagui-job",
      attempt: 1,
      taskId: active.id,
      chapterId: active.chapters[0]!.id,
      fingerprint: "a".repeat(64),
      documentInstanceId: "manhuagui-document",
    }
    const lease = {
      ...identity,
      saveMode: "downloads-api",
      stage: "saving",
      startedAt: 1,
      lastActivityAt: 2,
      leaseExpiresAt: 9999999999999,
      sequence: 1,
    }
    const native = {
      "pendingOutputs:index": {
        jobIds: [identity.jobId],
        outputIds: ["manhuagui-output"],
        downloadIdToOutputId: { "42": "manhuagui-output" },
      },
      "pendingOutputs:manifest:manhuagui-job": {
        ...identity,
        phase: "sealed",
        outputsRequested: 1,
        outputsFailedBeforeHandoff: 0,
        slots: [{ disposition: "tracked", outputId: "manhuagui-output" }],
        createdAt: 1,
        sealedAt: 3,
      },
      "pendingOutputs:output:manhuagui-output": {
        ...identity,
        outputId: "manhuagui-output",
        outputIndex: 0,
        outputCount: 1,
        blobUrl: "blob:manhuagui-output",
        filename: active.chapters[0]!.requestedPath,
        outputKind: "archive",
        phase: "waiting",
        downloadId: 42,
        createdAt: 1,
        acceptanceStartedAt: 2,
        accountingDisposition: "pending",
      },
    }
    const { local } = storageHarness({
      stateSchemaEpoch: 9,
      downloadQueue: [active],
      pendingUndoActions: [],
      activeDispatchLease: lease,
      ...native,
    })
    await migrateDurableStateForCurrentSchema()
    expect(local.activeDispatchLease).toEqual(lease)
    for (const [key, value] of Object.entries(native))
      expect(local[key]).toEqual(value)
    const history = new HistoryRepository()
    const queue = new QueueRepository(new QueueProjectionService(), history)
    const repository = new NativeOutputRepository()
    const revoke = vi.fn(async () => undefined)
    const coordinator = new NativeOutputCoordinator({
      settingsRepository: { getSettings: async () => DEFAULT_SETTINGS },
      queueRepository: queue,
      repository,
      queryOffscreenJob: async () => null,
      requestBlobRevocation: revoke,
      ensureLivenessAlarm: async () => undefined,
    })
    await queue.initialize()
    await coordinator.initialize()
    expect(
      await queue.recoverQueueAfterStartup({
        normalizationTime: 20,
        interruptedAt: 20,
        observedLease: identity,
        offscreenJob: { ...identity, status: "active" },
        nativeOutputTaskIds: await coordinator.getLiveTaskIds(),
      })
    ).toMatchObject({
      outcome: "unchanged",
      leaseCleared: false,
      interruptedTaskIds: [],
    })
    expect(await queue.getActiveDispatchLease()).toEqual(lease)
    expect(
      await queue.recoverQueueAfterStartup({
        normalizationTime: 21,
        interruptedAt: 21,
        observedLease: identity,
        offscreenJob: null,
        nativeOutputTaskIds: await coordinator.getLiveTaskIds(),
      })
    ).toMatchObject({
      outcome: "applied",
      leaseCleared: true,
      interruptedTaskIds: [],
    })
    const result = await coordinator.handleDownloadChanged({
      id: 42,
      state: { current: "complete" },
    })
    expect(await queue.getTask(active.id)).toMatchObject({
      siteIntegrationId: "readmanga",
      status: "completed",
      chapters: [
        {
          requestedPath: active.chapters[0]!.requestedPath,
          saveConfirmedAt: expect.any(Number),
          nativeOutputSettlement: {
            jobId: identity.jobId,
            completed: 1,
            interrupted: 0,
          },
        },
      ],
    })
    for (const effect of result.effects)
      await coordinator.acknowledgeSettlement(effect)
    await coordinator.handleDownloadChanged({
      id: 42,
      state: { current: "complete" },
    })
    expect(revoke).toHaveBeenCalledOnce()
    expect(await queue.getQueue()).toHaveLength(1)
    expect(chrome.downloads.search).toHaveBeenCalled()
  })

  it("rejects timing writes in historical journals before replay", async () => {
    const { local, storage } = storageHarness({
      stateSchemaEpoch: 8,
      stateSchemaMigrationJournal: {
        sourceEpoch: 8,
        targetEpoch: 9,
        phase: "prepared",
        writes: {
          downloadQueue: [],
          pendingUndoActions: [],
          progressTimingEstimates: {},
        },
        obsoleteKeys: [],
      },
    })
    await expect(migrateDurableStateForCurrentSchema()).rejects.toThrow(
      "invalid write key: progressTimingEstimates"
    )
    expect(local.stateSchemaEpoch).toBe(8)
    expect(storage.set).not.toHaveBeenCalled()
  })

  it("replays an older journal's original provider maps before rekeying them", async () => {
    const writes = {
      downloadQueue: [],
      pendingUndoActions: [],
      siteIntegrationEnablement: { comicnettai: false },
      siteIntegrationSettings: { comicnettai: {} },
      siteOverrides: {
        comicnettai: { pathTemplate: "comicnettai/<SERIES_TITLE>" },
      },
    }
    const { local, storage } = storageHarness({
      stateSchemaEpoch: 2,
      stateSchemaMigrationJournal: {
        sourceEpoch: 2,
        targetEpoch: 3,
        phase: "prepared",
        writes,
        obsoleteKeys: [],
      },
    })
    await migrateDurableStateForCurrentSchema()
    expect(storage.set.mock.calls[0]![0]).toEqual(writes)
    expect(local.siteIntegrationEnablement).toEqual({ comictropics: false })
    expect(local.siteOverrides).toEqual({
      comictropics: { pathTemplate: "comicnettai/<SERIES_TITLE>" },
    })
    expect(local.stateSchemaEpoch).toBe(10)
  })

  it.each(["documents", "journal-removal"])(
    "recovers an interrupted epoch-10 %s write without duplicating records",
    async (failure) => {
      const { local, storage } = storageHarness({
        stateSchemaEpoch: 9,
        downloadQueue: [task()],
        pendingUndoActions: [],
        progressTimingEstimates: {
          "manhuagui|saving|cbz|downloads-api|none": 500,
        },
      })
      const set = storage.set.getMockImplementation()!
      const remove = storage.remove.getMockImplementation()!
      let fail = true
      storage.set.mockImplementation(async (values) => {
        if (fail && failure === "documents" && "downloadQueue" in values) {
          fail = false
          throw new Error("Storage unavailable")
        }
        await set(values)
      })
      storage.remove.mockImplementation(async (keys) => {
        if (fail && failure === "journal-removal") {
          fail = false
          throw new Error("Storage unavailable")
        }
        await remove(keys)
      })
      await expect(migrateDurableStateForCurrentSchema()).rejects.toThrow(
        "Storage unavailable"
      )
      expect(local.stateSchemaEpoch).toBe(failure === "documents" ? 9 : 10)
      expect(local.stateSchemaMigrationJournal).toMatchObject({
        targetEpoch: 10,
        writes: {
          downloadQueue: [{ siteIntegrationId: "readmanga" }],
          progressTimingEstimates: {
            "readmanga|saving|cbz|downloads-api|none": 500,
          },
        },
      })
      await migrateDurableStateForCurrentSchema()
      expect(local.downloadQueue).toMatchObject([
        { siteIntegrationId: "readmanga" },
      ])
      expect(local.downloadQueue).toHaveLength(1)
      expect(local.stateSchemaEpoch).toBe(10)
      expect(local).not.toHaveProperty("stateSchemaMigrationJournal")
      const calls = storage.set.mock.calls.length
      await migrateDurableStateForCurrentSchema()
      expect(storage.set.mock.calls).toHaveLength(calls)
    }
  )

  it("keeps cleared chapter and series history absent during completed-task reconciliation", async () => {
    const completed = [
      task("manhuagui", "chapter-cleared"),
      task("dm5", "series-cleared"),
      task("aimanhua", "retained"),
    ].map((source): DownloadTaskState => ({
      ...source,
      status: "completed",
      completed: 10,
      chapters: source.chapters.map((chapter) => ({
        ...chapter,
        status: "completed",
        outputDestination: "fsa",
        saveConfirmedAt: 9,
      })),
    }))
    storageHarness({
      stateSchemaEpoch: 9,
      downloadQueue: completed,
      pendingUndoActions: [],
      downloadedChapters: [],
      seriesDownloadHistory: {},
      downloadHistoryClearCutoffs: {
        allBefore: 5,
        bySeries: { "dm5#publisher-manhuagui#series": 10 },
        byChapter: {
          "manhuagui\0publisher-manhuagui#series\0publisher-dm5/chapter": 10,
        },
      },
    })
    await migrateDurableStateForCurrentSchema()
    const history = new HistoryRepository()
    const queue = new QueueRepository(new QueueProjectionService(), history)
    await queue.initialize()
    await reconcileCompletedChapterHistory(await queue.getQueue(), history)
    expect(await history.getDownloadedChapters()).toMatchObject([
      { siteIntegrationId: "lovemanga", saveConfirmedAt: 9 },
    ])
    expect(await history.getDownloadedChapters()).toHaveLength(1)
  })
})
