import { afterEach, describe, expect, it, vi } from "vitest"

import { NativeOutputCoordinator } from "@/entrypoints/background/native-output-coordinator"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import {
  migrateDurableStateForCurrentSchema,
  CURRENT_STATE_SCHEMA_EPOCH,
} from "@/src/runtime/state-schema-migration"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { HistoryRepository } from "@/src/storage/history-repository"
import { NativeOutputRepository } from "@/src/storage/native-output-repository"
import { QueueProjectionService } from "@/src/storage/queue-projection-service"
import { QueueRepository } from "@/src/storage/queue-repository"

const identity = {
  jobId: "job",
  attempt: 1,
  taskId: "task",
  chapterId: "chapter",
  fingerprint: "a".repeat(64),
  documentInstanceId: "document",
}

function profile(accounted = false) {
  const task = {
    id: "task",
    siteIntegrationId: "mangadex",
    mangaId: "series",
    seriesTitle: "Series",
    created: 1,
    status: accounted ? "completed" : "downloading",
    ...(accounted ? { completed: 4 } : {}),
    settingsSnapshot: createTaskSettingsSnapshot(DEFAULT_SETTINGS, "mangadex"),
    chapters: [
      {
        requestedPath: "Series/Chapter.cbz",
        id: "chapter",
        url: "https://mangadex.org/chapter/chapter",
        title: "Chapter",
        index: 0,
        status: accounted ? "completed" : "downloading",
        dispatchAttempt: 1,
        lastUpdated: 4,
        ...(accounted
          ? {
              outputDestination: "downloads-api",
              nativeOutputSettlement: {
                jobId: "job",
                attempt: 1,
                taskId: "task",
                chapterId: "chapter",
                requested: 1,
                completed: 1,
                interrupted: 0,
                appliedAt: 4,
              },
            }
          : {}),
      },
    ],
  }
  return {
    stateSchemaEpoch: 6,
    downloadQueue: [task],
    pendingUndoActions: [],
    "pendingOutputs:index": {
      jobIds: ["job"],
      outputIds: ["output"],
      downloadIdToOutputId: { "42": "output" },
    },
    "pendingOutputs:manifest:job": {
      ...identity,
      phase: "sealed",
      outputsRequested: 1,
      outputsFailedBeforeHandoff: 0,
      slots: [{ disposition: "tracked", outputId: "output" }],
      createdAt: 1,
      sealedAt: 4,
      ...(accounted ? { settlementAcknowledgedAt: 4 } : {}),
    },
    "pendingOutputs:output:output": {
      ...identity,
      outputId: "output",
      outputIndex: 0,
      outputCount: 1,
      blobUrl: "blob:output",
      filename: "Series/Chapter.cbz",
      outputKind: "archive",
      phase: "waiting",
      downloadId: 42,
      createdAt: 1,
      acceptanceStartedAt: 2,
      accountingDisposition: accounted ? "accounted" : "pending",
      ...(accounted ? { accountingDispositionAt: 4 } : {}),
    },
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
    storage: { local: storage, session: { set: vi.fn(async () => undefined) } },
    downloads: {
      search: vi.fn(async () => [
        {
          id: 42,
          state: "in_progress",
          url: "blob:output",
          filename: "/Downloads/Series/Chapter.cbz",
        },
      ]),
    },
  })
  return { local, storage }
}

afterEach(() => vi.unstubAllGlobals())

describe("retained native save ownership", () => {
  it.each([false, true])(
    "keeps initiation-era accounting=%s distinct from final save evidence",
    async (accounted) => {
      storageHarness(profile(accounted))
      await migrateDurableStateForCurrentSchema()
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
      const before = await queue.getTask("task")
      expect(before?.chapters[0]?.saveConfirmedAt).toBeUndefined()
      expect(await repository.getByOutputId("output")).toMatchObject({
        phase: accounted ? "outcome_unknown" : "waiting",
        downloadId: 42,
        accountingDisposition: accounted ? "accounted" : "pending",
      })
      expect(revoke).not.toHaveBeenCalled()
      const result = await coordinator.handleDownloadChanged({
        id: 42,
        state: { current: "complete" },
      })
      const after = await queue.getTask("task")
      if (accounted) expect(after).toEqual(before)
      else
        expect(after).toMatchObject({
          status: "completed",
          chapters: [
            {
              saveConfirmedAt: expect.any(Number),
              nativeOutputSettlement: { completed: 1, interrupted: 0 },
            },
          ],
        })
      for (const effect of result.effects)
        await coordinator.acknowledgeSettlement(effect)
      expect(revoke).toHaveBeenCalledOnce()
    }
  )

  it("replays a prepared destination-era journal before converting native save outcomes", async () => {
    const initial = profile(true)
    const targetTask = initial.downloadQueue[0]!
    const sourceTask = {
      ...targetTask,
      settingsSnapshot: {
        ...targetTask.settingsSnapshot,
        destination: "downloads-api",
      },
      chapters: targetTask.chapters.map(
        ({ requestedPath: _path, ...chapter }) => chapter
      ),
    }
    const { local, storage } = storageHarness({
      ...initial,
      stateSchemaEpoch: 5,
      downloadQueue: [sourceTask],
      stateSchemaMigrationJournal: {
        sourceEpoch: 5,
        targetEpoch: 6,
        phase: "prepared",
        writes: { downloadQueue: [targetTask], pendingUndoActions: [] },
        obsoleteKeys: [],
      },
    })
    await migrateDurableStateForCurrentSchema()
    expect(
      storage.set.mock.calls.flatMap(([values]) =>
        "stateSchemaEpoch" in values ? [values.stateSchemaEpoch] : []
      )
    ).toEqual([6, 7, 8, 9, 10])
    expect(local.downloadQueue).toMatchObject([
      {
        settingsSnapshot: { destination: { kind: "downloads-api" } },
        chapters: [{ requestedPath: "Series/Chapter.cbz" }],
      },
    ])
    expect(local["pendingOutputs:output:output"]).toMatchObject({
      phase: "outcome_unknown",
      downloadId: 42,
    })
    expect(local.stateSchemaMigrationJournal).toBeUndefined()
  })

  it.each([
    "prepared",
    "documents",
    "canonical-written",
    "obsolete-removed",
    "marker",
    "journal-removal",
  ])(
    "resumes the final-save conversion after interrupted %s",
    async (failure) => {
      const { local, storage } = storageHarness(profile(true))
      const set = storage.set.getMockImplementation()!
      const remove = storage.remove.getMockImplementation()!
      storage.set.mockImplementation(async (values) => {
        const journal = values.stateSchemaMigrationJournal as
          { phase?: string } | undefined
        if (
          journal?.phase === failure ||
          (failure === "documents" && "downloadQueue" in values) ||
          (failure === "marker" && "stateSchemaEpoch" in values)
        )
          throw new Error("Temporary storage failure")
        await set(values)
      })
      storage.remove.mockImplementation(async (keys) => {
        if (failure === "journal-removal")
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
      expect(local["pendingOutputs:output:output"]).toMatchObject({
        phase: "outcome_unknown",
        downloadId: 42,
        accountingDisposition: "accounted",
      })
      expect(local.downloadQueue).toMatchObject([
        { chapters: [{ status: "completed" }] },
      ])
      const before = structuredClone(local)
      storage.set.mockClear()
      await migrateDurableStateForCurrentSchema()
      expect(storage.set).not.toHaveBeenCalled()
      expect(local).toEqual(before)
    }
  )

  it.each(["downloadQueue", "pendingUndoActions"])(
    "preserves invalid explicit null %s before conversion",
    async (key) => {
      const initial = { ...profile(), [key]: null }
      const { local, storage } = storageHarness(initial)
      await expect(migrateDurableStateForCurrentSchema()).rejects.toMatchObject(
        { name: "InvalidDurableStateError" }
      )
      expect(local).toEqual(initial)
      expect(storage.set).not.toHaveBeenCalled()
    }
  )
})
