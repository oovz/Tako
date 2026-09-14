import { beforeEach, describe, expect, it, vi } from "vitest"

import { createBackgroundOffscreenEventMessageHandlers } from "@/entrypoints/background/background-offscreen-event-message-handlers"
import { DownloadTaskExecutor } from "@/entrypoints/background/download-task-executor"
import { DownloadTaskCancellationCoordinator } from "@/entrypoints/background/download-task-cancellation-coordinator"
import { OffscreenJobTerminalCoordinator } from "@/entrypoints/background/offscreen-job-terminal-coordinator"
import { NativeOutputCoordinator } from "@/entrypoints/background/native-output-coordinator"
import { QueueScheduler } from "@/entrypoints/background/queue-scheduler"
import { runTaskSideEffectExclusive } from "@/entrypoints/background/download-task-side-effect-gate"
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
              requested.map((key) => [key, structuredClone(local[key])])
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

    queueRepository = new QueueRepository(new QueueProjectionService())
    nativeRepository = new NativeOutputRepository()
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
      requestBlobRevocation: vi.fn(async () => undefined),
      ensureLivenessAlarm: vi.fn(async () => undefined),
    })
    terminalCoordinator = new OffscreenJobTerminalCoordinator(
      queueRepository,
      nativeCoordinator,
      queueScheduler,
      {} as never,
      {
        settingsRepository,
        historyRepository: {
          getDownloadedChapters: vi.fn(async () => []),
          restoreChapterFromCompletedTask: vi.fn(async () => true),
          markChapterAsDownloaded: vi.fn(async () => undefined),
        },
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
      surrendered: 0,
      now: 6,
    })

    expect(result).toMatchObject({
      outcome: "conflict",
      reason: "lease-conflict",
    })
    expect(activeLease).not.toBeNull()
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

  it("returns a native settlement effect after terminal-before-complete ordering", async () => {
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
    expect(taskGateAcquired).not.toHaveBeenCalled()

    search.mockResolvedValue([downloadItem("complete")])
    const result = await nativeCoordinator.handleDownloadChanged({
      id: 42,
      state: { current: "complete" },
    })
    expect(result.effects).toEqual([
      {
        jobId: identity.jobId,
        attempt: identity.attempt,
        taskId: identity.taskId,
        chapterId: identity.chapterId,
      },
    ])
    await terminalCoordinator.continueAfterNativeOutputSettlement(
      result.effects
    )
    expect(taskGateAcquired).toHaveBeenCalledOnce()
  })

  it("keeps the sealed manifest replayable until continuation succeeds", async () => {
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
    search.mockResolvedValue([downloadItem("complete")])
    const result = await nativeCoordinator.handleDownloadChanged({
      id: 42,
      state: { current: "complete" },
    })

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
      failingContinuation.continueAfterNativeOutputSettlement(result.effects)
    ).rejects.toThrow("queue continuation unavailable")
    await expect(
      nativeRepository.getManifest(identity.jobId)
    ).resolves.toBeDefined()

    await terminalCoordinator.continueAfterNativeOutputSettlement(
      result.effects
    )
    await expect(
      nativeRepository.getManifest(identity.jobId)
    ).resolves.toBeUndefined()
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
        ? new QueueRepository(new QueueProjectionService())
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
      expect(await replayNative.hasReconcilableLiveDependencies()).toBe(false)
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

  it("finishes concurrent cancellation after continuation prepares the next dispatch", async () => {
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
      const result = await nativeCoordinator.handleDownloadChanged({
        id: 42,
        state: { current: "complete" },
      })
      await terminalCoordinator.continueAfterNativeOutputSettlement(
        result.effects
      )
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
