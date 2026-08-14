import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  NativeOutputCoordinator,
  type NativeOutputCoordinatorDependencies,
} from "@/entrypoints/background/native-output-coordinator"
import { NativeOutputRepository } from "@/src/storage/native-output-repository"
import { SettingsRepository } from "@/src/storage/settings-repository"

const jobIdentity = {
  jobId: "job-1",
  attempt: 1,
  taskId: "task-1",
  chapterId: "chapter-1",
  fingerprint: "a".repeat(64),
  documentInstanceId: "document-instance-1",
}

const payload = {
  ...jobIdentity,
  outputId: "output-1",
  outputIndex: 0,
  outputCount: 1,
  fileUrl: "blob:output-1",
  filename: "Series/Chapter 1.cbz",
  outputKind: "archive" as const,
}

function downloadItem(
  overrides: Partial<chrome.downloads.DownloadItem> = {}
): chrome.downloads.DownloadItem {
  return {
    id: 42,
    url: payload.fileUrl,
    finalUrl: payload.fileUrl,
    filename: payload.filename,
    incognito: false,
    danger: "safe",
    mime: "application/vnd.comicbook+zip",
    startTime: new Date(1).toISOString(),
    endTime: new Date(2).toISOString(),
    estimatedEndTime: new Date(2).toISOString(),
    state: "in_progress",
    paused: false,
    canResume: false,
    referrer: "",
    error: undefined,
    bytesReceived: 0,
    totalBytes: 1,
    fileSize: 1,
    exists: true,
    byExtensionId: chrome.runtime?.id,
    byExtensionName: "Tako",
    ...overrides,
  }
}

describe("NativeOutputCoordinator", () => {
  let local: Record<string, unknown>
  let download: ReturnType<typeof vi.fn>
  let search: ReturnType<typeof vi.fn>
  let revoke: ReturnType<typeof vi.fn>
  let applySettlement: ReturnType<typeof vi.fn>
  let ensureLiveness: ReturnType<typeof vi.fn>
  let queryJob: NativeOutputCoordinatorDependencies["queryOffscreenJob"]
  let settingsRepository: SettingsRepository

  beforeEach(() => {
    local = {}
    download = vi.fn(async () => 42)
    search = vi.fn(async () => [])
    revoke = vi.fn(async () => undefined)
    applySettlement = vi.fn(async () => ({
      outcome: "applied" as const,
      task: {},
      chapter: {},
      settlement: {},
    }))
    ensureLiveness = vi.fn(async () => undefined)
    queryJob = vi.fn(async (identity) => ({
      ...identity,
      status: "active" as const,
      stage: "saving" as const,
      lastSequence: 1,
    }))
    settingsRepository = new SettingsRepository("warn")
    vi.stubGlobal("chrome", {
      runtime: { id: "extension-id" },
      storage: {
        local: {
          get: vi.fn(async () => structuredClone(local)),
          set: vi.fn(async (values: Record<string, unknown>) => {
            Object.assign(local, structuredClone(values))
          }),
          remove: vi.fn(async (keys: string | string[]) => {
            const removed = Array.isArray(keys) ? keys : [keys]
            for (const key of removed) delete local[key]
          }),
        },
      },
      downloads: { download, search },
    } as unknown as typeof chrome)
    vi.spyOn(settingsRepository, "getSettings").mockResolvedValue({
      downloads: { suppressSaveAsDialog: true },
    } as Awaited<ReturnType<typeof settingsRepository.getSettings>>)
  })

  function createCoordinator(repository = new NativeOutputRepository()) {
    const queueRepository = {
      getActiveDispatchLease: vi.fn(async () => ({
        ...jobIdentity,
      })),
      getTask: vi.fn(async () => ({
        status: "downloading",
        chapters: [{ id: jobIdentity.chapterId, status: "downloading" }],
        settingsSnapshot: { conflictPolicy: "uniquify" },
      })),
      applyNativeOutputSettlement: applySettlement,
      blockTaskForNativeOutputAction: vi.fn(async () => ({
        outcome: "applied",
      })),
      releaseNativeOutputActionBlock: vi.fn(async () => ({
        outcome: "applied",
      })),
      getQueue: vi.fn(async () => []),
    }
    const coordinator = new NativeOutputCoordinator({
      settingsRepository,
      repository,
      queueRepository: queueRepository as never,
      queryOffscreenJob: (identity) => queryJob(identity),
      requestBlobRevocation:
        revoke as NativeOutputCoordinatorDependencies["requestBlobRevocation"],
      ensureLivenessAlarm:
        ensureLiveness as NativeOutputCoordinatorDependencies["ensureLivenessAlarm"],
      onQueueSettlement: vi.fn(async () => undefined),
      activateQueue: vi.fn(async () => undefined),
    })
    return { coordinator, repository, queueRepository }
  }

  it("does not call Chrome when the durable acceptance marker fails", async () => {
    const { coordinator, repository } = createCoordinator()
    vi.spyOn(repository, "markAcceptanceUnknown").mockRejectedValueOnce(
      new Error("marker write failed")
    )

    await expect(coordinator.handleOutputReady(payload)).resolves.toEqual({
      success: true,
      disposition: "tracked",
      phase: "prepared",
    })
    expect(download).not.toHaveBeenCalled()
    expect((await repository.getByOutputId(payload.outputId))?.phase).toBe(
      "prepared"
    )
    expect(ensureLiveness).toHaveBeenCalled()
  })

  it.each([
    {
      authority: "job ID",
      mutate: () => ({ ...jobIdentity, jobId: "job-replaced" }),
    },
    {
      authority: "attempt",
      mutate: () => ({ ...jobIdentity, attempt: 2 }),
    },
    {
      authority: "task ID",
      mutate: () => ({ ...jobIdentity, taskId: "task-replaced" }),
    },
    {
      authority: "chapter ID",
      mutate: () => ({ ...jobIdentity, chapterId: "chapter-replaced" }),
    },
    {
      authority: "fingerprint",
      mutate: () => ({ ...jobIdentity, fingerprint: "b".repeat(64) }),
    },
    {
      authority: "document incarnation",
      mutate: () => ({
        ...jobIdentity,
        documentInstanceId: "document-instance-replaced",
      }),
    },
  ])(
    "rechecks $authority after settings preparation before calling Chrome",
    async ({ mutate }) => {
      let releaseSettings!: () => void
      let markSettingsStarted!: () => void
      const settingsBlocked = new Promise<void>((resolve) => {
        releaseSettings = resolve
      })
      const settingsStarted = new Promise<void>((resolve) => {
        markSettingsStarted = resolve
      })
      vi.mocked(settingsRepository.getSettings).mockImplementationOnce(
        async () => {
          markSettingsStarted()
          await settingsBlocked
          return {
            downloads: { suppressSaveAsDialog: true },
          } as Awaited<ReturnType<typeof settingsRepository.getSettings>>
        }
      )
      const { coordinator, queueRepository } = createCoordinator()

      const handling = coordinator.handleOutputReady(payload)
      await settingsStarted
      queueRepository.getActiveDispatchLease.mockResolvedValue(mutate())
      releaseSettings()

      await expect(handling).resolves.toMatchObject({
        success: true,
        disposition: "tracked",
      })
      expect(download).not.toHaveBeenCalled()
    }
  )

  it.each([
    {
      authority: "task status",
      task: {
        status: "failed",
        chapters: [{ id: jobIdentity.chapterId, status: "downloading" }],
        settingsSnapshot: { conflictPolicy: "uniquify" },
      },
    },
    {
      authority: "chapter status",
      task: {
        status: "downloading",
        chapters: [{ id: jobIdentity.chapterId, status: "failed" }],
        settingsSnapshot: { conflictPolicy: "uniquify" },
      },
    },
  ])(
    "rechecks $authority after settings preparation before calling Chrome",
    async ({ task }) => {
      let releaseSettings!: () => void
      let markSettingsStarted!: () => void
      const settingsBlocked = new Promise<void>((resolve) => {
        releaseSettings = resolve
      })
      const settingsStarted = new Promise<void>((resolve) => {
        markSettingsStarted = resolve
      })
      vi.mocked(settingsRepository.getSettings).mockImplementationOnce(
        async () => {
          markSettingsStarted()
          await settingsBlocked
          return {
            downloads: { suppressSaveAsDialog: true },
          } as Awaited<ReturnType<typeof settingsRepository.getSettings>>
        }
      )
      const { coordinator, queueRepository } = createCoordinator()

      const handling = coordinator.handleOutputReady(payload)
      await settingsStarted
      queueRepository.getTask.mockResolvedValue(task)
      releaseSettings()

      await expect(handling).resolves.toMatchObject({
        success: true,
        disposition: "tracked",
      })
      expect(download).not.toHaveBeenCalled()
    }
  )

  it("keeps Chrome rejection as a durably tracked interrupted output", async () => {
    download.mockRejectedValueOnce(new Error("blocked by policy"))
    const { coordinator, repository } = createCoordinator()

    await expect(coordinator.handleOutputReady(payload)).resolves.toMatchObject(
      {
        success: true,
        disposition: "tracked",
        phase: "interrupted",
        terminalOutcome: "interrupted",
      }
    )
    expect((await repository.getByOutputId(payload.outputId))?.phase).toBe(
      "interrupted"
    )
    expect(revoke).toHaveBeenCalledWith(
      expect.objectContaining({ outputId: payload.outputId })
    )
  })

  it.each(["throws", "rejects"] as const)(
    "arms liveness when Chrome rejects and the interruption write %s",
    async (failureMode) => {
      download.mockRejectedValueOnce(new Error("blocked by policy"))
      const { coordinator, repository } = createCoordinator()
      const interrupt = vi.spyOn(repository, "interruptBeforeAcceptance")
      if (failureMode === "throws") {
        interrupt.mockRejectedValueOnce(new Error("storage unavailable"))
      } else {
        interrupt.mockResolvedValueOnce({
          outcome: "rejected",
          reason: "invalid-transition",
        })
      }

      await expect(coordinator.handleOutputReady(payload)).resolves.toEqual({
        success: true,
        disposition: "tracked",
        phase: "acceptance_unknown",
      })
      expect((await repository.getByOutputId(payload.outputId))?.phase).toBe(
        "acceptance_unknown"
      )
      expect(ensureLiveness).toHaveBeenCalled()
      expect(revoke).not.toHaveBeenCalled()

      await coordinator.reconcile()

      const quarantined = await repository.getByOutputId(payload.outputId)
      expect(download).toHaveBeenCalledOnce()
      expect(applySettlement).not.toHaveBeenCalled()
      expect(revoke).not.toHaveBeenCalled()
      expect(quarantined).toMatchObject({
        phase: "acceptance_unknown",
        accountingDisposition: "pending",
      })
      expect(quarantined?.blobReleasedAt).toBeUndefined()
      expect(quarantined?.dependencyReleasedAt).toBeUndefined()
    }
  )

  it("recovers a returned ID after its persistence fails without redownloading", async () => {
    const first = createCoordinator()
    vi.spyOn(first.repository, "attachDownload").mockRejectedValueOnce(
      new Error("acceptance write failed")
    )

    await expect(
      first.coordinator.handleOutputReady(payload)
    ).resolves.toMatchObject({
      success: true,
      disposition: "tracked",
      phase: "acceptance_unknown",
    })
    expect(download).toHaveBeenCalledOnce()

    search.mockImplementation(async (query: chrome.downloads.DownloadQuery) =>
      "url" in query
        ? [downloadItem({ state: "complete" })]
        : [downloadItem({ state: "complete" })]
    )
    const restarted = createCoordinator(new NativeOutputRepository())
    await restarted.coordinator.initialize()

    expect(download).toHaveBeenCalledOnce()
    expect(
      (await restarted.repository.getByOutputId(payload.outputId))?.phase
    ).toBe("complete")
  })

  it("does not adopt ambiguous exact URL matches", async () => {
    const { coordinator, repository } = createCoordinator()
    vi.spyOn(repository, "attachDownload").mockRejectedValueOnce(
      new Error("acceptance write failed")
    )
    await coordinator.handleOutputReady(payload)
    search.mockResolvedValue([
      downloadItem({ id: 41 }),
      downloadItem({ id: 42 }),
    ])

    await coordinator.reconcile()

    expect((await repository.getByOutputId(payload.outputId))?.phase).toBe(
      "acceptance_unknown"
    )
    expect(ensureLiveness).toHaveBeenCalled()
    expect(download).toHaveBeenCalledOnce()
    expect(applySettlement).not.toHaveBeenCalled()
    expect(revoke).not.toHaveBeenCalled()
  })

  it("keeps a sealed acceptance-unknown record quarantined after exact producer terminality", async () => {
    download.mockRejectedValueOnce(new Error("blocked by policy"))
    const { coordinator, repository } = createCoordinator()
    vi.spyOn(repository, "interruptBeforeAcceptance").mockRejectedValueOnce(
      new Error("terminal marker unavailable")
    )
    await coordinator.handleOutputReady(payload)

    await coordinator.reconcileStartupOpenManifests({
      offscreenJob: {
        ...jobIdentity,
        status: "terminal",
        stage: "saving",
        lastSequence: 5,
        outcome: {
          status: "failed",
          outputsRequested: 0,
          outputsFailedBeforeHandoff: 0,
          outputsCommitted: 0,
        },
      },
      activeLease: null,
    })

    expect(await repository.getManifest(payload.jobId)).toMatchObject({
      phase: "sealed",
      outputsRequested: 1,
      outputsFailedBeforeHandoff: 0,
    })
    const quarantined = await repository.getByOutputId(payload.outputId)
    expect(quarantined).toMatchObject({
      phase: "acceptance_unknown",
      accountingDisposition: "pending",
    })
    expect(quarantined?.blobReleasedAt).toBeUndefined()
    expect(quarantined?.dependencyReleasedAt).toBeUndefined()
    expect(applySettlement).not.toHaveBeenCalled()
    expect(revoke).not.toHaveBeenCalled()
    expect(ensureLiveness).toHaveBeenCalled()
  })

  it("arms liveness and rethrows when exact canceled-manifest cleanup fails", async () => {
    const { coordinator, repository } = createCoordinator()
    await repository.ensureManifest({
      ...jobIdentity,
      outputsRequested: 0,
      now: 1,
    })
    vi.spyOn(repository, "sealManifest").mockRejectedValueOnce(
      new Error("native storage unavailable")
    )

    await expect(
      coordinator.cancelTask(payload.taskId, {
        ...jobIdentity,
      })
    ).rejects.toThrow("native storage unavailable")
    expect(ensureLiveness).toHaveBeenCalled()
  })

  it("retries an exact canceled manifest seal after coordinator restart", async () => {
    const first = createCoordinator()
    const { coordinator, repository } = first
    await repository.ensureManifest({
      ...jobIdentity,
      outputsRequested: 0,
      now: 1,
    })
    const seal = vi
      .spyOn(repository, "sealManifest")
      .mockRejectedValueOnce(new Error("native storage unavailable"))
    const identity = jobIdentity

    await expect(
      coordinator.cancelTask(payload.taskId, identity)
    ).rejects.toThrow("native storage unavailable")
    expect(await repository.getManifest(payload.jobId)).toMatchObject({
      phase: "open",
    })

    queryJob = vi.fn(async (queriedIdentity) => ({
      ...queriedIdentity,
      status: "canceled" as const,
      stage: "saving" as const,
      lastSequence: 2,
    }))
    const restarted = createCoordinator(new NativeOutputRepository())
    await restarted.coordinator.initialize()

    expect(seal).toHaveBeenCalledOnce()
    // The canceled job's output was released and pruned; the queue keeps the
    // terminal accounting.
    await expect(
      restarted.repository.getManifest(payload.jobId)
    ).resolves.toBeUndefined()
    await expect(restarted.repository.hasLiveDependencies()).resolves.toBe(
      false
    )
    expect(queryJob).toHaveBeenCalledWith(identity)
  })

  it("keeps an open manifest when its exact producer query fails", async () => {
    const { coordinator, repository } = createCoordinator()
    await repository.ensureManifest({
      ...jobIdentity,
      outputsRequested: 0,
      now: 1,
    })
    queryJob = vi.fn(async () => {
      throw new Error("offscreen query unavailable")
    })

    await coordinator.reconcile()

    expect(await repository.getManifest(payload.jobId)).toMatchObject({
      phase: "open",
    })
    expect(ensureLiveness).toHaveBeenCalled()
  })

  it("blocks the task when a tracked download is erased and forget surrenders it", async () => {
    const { coordinator, repository, queueRepository } = createCoordinator()
    await coordinator.handleOutputReady(payload)
    expect((await repository.getByOutputId(payload.outputId))?.phase).toBe(
      "waiting"
    )

    await coordinator.handleDownloadErased(42)

    expect(
      (await repository.getByOutputId(payload.outputId))?.erasedAt
    ).toEqual(expect.any(Number))
    expect(queueRepository.blockTaskForNativeOutputAction).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "task-1" })
    )
    // The durable block replaces liveness re-arming for the erased record.
    expect(ensureLiveness).not.toHaveBeenCalled()

    await coordinator.forgetTaskUnobservableOutputs("task-1")

    expect((await repository.getByOutputId(payload.outputId))?.phase).toBe(
      "surrendered"
    )
    expect(queueRepository.releaseNativeOutputActionBlock).toHaveBeenCalledWith(
      "task-1"
    )
    expect(revoke).toHaveBeenCalledWith(
      expect.objectContaining({ outputId: payload.outputId })
    )
  })

  it("converges a forget replay with zero surrendered when nothing is unobservable", async () => {
    const { coordinator } = createCoordinator()
    // The browser still knows the download, so the output stays observable.
    search.mockResolvedValue([downloadItem({ state: "in_progress" })])
    await coordinator.handleOutputReady(payload)

    await expect(
      coordinator.forgetTaskUnobservableOutputs("task-1")
    ).resolves.toEqual({ surrendered: 0 })
  })

  it("surrenders erased outputs when a task is canceled without a job identity", async () => {
    const { coordinator, repository } = createCoordinator()
    await coordinator.handleOutputReady(payload)
    await coordinator.handleDownloadErased(42)
    // The producer finished, so the manifest is sealed before cancellation.
    await coordinator.sealManifest({
      ...jobIdentity,
      outputsRequested: 1,
      outputsFailedBeforeHandoff: 0,
    })

    await coordinator.cancelTask("task-1")

    // Surrender does not claim complete or interrupted; the Blob is revoked,
    // the queue is settled with the surrendered count, and the released
    // record and manifest are pruned from durable storage.
    expect(revoke).toHaveBeenCalledWith(
      expect.objectContaining({ outputId: payload.outputId })
    )
    expect(applySettlement).toHaveBeenCalledWith(
      expect.objectContaining({ surrendered: 1 })
    )
    await expect(repository.hasLiveDependencies()).resolves.toBe(false)
    await expect(
      repository.getByOutputId(payload.outputId)
    ).resolves.toBeUndefined()
    await expect(repository.getManifest(payload.jobId)).resolves.toBeUndefined()
  })

  it("keeps user-pending erased work live for offscreen but excludes it from the alarm", async () => {
    const { coordinator, repository, queueRepository } = createCoordinator()
    await coordinator.handleOutputReady(payload)
    await coordinator.handleDownloadErased(42)

    vi.mocked(queueRepository.getQueue).mockResolvedValue([
      {
        id: "task-1",
        status: "queued",
        activeBlock: "native_output_action_required",
      },
    ] as never)

    // The offscreen document still owns the Blob URL: the dependency stays
    // live until terminal state, explicit surrender, or cancellation.
    expect(await coordinator.hasLiveDependencies()).toBe(true)
    expect(await repository.hasLiveDependencies()).toBe(true)
    // The crash-recovery alarm, however, must not re-arm forever for work
    // whose only next step is the user's forget/cancel decision.
    expect(await coordinator.hasReconcilableLiveDependencies()).toBe(false)
  })

  it("observes a terminal event queued while the ID is being attached", async () => {
    const { coordinator, repository } = createCoordinator()
    download.mockImplementation(async () => {
      void coordinator.handleDownloadChanged({
        id: 42,
        state: { current: "complete" },
      })
      return 42
    })

    await coordinator.handleOutputReady(payload)
    await coordinator.reconcile()

    expect((await repository.getByOutputId(payload.outputId))?.phase).toBe(
      "complete"
    )
  })

  it("settles an all-untracked manifest without a Chrome download ID", async () => {
    const { coordinator, repository } = createCoordinator()

    await coordinator.sealManifest({
      ...jobIdentity,
      outputsRequested: 2,
      outputsFailedBeforeHandoff: 2,
    })

    expect(download).not.toHaveBeenCalled()
    expect(applySettlement).toHaveBeenCalledWith(
      expect.objectContaining({ requested: 2, completed: 0, interrupted: 2 })
    )
    // The released job is pruned from durable storage.
    await expect(repository.getManifest(payload.jobId)).resolves.toBeUndefined()
    await expect(repository.hasLiveDependencies()).resolves.toBe(false)
  })

  it("does not revoke a prepared slot while its exact producer remains active", async () => {
    const { coordinator, repository } = createCoordinator()
    await repository.prepare({
      ...jobIdentity,
      outputId: payload.outputId,
      outputIndex: 0,
      outputCount: 1,
      blobUrl: payload.fileUrl,
      filename: payload.filename,
      outputKind: payload.outputKind,
      now: 1,
    })
    const identity = jobIdentity

    await coordinator.reconcileStartupOpenManifests({
      offscreenJob: {
        ...identity,
        status: "active",
        stage: "saving",
        lastSequence: 4,
      },
      activeLease: identity,
    })
    await coordinator.reconcile()

    expect(await repository.getManifest(payload.jobId)).toMatchObject({
      phase: "open",
    })
    const record = await repository.getByOutputId(payload.outputId)
    expect(record).toMatchObject({ phase: "prepared" })
    expect(record).not.toHaveProperty("blobReleasedAt")
    expect(revoke).not.toHaveBeenCalled()
    expect(applySettlement).not.toHaveBeenCalled()
  })

  it("terminalizes a prepared slot when the runner seals its manifest", async () => {
    const { coordinator, repository } = createCoordinator()
    await repository.prepare({
      ...jobIdentity,
      outputId: payload.outputId,
      outputIndex: 0,
      outputCount: 1,
      blobUrl: payload.fileUrl,
      filename: payload.filename,
      outputKind: payload.outputKind,
      now: 1,
    })

    await coordinator.sealManifest({
      ...jobIdentity,
      outputsRequested: 1,
      outputsFailedBeforeHandoff: 0,
    })

    await expect(
      repository.getByOutputId(payload.outputId)
    ).resolves.toBeUndefined()
    await expect(repository.hasLiveDependencies()).resolves.toBe(false)
    expect(applySettlement).toHaveBeenCalledWith(
      expect.objectContaining({ requested: 1, completed: 0, interrupted: 1 })
    )
    expect(revoke).toHaveBeenCalledOnce()
  })

  it("keeps a zero-output job dependency while queue settlement conflicts", async () => {
    applySettlement.mockResolvedValueOnce({
      outcome: "conflict",
      reason: "lease-conflict",
    })
    const { coordinator, repository } = createCoordinator()

    await coordinator.sealManifest({
      ...jobIdentity,
      outputsRequested: 0,
      outputsFailedBeforeHandoff: 0,
    })

    const conflicted = await repository.getManifest(payload.jobId)
    expect(conflicted).toMatchObject({ phase: "sealed", slots: [] })
    expect(conflicted).not.toHaveProperty("dependencyReleasedAt")
    expect(ensureLiveness).toHaveBeenCalled()

    await coordinator.reconcile()

    // The second settlement attempt succeeds and the released job is pruned.
    await expect(repository.getManifest(payload.jobId)).resolves.toBeUndefined()
    await expect(repository.hasLiveDependencies()).resolves.toBe(false)
  })

  it("uses not-owner as a final cleanup disposition for a missing task", async () => {
    applySettlement.mockResolvedValueOnce({
      outcome: "not_owner",
      reason: "task-missing",
    })
    download.mockRejectedValueOnce(new Error("rejected"))
    const { coordinator, repository } = createCoordinator()
    await coordinator.handleOutputReady(payload)

    await coordinator.sealManifest({
      ...jobIdentity,
      outputsRequested: 1,
      outputsFailedBeforeHandoff: 0,
    })

    // not-owner disposition releases and prunes the output.
    await expect(
      repository.getByOutputId(payload.outputId)
    ).resolves.toBeUndefined()
    await expect(repository.hasLiveDependencies()).resolves.toBe(false)
    expect(revoke).toHaveBeenCalledOnce()
  })

  it("seals a partially populated open manifest only from an exact canceled acknowledgement", async () => {
    const { coordinator, repository } = createCoordinator()
    await repository.prepare({
      ...jobIdentity,
      outputId: payload.outputId,
      outputIndex: 0,
      outputCount: 2,
      blobUrl: payload.fileUrl,
      filename: payload.filename,
      outputKind: payload.outputKind,
      now: 1,
    })

    await coordinator.cancelTask(payload.taskId, {
      ...jobIdentity,
    })

    // The sealed manifest's prepared slot was interrupted, accounted, and the
    // released job was pruned; the settlement totals prove the seal shape.
    await expect(repository.getManifest(payload.jobId)).resolves.toBeUndefined()
    await expect(repository.hasLiveDependencies()).resolves.toBe(false)
    expect(applySettlement).toHaveBeenCalledWith(
      expect.objectContaining({ requested: 2, completed: 0, interrupted: 2 })
    )
  })

  it("leaves an open manifest untouched without an exact canceled acknowledgement", async () => {
    const { coordinator, repository } = createCoordinator()
    await repository.prepare({
      ...jobIdentity,
      outputId: payload.outputId,
      outputIndex: 0,
      outputCount: 1,
      blobUrl: payload.fileUrl,
      filename: payload.filename,
      outputKind: payload.outputKind,
      now: 1,
    })

    await coordinator.cancelTask(payload.taskId)

    expect(await repository.getManifest(payload.jobId)).toMatchObject({
      phase: "open",
      slots: [{ disposition: "tracked", outputId: payload.outputId }],
    })
    expect(await repository.getByOutputId(payload.outputId)).toMatchObject({
      phase: "prepared",
    })
    expect(applySettlement).not.toHaveBeenCalled()
    expect(revoke).not.toHaveBeenCalled()
    expect(ensureLiveness).toHaveBeenCalled()
  })

  it("seals a zero-output open manifest from an exact terminal startup outcome", async () => {
    const { coordinator, repository } = createCoordinator()
    await repository.ensureManifest({
      ...jobIdentity,
      outputsRequested: 0,
      now: 1,
    })

    await coordinator.reconcileStartupOpenManifests({
      offscreenJob: {
        ...jobIdentity,
        status: "terminal",
        stage: "saving",
        lastSequence: 4,
        outcome: {
          status: "failed",
          outputsRequested: 0,
          outputsFailedBeforeHandoff: 0,
          outputsCommitted: 0,
        },
      },
      activeLease: jobIdentity,
    })

    // The zero-output job was released and pruned after startup settlement.
    await expect(repository.getManifest(payload.jobId)).resolves.toBeUndefined()
    await expect(repository.hasLiveDependencies()).resolves.toBe(false)
    expect(applySettlement).toHaveBeenCalledWith(
      expect.objectContaining({ requested: 0, completed: 0, interrupted: 0 })
    )
  })

  it("seals a fully populated R-01 failure-cut manifest from exact terminal producer state", async () => {
    const { coordinator, repository } = createCoordinator()
    await repository.prepare({
      ...jobIdentity,
      outputId: payload.outputId,
      outputIndex: 0,
      outputCount: 1,
      blobUrl: payload.fileUrl,
      filename: payload.filename,
      outputKind: payload.outputKind,
      now: 1,
    })

    await coordinator.reconcileStartupOpenManifests({
      offscreenJob: {
        ...jobIdentity,
        status: "terminal",
        stage: "saving",
        lastSequence: 4,
        outcome: {
          status: "failed",
          outputsRequested: 0,
          outputsFailedBeforeHandoff: 0,
          outputsCommitted: 0,
        },
      },
      activeLease: null,
    })

    // The interrupted output was accounted and fully released (pruned).
    await expect(repository.getManifest(payload.jobId)).resolves.toBeUndefined()
    await expect(
      repository.getByOutputId(payload.outputId)
    ).resolves.toBeUndefined()
    await expect(repository.hasLiveDependencies()).resolves.toBe(false)
  })

  it("keeps the exact active startup producer manifest open", async () => {
    const { coordinator, repository } = createCoordinator()
    await repository.ensureManifest({
      ...jobIdentity,
      outputsRequested: 0,
      now: 1,
    })
    const identity = jobIdentity

    await coordinator.reconcileStartupOpenManifests({
      offscreenJob: {
        ...identity,
        status: "active",
        stage: "downloading",
        lastSequence: 3,
      },
      activeLease: identity,
    })

    expect(await repository.getManifest(payload.jobId)).toMatchObject({
      phase: "open",
    })
    expect(applySettlement).not.toHaveBeenCalled()
  })

  it("does not infer startup absence from a different exact queried job", async () => {
    const { coordinator, repository } = createCoordinator()
    await repository.ensureManifest({
      ...jobIdentity,
      outputsRequested: 0,
      now: 1,
    })
    const otherIdentity = {
      jobId: "job-2",
      attempt: 3,
      taskId: "task-2",
      chapterId: "chapter-2",
      fingerprint: "b".repeat(64),
      documentInstanceId: "document-instance-2",
    }

    await expect(
      coordinator.reconcileStartupOpenManifests({
        offscreenJob: {
          ...otherIdentity,
          status: "terminal",
          stage: "saving",
          lastSequence: 5,
          outcome: {
            status: "failed",
            outputsRequested: 0,
            outputsFailedBeforeHandoff: 0,
            outputsCommitted: 0,
          },
        },
        activeLease: otherIdentity,
      })
    ).resolves.toEqual({ observedJobSealed: false })

    expect(await repository.getManifest(payload.jobId)).toMatchObject({
      phase: "open",
    })
    expect(applySettlement).not.toHaveBeenCalled()
  })

  it("seals partial null slots when startup proves the producer is absent", async () => {
    const { coordinator, repository } = createCoordinator()
    await repository.prepare({
      ...jobIdentity,
      outputId: payload.outputId,
      outputIndex: 0,
      outputCount: 2,
      blobUrl: payload.fileUrl,
      filename: payload.filename,
      outputKind: payload.outputKind,
      now: 1,
    })

    await coordinator.reconcileStartupOpenManifests({
      offscreenJob: null,
      activeLease: jobIdentity,
    })

    // The prepared slot was interrupted, accounted, and the job released and
    // pruned; the settlement totals prove the null-slot seal shape.
    await expect(repository.getManifest(payload.jobId)).resolves.toBeUndefined()
    await expect(repository.hasLiveDependencies()).resolves.toBe(false)
    expect(applySettlement).toHaveBeenCalledWith(
      expect.objectContaining({ requested: 2, completed: 0, interrupted: 2 })
    )
  })
})
