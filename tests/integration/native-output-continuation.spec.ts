import { HistoryRepository } from "@/src/storage/history-repository"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { createBackgroundOffscreenEventMessageHandlers } from "@/entrypoints/background/background-offscreen-event-message-handlers"
import { DownloadTaskExecutor } from "@/entrypoints/background/download-task-executor"
import { DownloadTaskCancellationCoordinator } from "@/entrypoints/background/download-task-cancellation-coordinator"
import { OffscreenJobTerminalCoordinator } from "@/entrypoints/background/offscreen-job-terminal-coordinator"
import { NativeOutputCoordinator } from "@/entrypoints/background/native-output-coordinator"
import { QueueScheduler } from "@/entrypoints/background/queue-scheduler"
import { runTaskSideEffectExclusive } from "@/entrypoints/background/download-task-side-effect-gate"
import { BrowserBlobLeaseRegistry } from "@/entrypoints/offscreen/browser-blob-lease-registry"
import { OffscreenLiveResourceLedger } from "@/src/runtime/offscreen-live-resource-ledger"
import type {
  ActiveDispatchLease,
  DownloadTaskState,
} from "@/src/domain/queue/state"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import { createDispatchLease } from "@/src/runtime/dispatch-lease"
import type { RuntimeMessageRequest } from "@/src/runtime/runtime-message-contracts"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { LOCAL_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import { NativeOutputRepository } from "@/src/storage/native-output-repository"
import { QueueProjectionService } from "@/src/storage/queue-projection-service"
import { QueueRepository } from "@/src/storage/queue-repository"
import { SettingsRepository } from "@/src/storage/settings-repository"

const identity = {
  jobId: "job-1",
  attempt: 1,
  taskId: "task-1",
  chapterId: "chapter-1",
  fingerprint: "a".repeat(64),
  documentInstanceId: "document-1",
}

const output = {
  ...identity,
  outputId: "output-1",
  outputIndex: 0,
  outputCount: 1,
  blobUrl: "blob:output-1",
  filename: "Series/Chapter 1.cbz",
  outputKind: "archive" as const,
}

function task(): DownloadTaskState {
  return {
    id: identity.taskId,
    siteIntegrationId: "mangadex",
    mangaId: "series-1",
    seriesTitle: "Series",
    chapters: [
      {
        id: identity.chapterId,
        url: "https://mangadex.org/chapter/chapter-1",
        title: "Chapter 1",
        index: 0,
        status: "downloading",
        dispatchAttempt: identity.attempt,
        lastUpdated: 1,
      },
      {
        id: "chapter-2",
        url: "https://mangadex.org/chapter/chapter-2",
        title: "Chapter 2",
        index: 1,
        status: "queued",
        lastUpdated: 1,
      },
    ],
    status: "downloading",
    created: 1,
    started: 2,
    settingsSnapshot: createTaskSettingsSnapshot(DEFAULT_SETTINGS, "mangadex"),
  }
}

function downloadItem(
  state: "in_progress" | "complete"
): chrome.downloads.DownloadItem {
  return {
    id: 42,
    url: output.blobUrl,
    finalUrl: output.blobUrl,
    filename: output.filename,
    incognito: false,
    danger: "safe",
    mime: "application/vnd.comicbook+zip",
    startTime: new Date(1).toISOString(),
    endTime: state === "complete" ? new Date(2).toISOString() : undefined,
    estimatedEndTime: new Date(2).toISOString(),
    state,
    paused: false,
    canResume: false,
    referrer: "",
    error: undefined,
    bytesReceived: state === "complete" ? 1 : 0,
    totalBytes: 1,
    fileSize: state === "complete" ? 1 : 0,
    exists: true,
    byExtensionId: "extension-id",
    byExtensionName: "Tako",
  }
}

describe("native output continuation boundaries", () => {
  let local: Record<string, unknown>
  let historyRepository: HistoryRepository
  let queueRepository: QueueRepository
  let nativeRepository: NativeOutputRepository
  let nativeCoordinator: NativeOutputCoordinator
  let terminalCoordinator: OffscreenJobTerminalCoordinator
  let queueScheduler: QueueScheduler
  let taskExecutor: DownloadTaskExecutor
  let activeLease: ActiveDispatchLease | null
  let taskState: DownloadTaskState
  let search: ReturnType<typeof vi.fn>
  let taskGateAcquired: ReturnType<typeof vi.fn<() => void>>
  let blobs: BrowserBlobLeaseRegistry
  let resources: OffscreenLiveResourceLedger
  let revokeObjectURL: ReturnType<typeof vi.fn<(url: string) => void>>

  beforeEach(async () => {
    taskState = task()
    activeLease = {
      ...createDispatchLease({
        ...identity,
        saveMode: "downloads-api",
        now: 1,
      }),
      documentInstanceId: identity.documentInstanceId,
    }
    local = {
      [LOCAL_STORAGE_KEYS.downloadQueue]: [taskState],
      [LOCAL_STORAGE_KEYS.activeDispatchLease]: activeLease,
      [LOCAL_STORAGE_KEYS.pendingUndoActions]: [],
    }
    search = vi.fn(async () => [downloadItem("in_progress")])
    vi.stubGlobal("chrome", {
      runtime: { id: "extension-id" },
      storage: {
        local: {
          get: vi.fn(async (keys: string | string[]) => {
            const requested = Array.isArray(keys) ? keys : [keys]
            return Object.fromEntries(
              requested
                .filter((key) => key in local)
                .map((key) => [key, structuredClone(local[key])])
            )
          }),
          set: vi.fn(async (values: Record<string, unknown>) => {
            Object.assign(local, structuredClone(values))
          }),
          remove: vi.fn(async (keys: string | string[]) => {
            for (const key of Array.isArray(keys) ? keys : [keys]) {
              delete local[key]
            }
          }),
        },
        session: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => undefined),
        },
      },
      downloads: { search },
    } as unknown as typeof chrome)

    historyRepository = new HistoryRepository()
    queueRepository = new QueueRepository(
      new QueueProjectionService(),
      historyRepository
    )
    nativeRepository = new NativeOutputRepository()
    resources = new OffscreenLiveResourceLedger(6)
    revokeObjectURL = vi.fn()
    blobs = new BrowserBlobLeaseRegistry(
      { maxCount: 2, maxBytes: 6 },
      {
        createObjectURL: vi
          .fn()
          .mockReturnValueOnce(output.blobUrl)
          .mockReturnValue("blob:later-output"),
        revokeObjectURL,
      },
      resources
    )
    blobs.retain({
      ...output,
      blob: new Blob([new Uint8Array(3)]),
      resourceLease: resources.reserve(3, "prepared output"),
    })
    const settingsRepository = new SettingsRepository("warn")
    vi.spyOn(settingsRepository, "getSettings").mockResolvedValue(
      DEFAULT_SETTINGS
    )
    taskGateAcquired = vi.fn<() => void>()
    taskExecutor = {
      execute: vi.fn(async (taskId: string) => {
        await runTaskSideEffectExclusive(taskId, async () => {
          taskGateAcquired()
        })
        return "active" as const
      }),
      isActive: vi.fn(() => false),
    } as unknown as DownloadTaskExecutor
    queueScheduler = new QueueScheduler(
      queueRepository,
      taskExecutor,
      vi.fn(async () => undefined)
    )
    nativeCoordinator = new NativeOutputCoordinator({
      settingsRepository,
      repository: nativeRepository,
      queueRepository,
      queryOffscreenJob: vi.fn(async (jobIdentity) => ({
        ...jobIdentity,
        status: "active" as const,
        stage: "saving" as const,
        lastSequence: 1,
      })),
      requestBlobRevocation: async (record) => {
        if (!blobs.revoke(record)) throw new Error("Blob identity mismatch")
      },
      ensureLivenessAlarm: vi.fn(async () => undefined),
    })
    terminalCoordinator = new OffscreenJobTerminalCoordinator(
      queueRepository,
      nativeCoordinator,
      queueScheduler,
      {} as never,
      {
        settingsRepository,
        historyRepository,
      }
    )

    await queueRepository.initialize()
    await nativeCoordinator.initialize()
    await nativeRepository.ensureManifest({
      ...identity,
      outputsRequested: 1,
      now: 2,
    })
    await nativeRepository.prepare({ ...output, now: 3 })
    await nativeRepository.markAcceptanceUnknown({
      outputId: output.outputId,
      now: 4,
    })
    await nativeRepository.attachDownload({
      outputId: output.outputId,
      downloadId: 42,
    })
  })

  function terminalPayload(): RuntimeMessageRequest<"OFFSCREEN_JOB_TERMINAL">["payload"] {
    return {
      ...identity,
      sequence: 2,
      stage: "saving",
      terminalAt: 6,
      outcome: {
        status: "completed",
        outputsRequested: 1,
        outputsCommitted: 1,
        outputsFailedBeforeHandoff: 0,
      },
    }
  }

  it("settles acknowledged output while Chrome consumes its retained Blob", async () => {
    await terminalCoordinator.handle(terminalPayload())
    expect(await queueRepository.getTask(identity.taskId)).toMatchObject({
      chapters: [
        {
          id: identity.chapterId,
          status: "completed",
          outputDestination: "downloads-api",
          outputs: { requested: 1, committed: 1, failed: 0 },
        },
        { id: "chapter-2", status: "queued" },
      ],
    })
    expect(await historyRepository.getDownloadedChapters()).toMatchObject([
      { chapterId: identity.chapterId, outputDestination: "downloads-api" },
    ])
    expect(taskGateAcquired).toHaveBeenCalledOnce()
    expect(resources.getUsedBytes()).toBe(3)
    expect(revokeObjectURL).not.toHaveBeenCalled()
    expect(await nativeRepository.getByOutputId(output.outputId)).toMatchObject(
      {
        phase: "waiting",
        accountingDisposition: "accounted",
      }
    )

    const before = await queueRepository.getTask(identity.taskId)
    const result = await nativeCoordinator.handleDownloadChanged({
      id: 42,
      state: { current: "interrupted" },
      error: { current: "USER_CANCELED" },
    })
    expect(result.effects).toEqual([])
    expect(await queueRepository.getTask(identity.taskId)).toEqual(before)
    expect(await historyRepository.getDownloadedChapters()).toHaveLength(1)
    expect(resources.getUsedBytes()).toBe(0)
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith(output.blobUrl)
  })

  it("rejects native queue settlement while the real producer lease is active", async () => {
    await nativeRepository.markTerminal({
      downloadId: 42,
      phase: "complete",
      now: 5,
    })
    const result = await queueRepository.applyNativeOutputSettlement({
      ...identity,
      requested: 1,
      completed: 1,
      interrupted: 0,
      now: 6,
    })

    expect(result).toMatchObject({
      outcome: "conflict",
      reason: "lease-conflict",
    })
    expect(activeLease).not.toBeNull()
  })

  it("releases terminal Blob bytes while the producer still owns queue accounting", async () => {
    expect(
      await nativeCoordinator.handleDownloadChanged({
        id: 42,
        state: { current: "complete" },
      })
    ).toEqual({ handled: true, effects: [] })
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith(output.blobUrl)
    expect(resources.getUsedBytes()).toBe(0)
    expect(await nativeRepository.getByOutputId(output.outputId)).toMatchObject(
      {
        phase: "complete",
        accountingDisposition: "pending",
        blobReleasedAt: expect.any(Number),
      }
    )
    expect(await queueRepository.getActiveDispatchLease()).not.toBeNull()
    expect(await queueRepository.getTask(identity.taskId)).toMatchObject({
      chapters: [{ status: "downloading" }, { status: "queued" }],
    })
    await nativeCoordinator.reconcile()
    expect(revokeObjectURL).toHaveBeenCalledOnce()
  })

  it("keeps canceled output bounded across task removal and cold recovery until Chrome stops consuming it", async () => {
    await queueRepository.cancelDownloadTask({
      taskId: identity.taskId,
      commandId: "cancel-with-retained-output",
      now: 7,
    })
    await nativeCoordinator.cancelTask(identity.taskId, identity)
    await queueRepository.clearTerminalHistory()
    expect(await queueRepository.getTask(identity.taskId)).toBeUndefined()
    expect(
      await new HistoryRepository().isChapterDownloaded(
        "mangadex",
        "series-1",
        identity.chapterId
      )
    ).toBe(false)

    const later = { ...output, jobId: "later-job", outputId: "later-output" }
    const laterBlob = blobs.retain({
      ...later,
      blob: new Blob([new Uint8Array(3)]),
      resourceLease: resources.reserve(3, "later output"),
    })
    expect(blobs.getRetainedCount()).toBe(2)
    expect(blobs.getRetainedBytes()).toBe(6)
    expect(() => resources.reserve(1, "overflow")).toThrow("resource cap")
    expect(() =>
      blobs.retain({
        ...later,
        outputId: "overflow",
        blob: new Blob([]),
      })
    ).toThrow("count limit")

    const coldRepository = new NativeOutputRepository()
    const coldQueue = new QueueRepository(
      new QueueProjectionService(),
      new HistoryRepository()
    )
    const cold = new NativeOutputCoordinator({
      settingsRepository: { getSettings: async () => DEFAULT_SETTINGS },
      repository: coldRepository,
      queueRepository: coldQueue,
      queryOffscreenJob: async () => null,
      requestBlobRevocation: async (record) => {
        if (!blobs.revoke(record)) throw new Error("Blob identity mismatch")
      },
      ensureLivenessAlarm: async () => undefined,
    })
    await cold.initialize()
    expect(resources.getUsedBytes()).toBe(6)
    expect(await cold.hasLiveDependencies()).toBe(true)
    expect(revokeObjectURL).not.toHaveBeenCalled()

    const { effects } = await cold.handleDownloadChanged({
      id: 42,
      state: { current: "interrupted" },
      error: { current: "USER_CANCELED" },
    })
    for (const effect of effects) await cold.acknowledgeSettlement(effect)
    await cold.reconcile()
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith(output.blobUrl)
    expect(resources.getUsedBytes()).toBe(3)
    expect(await cold.hasLiveDependencies()).toBe(false)
    expect(blobs.revoke({ ...laterBlob, attempt: 2 })).toBe(false)
    expect(resources.getUsedBytes()).toBe(3)
    expect(blobs.revoke(laterBlob)).toBe(true)
    expect(blobs.revoke(laterBlob)).toBe(true)
    expect(resources.getUsedBytes()).toBe(0)
  })

  it("releases terminal bytes before a queue-accounting write fails and recovers accounting durably", async () => {
    await terminalCoordinator.settle(terminalPayload())
    vi.spyOn(
      queueRepository,
      "applyNativeOutputSettlement"
    ).mockRejectedValueOnce(new Error("queue storage unavailable"))
    await expect(
      nativeCoordinator.handleDownloadChanged({
        id: 42,
        state: { current: "complete" },
      })
    ).rejects.toThrow("queue storage unavailable")
    expect(resources.getUsedBytes()).toBe(0)
    expect(await nativeRepository.getByOutputId(output.outputId)).toMatchObject(
      {
        accountingDisposition: "pending",
        blobReleasedAt: expect.any(Number),
      }
    )
    const effects = await nativeCoordinator.reconcile()
    await terminalCoordinator.continueAfterNativeOutputSettlement(effects)
    expect(
      await nativeRepository.getByOutputId(output.outputId)
    ).toBeUndefined()
    expect(revokeObjectURL).toHaveBeenCalledOnce()
  })

  it.each(["complete", "interrupted", "erased"] as const)(
    "retains acknowledged missing Chrome output after cold recovery until Chrome reports %s",
    async (observation) => {
      await terminalCoordinator.settle(terminalPayload())
      search.mockResolvedValue([])
      await nativeCoordinator.reconcile()
      const effects = await nativeCoordinator.reconcile()
      for (const effect of effects)
        await nativeCoordinator.acknowledgeSettlement(effect)
      expect(resources.getUsedBytes()).toBe(3)
      expect(revokeObjectURL).not.toHaveBeenCalled()
      expect(
        await nativeRepository.getByOutputId(output.outputId)
      ).toMatchObject({
        phase: "waiting",
        accountingDisposition: "accounted",
      })
      const coldRepository = new NativeOutputRepository()
      const cold = new NativeOutputCoordinator({
        settingsRepository: { getSettings: async () => DEFAULT_SETTINGS },
        repository: coldRepository,
        queueRepository: new QueueRepository(
          new QueueProjectionService(),
          new HistoryRepository()
        ),
        queryOffscreenJob: async () => null,
        requestBlobRevocation: async (record) => {
          if (!blobs.revoke(record)) throw new Error("Blob identity mismatch")
        },
        ensureLivenessAlarm: async () => undefined,
      })
      await cold.initialize()
      expect(await cold.getLiveTaskIds()).toEqual([])
      expect(resources.getUsedBytes()).toBe(3)
      if (observation === "erased") {
        await cold.handleDownloadErased(42)
      } else {
        await cold.handleDownloadChanged({
          id: 42,
          state: { current: observation },
        })
      }
      expect(resources.getUsedBytes()).toBe(0)
      expect(revokeObjectURL).toHaveBeenCalledOnce()
      expect(await cold.hasLiveDependencies()).toBe(false)
      expect(await queueRepository.getTask(identity.taskId)).toMatchObject({
        chapters: [
          { nativeOutputSettlement: { surrendered: 0, completed: 1 } },
          {},
        ],
      })
    }
  )

  it("bounds multiple retained outputs while acceptance is uncertain and recovers an exact browser match", async () => {
    const uncertain = {
      ...output,
      jobId: "uncertain-job",
      outputId: "uncertain-output",
      blobUrl: "blob:later-output",
    }
    blobs.retain({
      ...uncertain,
      blob: new Blob([new Uint8Array(3)]),
      resourceLease: resources.reserve(3, "uncertain output"),
    })
    await nativeRepository.prepare({ ...uncertain, now: 5 })
    await nativeRepository.markAcceptanceUnknown({
      outputId: uncertain.outputId,
      now: 6,
    })
    search.mockImplementation(async (query) =>
      query.id === 42 ? [downloadItem("in_progress")] : []
    )
    await nativeCoordinator.reconcile()
    expect(
      await nativeRepository.getByOutputId(uncertain.outputId)
    ).toMatchObject({
      phase: "handoff_interrupted",
    })
    expect(blobs.getRetainedCount()).toBe(2)
    expect(blobs.getRetainedBytes()).toBe(6)
    expect(revokeObjectURL).not.toHaveBeenCalled()
    expect(() => resources.reserve(1, "later allocation")).toThrow(
      "resource cap"
    )

    search.mockImplementation(async (query) =>
      query.id === 42
        ? [downloadItem("in_progress")]
        : [{ ...downloadItem("complete"), id: 43, url: uncertain.blobUrl }]
    )
    await nativeCoordinator.reconcile()
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith(uncertain.blobUrl)
    expect(resources.getUsedBytes()).toBe(3)
    expect(
      await nativeRepository.getByOutputId(uncertain.outputId)
    ).toMatchObject({
      phase: "complete",
      downloadId: 43,
      accountingDisposition: "pending",
      blobReleasedAt: expect.any(Number),
    })
  })

  it("replays lost Blob-release persistence without releasing the allocation twice", async () => {
    const persist = chrome.storage.local.set
    await nativeRepository.markTerminal({
      downloadId: 42,
      phase: "complete",
      now: 5,
    })
    vi.mocked(persist).mockImplementationOnce(async () => {
      throw new Error("release receipt unavailable")
    })
    await nativeCoordinator.reconcile()
    expect(resources.getUsedBytes()).toBe(0)
    await nativeCoordinator.reconcile()
    expect(revokeObjectURL).toHaveBeenCalledOnce()
    expect(await nativeRepository.getByOutputId(output.outputId)).toMatchObject(
      {
        blobReleasedAt: expect.any(Number),
        accountingDisposition: "pending",
      }
    )
  })

  it("keeps a later chapter runnable when acknowledged browser history disappears", async () => {
    await terminalCoordinator.handle(terminalPayload())
    search.mockResolvedValue([])
    await nativeCoordinator.reconcile()
    await nativeCoordinator.handleDownloadErased(42)
    expect(await queueRepository.getTask(identity.taskId)).toMatchObject({
      status: "downloading",
      chapters: [{ status: "completed" }, { status: "queued" }],
    })
    expect(
      (await queueRepository.getTask(identity.taskId))?.activeBlock
    ).toBeUndefined()
    expect(resources.getUsedBytes()).toBe(0)
    expect(taskGateAcquired).toHaveBeenCalledOnce()
  })

  it("continues after a terminal native completion without holding the task gate", async () => {
    await nativeRepository.markTerminal({
      downloadId: 42,
      phase: "complete",
      now: 5,
    })
    const handlers = createBackgroundOffscreenEventMessageHandlers({
      queueRepository,
      nativeOutputCoordinator: nativeCoordinator,
      terminalCoordinator,
    } as never)

    const handling = Promise.resolve(
      handlers.OFFSCREEN_JOB_TERMINAL(
        {
          target: "background",
          type: "OFFSCREEN_JOB_TERMINAL",
          payload: terminalPayload(),
        },
        { documentId: undefined }
      )
    )
    const outcome = await Promise.race([
      handling.then(() => "completed" as const),
      new Promise<"timed-out">((resolve) =>
        setTimeout(() => resolve("timed-out"), 100)
      ),
    ])

    expect(outcome).toBe("completed")
    await expect(queueRepository.getActiveDispatchLease()).resolves.toBeNull()
    expect(taskGateAcquired).toHaveBeenCalledOnce()
    await expect(
      queueRepository.getTask(identity.taskId)
    ).resolves.toMatchObject({
      chapters: [
        { id: identity.chapterId, status: "completed" },
        { id: "chapter-2", status: "queued" },
      ],
    })
  })

  it("continues at acknowledgement before a later browser completion", async () => {
    const handlers = createBackgroundOffscreenEventMessageHandlers({
      queueRepository,
      nativeOutputCoordinator: nativeCoordinator,
      terminalCoordinator,
    } as never)

    await handlers.OFFSCREEN_JOB_TERMINAL(
      {
        target: "background",
        type: "OFFSCREEN_JOB_TERMINAL",
        payload: terminalPayload(),
      },
      { documentId: undefined }
    )

    await expect(queueRepository.getActiveDispatchLease()).resolves.toBeNull()
    expect(taskGateAcquired).toHaveBeenCalledOnce()

    search.mockResolvedValue([downloadItem("complete")])
    const result = await nativeCoordinator.handleDownloadChanged({
      id: 42,
      state: { current: "complete" },
    })
    expect(result.effects).toEqual([])
    await terminalCoordinator.continueAfterNativeOutputSettlement(
      result.effects
    )
    expect(taskGateAcquired).toHaveBeenCalledOnce()
  })

  it("keeps acknowledged settlement replayable until continuation succeeds", async () => {
    await terminalCoordinator.settle(terminalPayload())
    const effects = await nativeCoordinator.reconcile()

    const failingContinuation = new OffscreenJobTerminalCoordinator(
      queueRepository,
      nativeCoordinator,
      {
        resumeTask: vi.fn(async () => {
          throw new Error("queue continuation unavailable")
        }),
        requestContinuation: vi.fn(),
      } as unknown as QueueScheduler,
      {} as never,
      {} as never
    )
    await expect(
      failingContinuation.continueAfterNativeOutputSettlement(effects)
    ).rejects.toThrow("queue continuation unavailable")
    await expect(
      nativeRepository.getManifest(identity.jobId)
    ).resolves.toBeDefined()

    await terminalCoordinator.continueAfterNativeOutputSettlement(effects)
    await expect(
      nativeRepository.getManifest(identity.jobId)
    ).resolves.toMatchObject({ settlementAcknowledgedAt: expect.any(Number) })
  })

  it.each([
    ["remove", false],
    ["remove", true],
    ["clear-history", false],
    ["clear-history", true],
    ["restart-and-clear", false],
    ["restart-and-clear", true],
    ["same-id-replacement", false],
    ["same-id-replacement", true],
  ] as const)(
    "retires released output after %s (cold replay: %s)",
    async (removal, coldReplay) => {
      await terminalCoordinator.settle(terminalPayload())
      search.mockResolvedValue([downloadItem("complete")])
      const { effects } = await nativeCoordinator.handleDownloadChanged({
        id: 42,
        state: { current: "complete" },
      })
      expect(effects).toHaveLength(1)
      expect(
        Object.keys((await nativeRepository.snapshot()).outputsByOutputId)
      ).toHaveLength(0)
      expect(
        (
          await queueRepository.cancelDownloadTask({
            taskId: identity.taskId,
            commandId: "cancel-for-history",
            now: 7,
          })
        ).outcome
      ).toBe("applied")
      if (removal === "restart-and-clear") {
        expect(
          (
            await queueRepository.restartDownloadTask({
              taskId: identity.taskId,
              restartTaskId: "next-task",
              now: 8,
            })
          ).outcome
        ).toBe("applied")
      } else if (removal !== "same-id-replacement") {
        await queueRepository.enqueueDownloadTask({
          ...task(),
          id: "next-task",
          status: "queued",
          chapters: [{ ...task().chapters[1]!, status: "queued" }],
        })
      }
      if (removal === "remove") {
        expect(
          (
            await queueRepository.removeTerminalDownloadTask({
              taskId: identity.taskId,
              undoToken: "remove-output-owner",
              now: 9,
            })
          ).outcome
        ).toBe("applied")
      } else {
        expect((await queueRepository.clearTerminalHistory()).outcome).toBe(
          "applied"
        )
      }
      expect(await queueRepository.getTask(identity.taskId)).toBeUndefined()
      if (removal === "remove") {
        await queueRepository.finalizePendingUndoAction("remove-output-owner")
      }
      expect(
        await new HistoryRepository().isChapterDownloaded(
          "mangadex",
          "series-1",
          identity.chapterId
        )
      ).toBe(true)
      const nextTaskId =
        removal === "same-id-replacement" ? identity.taskId : "next-task"
      if (removal === "same-id-replacement") {
        await queueRepository.enqueueDownloadTask({
          ...task(),
          status: "queued",
          chapters: [{ ...task().chapters[1]!, status: "queued" }],
        })
      }

      const replayQueue = coldReplay
        ? new QueueRepository(
            new QueueProjectionService(),
            new HistoryRepository()
          )
        : queueRepository
      const replayRepository = coldReplay
        ? new NativeOutputRepository()
        : nativeRepository
      const replayNative = coldReplay
        ? new NativeOutputCoordinator({
            settingsRepository: { getSettings: async () => DEFAULT_SETTINGS },
            repository: replayRepository,
            queueRepository: replayQueue,
            queryOffscreenJob: async () => null,
            requestBlobRevocation: async () => undefined,
            ensureLivenessAlarm: async () => undefined,
          })
        : nativeCoordinator
      const replayTerminal = new OffscreenJobTerminalCoordinator(
        replayQueue,
        replayNative,
        new QueueScheduler(replayQueue, taskExecutor, async () => undefined),
        {} as never,
        {} as never
      )
      const continuation = coldReplay ? await replayNative.reconcile() : effects
      expect(continuation).toEqual(effects)
      await replayTerminal.continueAfterNativeOutputSettlement(continuation)

      expect(await replayRepository.getManifest(identity.jobId)).toBeUndefined()
      expect(await replayNative.hasLiveDependencies()).toBe(false)
      expect(await replayNative.getLiveTaskIds()).toEqual([])
      await vi.waitFor(() =>
        expect(taskExecutor.execute).toHaveBeenCalledWith(nextTaskId)
      )
      expect(taskExecutor.execute).not.toHaveBeenCalledWith(nextTaskId, true)
      expect(await replayNative.reconcile()).toEqual([])
    }
  )

  it("does not resume a replacement inserted after the settlement owner was inspected", async () => {
    await terminalCoordinator.settle(terminalPayload())
    search.mockResolvedValue([downloadItem("complete")])
    const { effects } = await nativeCoordinator.handleDownloadChanged({
      id: 42,
      state: { current: "complete" },
    })
    await queueRepository.cancelDownloadTask({
      taskId: identity.taskId,
      commandId: "cancel-old-owner",
      now: 7,
    })
    const readTask = queueRepository.getTask.bind(queueRepository)
    let ownerRead!: () => void
    const inspected = new Promise<void>((resolve) => {
      ownerRead = resolve
    })
    let releaseOwner!: () => void
    const replacementReady = new Promise<void>((resolve) => {
      releaseOwner = resolve
    })
    vi.spyOn(queueRepository, "getTask").mockImplementationOnce(async (id) => {
      const oldOwner = await readTask(id)
      ownerRead()
      await replacementReady
      return oldOwner
    })
    const continuing =
      terminalCoordinator.continueAfterNativeOutputSettlement(effects)
    await inspected
    await queueRepository.removeTerminalDownloadTask({
      taskId: identity.taskId,
      undoToken: "replace-after-read",
      now: 8,
    })
    await queueRepository.enqueueDownloadTask({
      ...task(),
      status: "queued",
      chapters: [{ ...task().chapters[1]!, status: "queued" }],
    })
    await queueRepository.startDownloadTask({ taskId: identity.taskId, now: 9 })
    releaseOwner()
    await continuing
    expect(taskExecutor.execute).not.toHaveBeenCalledWith(identity.taskId, true)
    expect(await nativeRepository.getManifest(identity.jobId)).toBeUndefined()
  })

  it("finishes concurrent cancellation after acknowledgement prepares the next dispatch", async () => {
    await terminalCoordinator.settle(terminalPayload())
    let prepared!: () => void
    const preparedPromise = new Promise<void>((resolve) => {
      prepared = resolve
    })
    let releasePreparation!: () => void
    const preparation = new Promise<void>((resolve) => {
      releasePreparation = resolve
    })
    vi.mocked(taskExecutor.execute).mockImplementation(async (taskId) => {
      // The dispatcher checks task state before asynchronous destination,
      // provider-context and fingerprint preparation, then acquires this gate.
      if ((await queueRepository.getTask(taskId))?.status !== "downloading")
        return "wait"
      prepared()
      await preparation
      await runTaskSideEffectExclusive(taskId, async () => {
        expect((await queueRepository.getTask(taskId))?.status).toBe("canceled")
      })
      return "wait"
    })
    let cancellationReachedNative!: () => void
    const cancellationReachedNativePromise = new Promise<void>((resolve) => {
      cancellationReachedNative = resolve
    })
    const nativeCancel = nativeCoordinator.cancelTask.bind(nativeCoordinator)
    vi.spyOn(nativeCoordinator, "cancelTask").mockImplementation(
      async (...args) => {
        cancellationReachedNative()
        await nativeCancel(...args)
      }
    )
    const cancellation = new DownloadTaskCancellationCoordinator(
      queueRepository,
      nativeCoordinator,
      {} as never
    )
    search.mockResolvedValue([downloadItem("complete")])
    const completion = (async () => {
      const effects = await nativeCoordinator.reconcile()
      await terminalCoordinator.continueAfterNativeOutputSettlement(effects)
    })()
    await preparedPromise
    const canceling = cancellation.cancelTask(
      identity.taskId,
      "cancel-during-native-completion"
    )
    await cancellationReachedNativePromise
    releasePreparation()
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      const result = await Promise.race([
        Promise.all([completion, canceling]).then(() => "completed"),
        new Promise<string>((resolve) => {
          timeout = setTimeout(() => resolve("timed-out"), 1_000)
        }),
      ])
      expect(result).toBe("completed")
      await expect(
        queueRepository.getTask(identity.taskId)
      ).resolves.toMatchObject({ status: "canceled" })
    } finally {
      clearTimeout(timeout)
    }
  })
})
