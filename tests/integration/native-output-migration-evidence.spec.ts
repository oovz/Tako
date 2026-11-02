import { afterEach, describe, expect, it, vi } from "vitest"
import { NativeOutputRepository } from "@/src/storage/native-output-repository"
import { HistoryRepository } from "@/src/storage/history-repository"
import { QueueRepository } from "@/src/storage/queue-repository"
import { QueueProjectionService } from "@/src/storage/queue-projection-service"
import {
  CURRENT_STATE_SCHEMA_EPOCH,
  migrateDurableStateForCurrentSchema,
} from "@/src/runtime/state-schema-migration"
import { nativeStateWrites } from "@/src/runtime/state-schema-migration-output"
import { toQueueTaskSummary } from "@/src/runtime/queue-task-summary"

const identity = {
  jobId: "job",
  attempt: 1,
  taskId: "task",
  chapterId: "chapter",
  fingerprint: "a".repeat(64),
  documentInstanceId: "document",
}
const outputIdentity = {
  ...identity,
  outputId: "output",
  outputIndex: 0,
  outputCount: 1,
  blobUrl: "blob:output",
  filename: "Series/Chapter.cbz",
  outputKind: "archive" as const,
}

// Released source-3 writers retained explicit surrender counts and surrender receipts.
const historicalInputs = {
  surrenderedNativeState: {
    manifestsByJobId: {
      job: {
        jobId: "job",
        attempt: 1,
        taskId: "task",
        chapterId: "chapter",
        fingerprint:
          "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        documentInstanceId: "document",
        phase: "sealed",
        outputsRequested: 1,
        outputsFailedBeforeHandoff: 0,
        slots: [
          {
            disposition: "tracked",
            outputId: "output",
          },
        ],
        createdAt: 100,
        sealedAt: 100,
      },
    },
    outputsByOutputId: {
      output: {
        outputId: "output",
        jobId: "job",
        attempt: 1,
        taskId: "task",
        chapterId: "chapter",
        fingerprint:
          "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        documentInstanceId: "document",
        outputIndex: 0,
        outputCount: 1,
        blobUrl: "blob:output",
        filename: "Series/Chapter.cbz",
        outputKind: "archive",
        phase: "surrendered",
        createdAt: 100,
        accountingDisposition: "pending",
        acceptanceStartedAt: 100,
        downloadId: 42,
        erasedAt: 100,
        surrenderedAt: 100,
      },
    },
  },
  knownSettlementTask: {
    id: "task",
    siteIntegrationId: "mangadex",
    mangaId: "series",
    seriesTitle: "Series",
    status: "completed",
    created: 10,
    settingsSnapshot: {
      archiveFormat: "cbz",
      destination: "downloads-api",
      conflictPolicy: "uniquify",
      pathTemplate: "<SERIES_TITLE>",
      fileNameTemplate: "<CHAPTER_TITLE>",
      includeComicInfo: true,
      includeCoverImage: true,
      siteSettings: {},
      rateLimitSettings: {
        image: {
          concurrency: 3,
          delayMs: 0,
        },
        chapter: {
          concurrency: 1,
          delayMs: 0,
        },
      },
      retrySettings: {
        image: 3,
        chapter: 1,
      },
      normalizeImageFilenames: true,
      imagePaddingDigits: 3,
      siteIntegrationId: "mangadex",
    },
    chapters: [
      {
        id: "chapter",
        url: "https://mangadex.org/chapter/chapter",
        title: "Chapter",
        index: 0,
        status: "completed",
        lastUpdated: 100,
        dispatchAttempt: 1,
        outputs: {
          requested: 1,
          committed: 1,
          failed: 0,
        },
        nativeOutputSettlement: {
          jobId: "job",
          attempt: 1,
          taskId: "task",
          chapterId: "chapter",
          requested: 1,
          completed: 1,
          interrupted: 0,
          surrendered: 0,
          lastSuccessfulDownloadId: 42,
          appliedAt: 100,
        },
      },
    ],
    started: 20,
    lastSuccessfulDownloadId: 42,
    completed: 100,
  },
}

function storageHarness(initial: Record<string, unknown> = {}) {
  const stored = structuredClone(initial)
  const local = {
    get: vi.fn(async (keys: string | string[] | null) => {
      if (keys === null) return structuredClone(stored)
      return Object.fromEntries(
        [keys]
          .flat()
          .flatMap((key) =>
            key in stored ? [[key, structuredClone(stored[key])]] : []
          )
      )
    }),
    set: vi.fn(async (values: Record<string, unknown>) => {
      Object.assign(stored, structuredClone(values))
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const key of [keys].flat()) delete stored[key]
    }),
  }
  vi.stubGlobal("chrome", {
    i18n: { getMessage: (key: string) => key },
    storage: { local, session: { set: vi.fn(async () => undefined) } },
  })
  return stored
}

async function waitingOutput(repository: NativeOutputRepository) {
  await expect(
    repository.prepare({ ...outputIdentity, now: 100 })
  ).resolves.toMatchObject({ outcome: "applied" })
  await expect(
    repository.markAcceptanceUnknown({ outputId: "output", now: 100 })
  ).resolves.toMatchObject({ outcome: "applied" })
  await expect(
    repository.attachDownload({ outputId: "output", downloadId: 42 })
  ).resolves.toMatchObject({ outcome: "applied" })
  await expect(
    repository.sealManifest({
      ...identity,
      outputsRequested: 1,
      outputsFailedBeforeHandoff: 0,
      now: 100,
      error: "Unused failure cause",
    })
  ).resolves.toMatchObject({ outcome: "applied" })
}

function installProcessingReceipt(stored: Record<string, unknown>) {
  const task = structuredClone(historicalInputs.knownSettlementTask)
  const chapter = task.chapters[0]
  const record = {
    siteIntegrationId: task.siteIntegrationId,
    seriesId: task.mangaId,
    seriesTitle: task.seriesTitle,
    chapterId: chapter.id,
    title: chapter.title,
    url: chapter.url,
    downloadedAt: chapter.lastUpdated,
    format: "cbz",
  }
  Object.assign(stored, {
    stateSchemaEpoch: 3,
    downloadQueue: [task],
    pendingUndoActions: [],
    downloadedChapters: [record],
    downloadHistoryClearCutoffs: { bySeries: {}, byChapter: {} },
    seriesDownloadHistory: {
      "mangadex#series": {
        siteIntegrationId: task.siteIntegrationId,
        seriesId: task.mangaId,
        seriesTitle: task.seriesTitle,
        lastUpdated: record.downloadedAt,
        downloadedChapters: [record],
      },
    },
  })
}

async function migratedChapter() {
  const history = new HistoryRepository()
  const queue = new QueueRepository(new QueueProjectionService(), history)
  await queue.initialize()
  return {
    task: await queue.getTask("task"),
    history: await history.getDownloadedChapters(),
  }
}

afterEach(() => vi.unstubAllGlobals())

describe("native output evidence during durable upgrades", () => {
  it("retains the sole failed-before-handoff manifest sealed in its creation tick", async () => {
    const stored = storageHarness()
    const repository = new NativeOutputRepository()
    await expect(
      repository.sealManifest({
        ...identity,
        outputsRequested: 1,
        outputsFailedBeforeHandoff: 1,
        error: "Output could not be initiated",
        now: 100,
      })
    ).resolves.toMatchObject({ outcome: "applied" })
    stored.stateSchemaEpoch = 3
    await expect(migrateDurableStateForCurrentSchema()).resolves.toBeUndefined()
    const current = await new NativeOutputRepository().snapshot()
    expect(current.manifestsByJobId.job).toMatchObject({
      ...identity,
      phase: "sealed",
      outputsRequested: 1,
      outputsFailedBeforeHandoff: 1,
      createdAt: 100,
      sealedAt: 100,
      slots: [{ disposition: "untracked_failed", failedAt: 100 }],
    })
    expect(current.outputsByOutputId).toEqual({})
    expect(stored["pendingOutputs:index"]).toMatchObject({
      jobIds: ["job"],
      outputIds: [],
    })
    expect(stored.stateSchemaEpoch).toBe(CURRENT_STATE_SCHEMA_EPOCH)
  })

  it.each(["waiting", "complete", "interrupted"] as const)(
    "imports an ordinary %s output with same-tick lifecycle boundaries",
    async (phase) => {
      const stored = storageHarness()
      const repository = new NativeOutputRepository()
      await waitingOutput(repository)
      if (phase !== "waiting") {
        await expect(
          repository.markTerminal({ downloadId: 42, phase, now: 100 })
        ).resolves.toMatchObject({ outcome: "applied" })
        await expect(
          repository.markAccountingDisposition({
            outputId: "output",
            disposition: "accounted",
            now: 100,
          })
        ).resolves.toMatchObject({ outcome: "applied" })
        await expect(
          repository.markBlobReleased({ outputId: "output", now: 100 })
        ).resolves.toMatchObject({ outcome: "applied" })
      }
      stored.stateSchemaEpoch = 3
      await expect(
        migrateDurableStateForCurrentSchema()
      ).resolves.toBeUndefined()
      const output = await new NativeOutputRepository().getByOutputId("output")
      expect(output).toMatchObject({
        ...outputIdentity,
        phase,
        createdAt: 100,
        acceptanceStartedAt: 100,
        downloadId: 42,
      })
      if (phase !== "waiting")
        expect(output).toMatchObject({ terminalAt: 100, blobReleasedAt: 100 })
      expect(output).not.toHaveProperty("erasedByBrowserAt")
      expect(stored.stateSchemaEpoch).toBe(CURRENT_STATE_SCHEMA_EPOCH)
    }
  )

  it("retains unknown ownership after historical erasure and surrender share a timestamp", async () => {
    const stored = storageHarness({
      stateSchemaEpoch: 3,
      ...nativeStateWrites(historicalInputs.surrenderedNativeState),
    })
    await expect(migrateDurableStateForCurrentSchema()).resolves.toBeUndefined()
    expect(
      await new NativeOutputRepository().getByOutputId("output")
    ).toMatchObject({
      ...outputIdentity,
      phase: "outcome_unknown",
      erasedAt: 100,
      createdAt: 100,
      acceptanceStartedAt: 100,
    })
    expect(stored.stateSchemaEpoch).toBe(CURRENT_STATE_SCHEMA_EPOCH)
  })

  it("keeps a known historical settlement with zero surrendered outputs certain", async () => {
    const stored = storageHarness()
    const repository = new NativeOutputRepository()
    await waitingOutput(repository)
    await expect(
      repository.markTerminal({ downloadId: 42, phase: "complete", now: 100 })
    ).resolves.toMatchObject({ outcome: "applied" })
    installProcessingReceipt(stored)
    await expect(migrateDurableStateForCurrentSchema()).resolves.toBeUndefined()
    const { task, history } = await migratedChapter()
    expect(task?.chapters[0]?.nativeOutputSettlement).toMatchObject({
      requested: 1,
      completed: 1,
      interrupted: 0,
    })
    expect(
      task?.chapters[0]?.nativeOutputSettlement?.outputUncertain
    ).toBeUndefined()
    expect(task && toQueueTaskSummary(task).outputUncertain).toBe(false)
    expect(task?.chapters[0]?.saveConfirmedAt).toBe(100)
    expect(history[0]?.saveConfirmedAt).toBe(100)
  })

  it.each(["complete", "interrupted"] as const)(
    "uses a later Chrome %s event as save evidence only when transfer completed",
    async (phase) => {
      const stored = storageHarness()
      const repository = new NativeOutputRepository()
      await waitingOutput(repository)
      installProcessingReceipt(stored)
      await expect(
        repository.markTerminal({ downloadId: 42, phase, now: 200 })
      ).resolves.toMatchObject({ outcome: "applied" })
      await expect(
        migrateDurableStateForCurrentSchema()
      ).resolves.toBeUndefined()
      const { task, history } = await migratedChapter()
      expect(task?.chapters[0]?.status).toBe("completed")
      expect(task?.chapters[0]?.saveConfirmedAt).toBe(
        phase === "complete" ? 200 : undefined
      )
      expect(history[0]?.saveConfirmedAt).toBe(
        phase === "complete" ? 200 : undefined
      )
    }
  )

  it("keeps a collected native job unknown while retaining its historical processing receipt", async () => {
    const stored = storageHarness()
    const repository = new NativeOutputRepository()
    await waitingOutput(repository)
    await expect(
      repository.markTerminal({ downloadId: 42, phase: "complete", now: 200 })
    ).resolves.toMatchObject({ outcome: "applied" })
    await expect(
      repository.markAccountingDisposition({
        outputId: "output",
        disposition: "accounted",
        now: 200,
      })
    ).resolves.toMatchObject({ outcome: "applied" })
    await expect(
      repository.markBlobReleased({ outputId: "output", now: 200 })
    ).resolves.toMatchObject({ outcome: "applied" })
    await expect(
      repository.markDependencyReleased({ outputId: "output", now: 200 })
    ).resolves.toMatchObject({ outcome: "applied" })
    await expect(
      repository.acknowledgeSettlement({ jobId: "job", now: 200 })
    ).resolves.toMatchObject({ outcome: "applied" })
    await expect(
      repository.markJobDependencyReleased({ jobId: "job", now: 200 })
    ).resolves.toMatchObject({ outcome: "applied" })
    expect(await new NativeOutputRepository().snapshot()).toEqual({
      manifestsByJobId: {},
      outputsByOutputId: {},
    })
    installProcessingReceipt(stored)
    await expect(migrateDurableStateForCurrentSchema()).resolves.toBeUndefined()
    const { task, history } = await migratedChapter()
    expect(task?.chapters[0]?.status).toBe("completed")
    expect(task?.chapters[0]?.saveConfirmedAt).toBeUndefined()
    expect(history[0]?.saveConfirmedAt).toBeUndefined()
    expect(stored.stateSchemaEpoch).toBe(CURRENT_STATE_SCHEMA_EPOCH)
  })
})
