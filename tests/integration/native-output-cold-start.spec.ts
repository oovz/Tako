import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  NativeOutputCoordinator,
  type NativeOutputCoordinatorDependencies,
} from "@/entrypoints/background/native-output-coordinator"
import { initializeFromStorage } from "@/entrypoints/background/initialize-from-storage"
import { OffscreenJobTerminalCoordinator } from "@/entrypoints/background/offscreen-job-terminal-coordinator"
import type { QueueScheduler } from "@/entrypoints/background/queue-scheduler"
import { createDispatchLease } from "@/src/runtime/dispatch-lease"
import type { OffscreenJobState } from "@/src/runtime/offscreen-job-contracts"
import { InvalidDurableStateError } from "@/src/runtime/runtime-phase-errors"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { LOCAL_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import { NativeOutputRepository } from "@/src/storage/native-output-repository"
import { QueueProjectionService } from "@/src/storage/queue-projection-service"
import { QueueRepository } from "@/src/storage/queue-repository"
import { SettingsRepository } from "@/src/storage/settings-repository"
import type { DownloadTaskState } from "@/src/domain/queue/state"

const jobIdentity = {
  jobId: "job-1",
  attempt: 1,
  taskId: "task-1",
  chapterId: "chapter-1",
  fingerprint: "a".repeat(64),
  documentInstanceId: "document-instance-1",
}

const output = {
  ...jobIdentity,
  outputId: "output-1",
  outputIndex: 0,
  outputCount: 1,
  fileUrl: "blob:output-1",
  filename: "Series/Chapter 1.cbz",
  outputKind: "archive" as const,
}

function activeTask(): DownloadTaskState {
  return {
    id: output.taskId,
    siteIntegrationId: "mangadex",
    mangaId: "series-1",
    seriesTitle: "Series",
    chapters: [
      {
        id: output.chapterId,
        url: "https://mangadex.org/chapter/chapter-1",
        title: "Chapter 1",
        index: 0,
        status: "downloading",
        dispatchAttempt: output.attempt,
        lastUpdated: 1,
      },
    ],
    status: "downloading",
    created: 1,
    started: 2,
    settingsSnapshot: createTaskSettingsSnapshot(DEFAULT_SETTINGS, "mangadex"),
  }
}

function completeDownloadItem(): chrome.downloads.DownloadItem {
  return {
    id: 42,
    url: output.fileUrl,
    finalUrl: output.fileUrl,
    filename: output.filename,
    incognito: false,
    danger: "safe",
    mime: "application/vnd.comicbook+zip",
    startTime: new Date(10).toISOString(),
    endTime: new Date(20).toISOString(),
    estimatedEndTime: new Date(20).toISOString(),
    state: "complete",
    paused: false,
    canResume: false,
    referrer: "",
    error: undefined,
    bytesReceived: 1,
    totalBytes: 1,
    fileSize: 1,
    exists: true,
    byExtensionId: "extension-id",
    byExtensionName: "Tako",
  }
}

describe("native output cold-start recovery", () => {
  let local: Record<string, unknown>
  let download: ReturnType<typeof vi.fn>
  let search: ReturnType<typeof vi.fn>
  let revoke: ReturnType<typeof vi.fn>
  let settingsRepository: SettingsRepository
  const destinationService = {} as never

  beforeEach(() => {
    local = {
      [LOCAL_STORAGE_KEYS.downloadQueue]: [activeTask()],
      [LOCAL_STORAGE_KEYS.activeDispatchLease]: {
        ...createDispatchLease({
          ...jobIdentity,
          saveMode: "downloads-api",
          now: 100,
        }),
        documentInstanceId: jobIdentity.documentInstanceId,
      },
      [LOCAL_STORAGE_KEYS.pendingUndoActions]: [],
    }
    download = vi.fn(async () => 42)
    search = vi.fn(async () => [] as chrome.downloads.DownloadItem[])
    revoke = vi.fn(async () => undefined)
    settingsRepository = new SettingsRepository("warn")
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
          remove: vi.fn(async (key: string) => {
            delete local[key]
          }),
        },
        session: { set: vi.fn(async () => undefined) },
      },
      action: {
        setBadgeText: vi.fn(async () => undefined),
        setBadgeBackgroundColor: vi.fn(async () => undefined),
      },
      downloads: { download, search },
    } as unknown as typeof chrome)
    vi.spyOn(settingsRepository, "getSettings").mockResolvedValue({
      downloads: { suppressSaveAsDialog: true },
    } as Awaited<ReturnType<typeof settingsRepository.getSettings>>)
  })

  function createRuntime(
    queryOffscreenJob: NativeOutputCoordinatorDependencies["queryOffscreenJob"] = async (
      identity
    ) => ({
      ...identity,
      status: "active",
      stage: "saving",
      lastSequence: 1,
    })
  ) {
    const queueRepository = new QueueRepository(new QueueProjectionService())
    const repository = new NativeOutputRepository()
    const coordinator = new NativeOutputCoordinator({
      settingsRepository,
      repository,
      queueRepository,
      queryOffscreenJob,
      requestBlobRevocation:
        revoke as NativeOutputCoordinatorDependencies["requestBlobRevocation"],
      ensureLivenessAlarm: vi.fn(async () => undefined),
      onQueueSettlement: vi.fn(async () => undefined),
      activateQueue: vi.fn(async () => undefined),
    })
    return { queueRepository, repository, coordinator }
  }

  function finalizationDependencies() {
    return {
      settingsRepository,
      historyRepository: {} as never,
    }
  }

  it("seals an exact canceled manifest after the coordinator dies at a failed seal write", async () => {
    const identity = jobIdentity
    const first = createRuntime()
    await first.queueRepository.initialize()
    await first.coordinator.initialize()
    await seedOpenManifest(first, 0, [])
    await expect(
      first.queueRepository.cancelDownloadTask({
        taskId: output.taskId,
        undoToken: "unused-active-cancel-token",
        now: 250,
      })
    ).resolves.toMatchObject({ outcome: "applied", undo: null })
    vi.spyOn(first.repository, "sealManifest").mockRejectedValueOnce(
      new Error("native storage unavailable")
    )

    await expect(
      first.coordinator.cancelTask(output.taskId, identity)
    ).rejects.toThrow("native storage unavailable")
    await expect(
      first.repository.getManifest(output.jobId)
    ).resolves.toMatchObject({ phase: "open" })

    const queryExactJob = vi.fn(async (queriedIdentity) => ({
      ...queriedIdentity,
      status: "canceled" as const,
      stage: "saving" as const,
      lastSequence: 2,
    }))
    const restarted = createRuntime(queryExactJob)
    await restarted.queueRepository.initialize()
    await restarted.coordinator.initialize()

    expect(queryExactJob).toHaveBeenCalledWith(identity)
    // The canceled task's output is fully released and pruned; the queue
    // keeps the terminal accounting.
    await expect(
      restarted.repository.getManifest(output.jobId)
    ).resolves.toBeUndefined()
    await expect(restarted.repository.hasLiveDependencies()).resolves.toBe(
      false
    )
  })

  async function seedOpenManifest(
    runtime: ReturnType<typeof createRuntime>,
    outputsRequested: number,
    trackedOutputIndexes: readonly number[]
  ): Promise<void> {
    await expect(
      runtime.repository.ensureManifest({
        ...jobIdentity,
        outputsRequested,
        now: 200,
      })
    ).resolves.toMatchObject({ outcome: "applied" })

    for (const outputIndex of trackedOutputIndexes) {
      await expect(
        runtime.repository.prepare({
          ...jobIdentity,
          outputId: `output-${outputIndex}`,
          outputIndex,
          outputCount: outputsRequested,
          blobUrl: `blob:output-${outputIndex}`,
          filename: `Series/Chapter 1-${outputIndex}.cbz`,
          outputKind: "archive",
          now: 201 + outputIndex,
        })
      ).resolves.toMatchObject({ outcome: "applied" })
    }
  }

  function exactJobState(
    status: "active" | "terminal" | "canceled",
    outputsRequested = 0
  ): OffscreenJobState {
    return {
      ...jobIdentity,
      status,
      stage: "saving",
      lastSequence: 5,
      ...(status === "terminal"
        ? {
            outcome: {
              status: "failed" as const,
              outputsRequested,
              outputsFailedBeforeHandoff: 0,
              outputsCommitted: 0,
            },
          }
        : {}),
    }
  }

  async function runStartup(
    runtime: ReturnType<typeof createRuntime>,
    observation: OffscreenJobState | null
  ) {
    const setLivenessAlarmArmed = vi.fn(async () => undefined)
    const terminalCoordinator = new OffscreenJobTerminalCoordinator(
      runtime.queueRepository,
      runtime.coordinator,
      {} as QueueScheduler,
      destinationService,
      finalizationDependencies()
    )
    const result = await initializeFromStorage({
      queueRepository: runtime.queueRepository,
      nativeOutputCoordinator: runtime.coordinator,
      terminalCoordinator,
      settingsRepository,
      writeSession: vi.fn(async () => undefined),
      getOffscreenActiveTaskIds: vi.fn(async () => []),
      hasOffscreenDocument: vi.fn(async () => observation !== null),
      terminateOffscreenDocumentForUnboundLease: vi.fn(async () => undefined),
      getOffscreenJobState: vi.fn(async () => observation),
      setLivenessAlarmArmed,
    })
    return { result, setLivenessAlarmArmed }
  }

  it("adopts a lost Chrome ID after restart without issuing a second download", async () => {
    const first = createRuntime()
    await first.queueRepository.initialize()
    await first.coordinator.initialize()
    vi.spyOn(first.repository, "attachDownload").mockRejectedValueOnce(
      new Error("worker stopped before ID persistence")
    )

    await expect(
      first.coordinator.handleOutputReady(output)
    ).resolves.toMatchObject({
      success: true,
      disposition: "tracked",
      phase: "acceptance_unknown",
    })
    await first.coordinator.sealManifest({
      ...jobIdentity,
      outputsRequested: 1,
      outputsFailedBeforeHandoff: 0,
    })
    await first.queueRepository.clearDispatchLease(output)
    expect(download).toHaveBeenCalledOnce()

    search.mockResolvedValue([completeDownloadItem()])
    const restarted = createRuntime()
    await restarted.queueRepository.initialize()
    await restarted.coordinator.initialize()

    expect(download).toHaveBeenCalledOnce()
    await expect(
      restarted.queueRepository.getTask(output.taskId)
    ).resolves.toMatchObject({
      status: "completed",
      lastSuccessfulDownloadId: 42,
      chapters: [
        {
          id: output.chapterId,
          status: "completed",
          outputs: { requested: 1, committed: 1, failed: 0 },
          nativeOutputSettlement: {
            jobId: output.jobId,
            attempt: output.attempt,
            requested: 1,
            completed: 1,
            interrupted: 0,
          },
        },
      ],
    })
    await expect(
      restarted.repository.getByOutputId(output.outputId)
    ).resolves.toBeUndefined()
    await expect(restarted.repository.hasLiveDependencies()).resolves.toBe(
      false
    )
    expect(revoke).toHaveBeenCalledOnce()
  })

  it("fails strict cold-start hydration before touching Chrome for invalid current state", async () => {
    local["pendingOutputs:index"] = {
      jobIds: [],
      outputIds: ["orphan"],
      downloadIdToOutputId: {},
    }
    local["pendingOutputs:output:orphan"] = { outputId: "orphan" }
    const runtime = createRuntime()
    await runtime.queueRepository.initialize()

    await expect(runtime.coordinator.initialize()).rejects.toBeInstanceOf(
      InvalidDurableStateError
    )
    expect(download).not.toHaveBeenCalled()
    expect(search).not.toHaveBeenCalled()
  })

  it("seals an exact terminal producer before clearing its lease and reconciling manifest totals", async () => {
    const runtime = createRuntime()
    await runtime.queueRepository.initialize()
    await runtime.coordinator.initialize()

    await runtime.repository.ensureManifest({
      ...jobIdentity,
      outputsRequested: 1,
      now: 1,
    })
    await runtime.repository.prepare({
      ...jobIdentity,
      outputId: output.outputId,
      outputIndex: output.outputIndex,
      outputCount: output.outputCount,
      blobUrl: output.fileUrl,
      filename: output.filename,
      outputKind: output.outputKind,
      now: 2,
    })

    const exactTerminalJob: OffscreenJobState = {
      ...jobIdentity,
      status: "terminal",
      stage: "saving",
      lastSequence: 4,
      // The durable manifest and terminal producer agree on the exact output
      // count before startup settlement.
      outcome: {
        status: "failed",
        outputsRequested: 1,
        outputsFailedBeforeHandoff: 0,
        outputsCommitted: 0,
      },
    }

    const startup = await initializeFromStorage({
      queueRepository: runtime.queueRepository,
      nativeOutputCoordinator: runtime.coordinator,
      terminalCoordinator: new OffscreenJobTerminalCoordinator(
        runtime.queueRepository,
        runtime.coordinator,
        {} as QueueScheduler,
        destinationService,
        finalizationDependencies()
      ),
      settingsRepository,
      writeSession: async () => undefined,
      getOffscreenActiveTaskIds: async () => [],
      hasOffscreenDocument: async () => true,
      terminateOffscreenDocumentForUnboundLease: async () => undefined,
      getOffscreenJobState: async () => exactTerminalJob,
      setLivenessAlarmArmed: async () => undefined,
    })

    expect(startup.queueActivation).toBeUndefined()
    await expect(
      runtime.queueRepository.getActiveDispatchLease()
    ).resolves.toBe(null)
    await expect(
      runtime.queueRepository.getTask(output.taskId)
    ).resolves.toMatchObject({
      status: "failed",
      chapters: [
        {
          id: output.chapterId,
          status: "failed",
          outputs: { requested: 1, committed: 0, failed: 1 },
          nativeOutputSettlement: {
            jobId: output.jobId,
            attempt: output.attempt,
            requested: 1,
            completed: 0,
            interrupted: 1,
          },
        },
      ],
    })
    // The interrupted output is fully released and pruned; the queue keeps
    // the terminal accounting.
    await expect(
      runtime.repository.getManifest(output.jobId)
    ).resolves.toBeUndefined()
    await expect(
      runtime.repository.getByOutputId(output.outputId)
    ).resolves.toBeUndefined()
    await expect(runtime.repository.hasLiveDependencies()).resolves.toBe(false)
    expect(download).not.toHaveBeenCalled()
    expect(search).not.toHaveBeenCalled()
    expect(revoke).toHaveBeenCalledOnce()
  })

  it.each(["terminal", "canceled"] as const)(
    "reuses an exact durable seal for a %s producer after worker death so the next startup clears the lease",
    async (status) => {
      const observedLease = jobIdentity
      const stoppedJob = exactJobState(status)
      const first = createRuntime()
      await first.queueRepository.initialize()
      await first.coordinator.initialize()
      await seedOpenManifest(first, 1, [0])

      await expect(
        first.coordinator.reconcileStartupOpenManifests({
          offscreenJob: stoppedJob,
          activeLease: observedLease,
        })
      ).resolves.toEqual({ observedJobSealed: true })
      const firstManifest = await first.repository.getManifest(output.jobId)
      expect(firstManifest).toMatchObject({ phase: "sealed" })
      expect(firstManifest).not.toHaveProperty("dependencyReleasedAt")
      await expect(
        first.queueRepository.getActiveDispatchLease()
      ).resolves.toMatchObject(observedLease)

      const restarted = createRuntime()
      await restarted.queueRepository.initialize()
      await restarted.coordinator.initialize()
      const sealedEvidence =
        await restarted.coordinator.reconcileStartupOpenManifests({
          offscreenJob: stoppedJob,
          activeLease: observedLease,
        })
      expect(sealedEvidence).toEqual({ observedJobSealed: true })

      const recovery = await restarted.queueRepository.recoverQueueAfterStartup(
        {
          normalizationTime: 300,
          interruptedAt: 300,
          observedLease,
          offscreenJob: sealedEvidence.observedJobSealed ? null : stoppedJob,
          nativeOutputTaskIds: await restarted.coordinator.getLiveTaskIds(),
        }
      )
      expect(recovery).toMatchObject({
        outcome: "applied",
        leaseCleared: true,
      })
      await restarted.coordinator.reconcile()

      await expect(
        restarted.queueRepository.getActiveDispatchLease()
      ).resolves.toBeNull()
      await expect(
        restarted.queueRepository.getTask(output.taskId)
      ).resolves.toMatchObject({
        status: "failed",
        chapters: [
          {
            id: output.chapterId,
            outputs: { requested: 1, committed: 0, failed: 1 },
            nativeOutputSettlement: {
              jobId: output.jobId,
              attempt: output.attempt,
              requested: 1,
              completed: 0,
              interrupted: 1,
            },
          },
        ],
      })
    }
  )

  it("recovers a prepared slot after death immediately following the durable manifest seal", async () => {
    const first = createRuntime()
    await first.queueRepository.initialize()
    await first.coordinator.initialize()
    await seedOpenManifest(first, 1, [0])
    await first.repository.sealManifest({
      ...jobIdentity,
      outputsRequested: 1,
      outputsFailedBeforeHandoff: 0,
      now: 250,
      error: "producer sealed before worker death",
    })
    await expect(
      first.repository.getByOutputId("output-0")
    ).resolves.toMatchObject({ phase: "prepared" })

    const restarted = createRuntime()
    await restarted.queueRepository.initialize()
    await restarted.coordinator.initialize()
    await expect(
      restarted.repository.getByOutputId("output-0")
    ).resolves.toMatchObject({
      phase: "interrupted",
      accountingDisposition: "pending",
      blobReleasedAt: expect.any(Number),
    })
    const startup = await runStartup(restarted, exactJobState("terminal", 1))

    await expect(
      restarted.queueRepository.getActiveDispatchLease()
    ).resolves.toBeNull()
    await expect(
      restarted.queueRepository.getTask(output.taskId)
    ).resolves.toMatchObject({
      status: "failed",
      chapters: [
        {
          id: output.chapterId,
          nativeOutputSettlement: {
            requested: 1,
            completed: 0,
            interrupted: 1,
          },
        },
      ],
    })
    // The output was interrupted, accounted, and fully released (pruned).
    await expect(
      restarted.repository.getByOutputId("output-0")
    ).resolves.toBeUndefined()
    await expect(restarted.repository.hasLiveDependencies()).resolves.toBe(
      false
    )
    expect(startup.result.queueActivation).toBeUndefined()
    expect(revoke).toHaveBeenCalledOnce()
  })

  it("retains exact lease ownership when an active producer conflicts with an already sealed manifest", async () => {
    const observedLease = jobIdentity
    const runtime = createRuntime()
    await runtime.queueRepository.initialize()
    await runtime.coordinator.initialize()
    await seedOpenManifest(runtime, 1, [0])
    await runtime.coordinator.reconcileStartupOpenManifests({
      offscreenJob: exactJobState("terminal"),
      activeLease: observedLease,
    })

    await expect(
      runtime.coordinator.reconcileStartupOpenManifests({
        offscreenJob: exactJobState("active"),
        activeLease: observedLease,
      })
    ).resolves.toEqual({ observedJobSealed: false })
    await expect(
      runtime.queueRepository.getActiveDispatchLease()
    ).resolves.toMatchObject(observedLease)
    const manifest = await runtime.repository.getManifest(output.jobId)
    expect(manifest).toMatchObject({ phase: "sealed" })
    expect(manifest).not.toHaveProperty("dependencyReleasedAt")
  })

  it.each([
    {
      name: "partially populated manifest for an exact canceled producer",
      outputsRequested: 3,
      trackedOutputIndexes: [1],
      observation: "canceled",
    },
    {
      name: "zero-output manifest for an authoritatively absent producer",
      outputsRequested: 0,
      trackedOutputIndexes: [],
      observation: "absent",
    },
  ] as const)(
    "seals and settles a $name after clearing its exact lease",
    async ({ outputsRequested, trackedOutputIndexes, observation }) => {
      const runtime = createRuntime()
      await runtime.queueRepository.initialize()
      await runtime.coordinator.initialize()
      await seedOpenManifest(runtime, outputsRequested, trackedOutputIndexes)

      const startup = await runStartup(
        runtime,
        observation === "absent" ? null : exactJobState(observation)
      )

      await expect(
        runtime.queueRepository.getActiveDispatchLease()
      ).resolves.toBeNull()
      await expect(
        runtime.queueRepository.getTask(output.taskId)
      ).resolves.toMatchObject({
        status: "failed",
        chapters: [
          {
            id: output.chapterId,
            status: "failed",
            outputs: {
              requested: outputsRequested,
              committed: 0,
              failed: outputsRequested,
            },
            nativeOutputSettlement: {
              jobId: output.jobId,
              attempt: output.attempt,
              requested: outputsRequested,
              completed: 0,
              interrupted: outputsRequested,
            },
          },
        ],
      })

      // Fully released state is pruned; the queue keeps the accounting.
      const nativeState = await runtime.repository.snapshot()
      expect(nativeState.manifestsByJobId[output.jobId]).toBeUndefined()
      for (const outputIndex of trackedOutputIndexes) {
        expect(
          nativeState.outputsByOutputId[`output-${outputIndex}`]
        ).toBeUndefined()
      }
      await expect(runtime.repository.hasLiveDependencies()).resolves.toBe(
        false
      )
      expect(revoke).toHaveBeenCalledTimes(trackedOutputIndexes.length)
      expect(download).not.toHaveBeenCalled()
      expect(search).not.toHaveBeenCalled()
      expect(startup.result.queueActivation).toBeUndefined()
      expect(startup.setLivenessAlarmArmed).toHaveBeenLastCalledWith(false)
    }
  )

  it("keeps an open manifest and exact lease for an active producer", async () => {
    const runtime = createRuntime()
    await runtime.queueRepository.initialize()
    await runtime.coordinator.initialize()
    await seedOpenManifest(runtime, 1, [0])

    const startup = await runStartup(runtime, exactJobState("active"))

    await expect(
      runtime.queueRepository.getActiveDispatchLease()
    ).resolves.toMatchObject({
      jobId: output.jobId,
      attempt: output.attempt,
      taskId: output.taskId,
      chapterId: output.chapterId,
    })
    await expect(
      runtime.queueRepository.getTask(output.taskId)
    ).resolves.toMatchObject({ status: "downloading" })
    await expect(
      runtime.repository.getManifest(output.jobId)
    ).resolves.toMatchObject({
      phase: "open",
      slots: [{ disposition: "tracked", outputId: "output-0" }],
    })
    expect(startup.result.queueActivation).toEqual({
      kind: "resume-task",
      taskId: output.taskId,
    })
    expect(revoke).not.toHaveBeenCalled()
  })

  it("does not treat an offscreen query failure as producer absence", async () => {
    const runtime = createRuntime()
    await runtime.queueRepository.initialize()
    await runtime.coordinator.initialize()
    await seedOpenManifest(runtime, 1, [0])
    const setLivenessAlarmArmed = vi.fn(async () => undefined)

    await expect(
      initializeFromStorage({
        queueRepository: runtime.queueRepository,
        nativeOutputCoordinator: runtime.coordinator,
        terminalCoordinator: new OffscreenJobTerminalCoordinator(
          runtime.queueRepository,
          runtime.coordinator,
          {} as QueueScheduler,
          destinationService,
          finalizationDependencies()
        ),
        settingsRepository,
        writeSession: vi.fn(async () => undefined),
        getOffscreenActiveTaskIds: vi.fn(async () => []),
        hasOffscreenDocument: vi.fn(async () => true),
        terminateOffscreenDocumentForUnboundLease: vi.fn(async () => undefined),
        getOffscreenJobState: vi.fn(async () => {
          throw new Error("offscreen query transport failed")
        }),
        setLivenessAlarmArmed,
      })
    ).resolves.toMatchObject({ queue: [{ id: output.taskId }] })

    await expect(
      runtime.queueRepository.getActiveDispatchLease()
    ).resolves.toMatchObject({
      jobId: output.jobId,
      attempt: output.attempt,
      taskId: output.taskId,
      chapterId: output.chapterId,
    })
    await expect(
      runtime.repository.getManifest(output.jobId)
    ).resolves.toMatchObject({ phase: "open" })
    expect(setLivenessAlarmArmed).toHaveBeenCalledWith(true)
    expect(revoke).not.toHaveBeenCalled()
  })
})
