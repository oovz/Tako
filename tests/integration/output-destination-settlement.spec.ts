import { afterEach, describe, expect, it, vi } from "vitest"

import { DestinationService } from "@/entrypoints/background/destination"
import type { DownloadTaskExecutor } from "@/entrypoints/background/download-task-executor"
import { NativeOutputCoordinator } from "@/entrypoints/background/native-output-coordinator"
import { OffscreenJobTerminalCoordinator } from "@/entrypoints/background/offscreen-job-terminal-coordinator"
import { QueueScheduler } from "@/entrypoints/background/queue-scheduler"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import type { DownloadTaskState } from "@/src/domain/queue/state"
import { createDispatchLease } from "@/src/runtime/dispatch-lease"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { LOCAL_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import type { RuntimeMessageRequest } from "@/src/runtime/runtime-message-contracts"
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

async function fixture(
  count: number,
  mode: "downloads-api" | "fsa" = "downloads-api",
  chapterCount = 1
) {
  const settings = structuredClone(DEFAULT_SETTINGS)
  settings.downloads.destination = mode === "fsa" ? "file-system-access" : mode
  settings.downloads.customDirectoryHandleId =
    mode === "fsa" ? "captured-folder" : null
  settings.notifications = false
  const task: DownloadTaskState = {
    id: identity.taskId,
    siteIntegrationId: "mangadex",
    mangaId: "series",
    seriesTitle: "Series",
    status: "downloading",
    created: 1,
    started: 2,
    settingsSnapshot: createTaskSettingsSnapshot(settings, "mangadex"),
    chapters: [
      {
        requestedPath: "Tako/Chapter.cbz",
        id: identity.chapterId,
        url: "https://mangadex.org/chapter/chapter",
        title: "Chapter",
        index: 0,
        status: "downloading",
        dispatchAttempt: 1,
        lastUpdated: 2,
      },
    ],
  }
  if (chapterCount > 1) {
    task.chapters.push({
      ...task.chapters[0]!,
      id: "next-chapter",
      title: "Next chapter",
      index: 1,
      status: "queued",
      dispatchAttempt: undefined,
    })
  }
  const local: Record<string, unknown> = {
    [LOCAL_STORAGE_KEYS.downloadQueue]: [task],
    [LOCAL_STORAGE_KEYS.pendingUndoActions]: [],
    [LOCAL_STORAGE_KEYS.activeDispatchLease]: {
      ...createDispatchLease({ ...identity, saveMode: mode, now: 2 }),
      documentInstanceId: identity.documentInstanceId,
    },
  }
  const download = vi.fn(async () => 40 + download.mock.calls.length)
  const search = vi.fn(async () => [] as chrome.downloads.DownloadItem[])
  const revoke = vi.fn(async () => undefined)
  const storageSet = vi.fn(async (values: Record<string, unknown>) => {
    Object.assign(local, structuredClone(values))
  })
  vi.stubGlobal("chrome", {
    runtime: { id: "extension" },
    storage: {
      local: {
        get: vi.fn(async (keys: string | string[]) =>
          Object.fromEntries(
            (Array.isArray(keys) ? keys : [keys])
              .filter((key) => key in local)
              .map((key) => [key, structuredClone(local[key])])
          )
        ),
        set: storageSet,
        remove: vi.fn(async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys])
            delete local[key]
        }),
      },
      session: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => undefined),
      },
    },
    downloads: { download, search },
  })
  const settingsRepository = { getSettings: async () => settings }
  const runtime = () => {
    const history = new HistoryRepository()
    const queue = new QueueRepository(new QueueProjectionService(), history)
    const repository = new NativeOutputRepository()
    const native = new NativeOutputCoordinator({
      settingsRepository,
      repository,
      queueRepository: queue,
      queryOffscreenJob: async (job) => ({
        ...job,
        status: "active" as const,
        stage: "saving" as const,
        lastSequence: 1,
      }),
      requestBlobRevocation: revoke,
      ensureLivenessAlarm: async () => undefined,
    })
    const scheduler = new QueueScheduler(
      queue,
      {
        execute: vi.fn(async () => "active" as const),
        isActive: () => false,
      } as unknown as DownloadTaskExecutor,
      async () => undefined
    )
    const terminal = new OffscreenJobTerminalCoordinator(
      queue,
      native,
      scheduler,
      new DestinationService({
        queueRepository: queue,
        settingsReader: settingsRepository,
        notifier: { notifyDestinationActionRequired: () => undefined },
      }),
      { settingsRepository, historyRepository: history }
    )
    return { queue, repository, native, terminal, history }
  }
  const first = runtime()
  await first.queue.initialize()
  await first.repository.ensureManifest({
    ...identity,
    outputsRequested: count,
    now: 3,
  })
  const ready = (index: number) => ({
    ...identity,
    outputId: `output-${index}`,
    fileUrl: `blob:output-${index}`,
    filename: `chapter/${index}.png`,
    outputIndex: index,
    outputCount: count,
    outputKind: "image" as const,
  })
  const terminalPayload = (
    outcome: RuntimeMessageRequest<"OFFSCREEN_JOB_TERMINAL">["payload"]["outcome"]
  ) => ({
    ...identity,
    sequence: 2,
    stage: "saving" as const,
    terminalAt: 10,
    outcome,
  })
  const finish = () =>
    first.terminal.handle(
      terminalPayload({
        status: "completed",
        outputsRequested: count,
        outputsCommitted: mode === "fsa" ? count : 0,
        outputsFailedBeforeHandoff: 0,
      })
    )
  return {
    ...first,
    runtime,
    ready,
    finish,
    terminalPayload,
    download,
    search,
    revoke,
    local,
    storageSet,
  }
}

afterEach(() => vi.unstubAllGlobals())

describe("output destination settlement", () => {
  it("requires every final save and recovers the missing initiation receipt after restart", async () => {
    const f = await fixture(2)
    await f.native.handleOutputReady(f.ready(0))
    const second = f.ready(1)
    await f.repository.prepare({ ...second, blobUrl: second.fileUrl, now: 4 })
    await f.repository.markAcceptanceUnknown({
      outputId: second.outputId,
      now: 5,
    })
    await f.terminal.settle(
      f.terminalPayload({
        status: "completed",
        outputsRequested: 2,
        outputsCommitted: 0,
        outputsFailedBeforeHandoff: 0,
      })
    )
    expect((await f.queue.getTask(identity.taskId))?.status).toBe("downloading")
    expect(await f.history.getDownloadedChapters()).toEqual([])

    f.search.mockResolvedValue([
      {
        id: 41,
        url: f.ready(0).fileUrl,
        state: "complete",
      } as chrome.downloads.DownloadItem,
      {
        id: 42,
        url: second.fileUrl,
        state: "in_progress",
      } as chrome.downloads.DownloadItem,
    ])
    const cold = f.runtime()
    await cold.queue.initialize()
    const effects = await cold.native.initialize()
    await cold.terminal.continueAfterNativeOutputSettlement(effects)
    expect((await cold.queue.getTask(identity.taskId))?.status).toBe(
      "downloading"
    )
    expect(await cold.history.getDownloadedChapters()).toEqual([])
    const final = await cold.native.handleDownloadChanged({
      id: 42,
      state: { current: "complete" },
    })
    await cold.terminal.continueAfterNativeOutputSettlement(final.effects)
    expect(await cold.queue.getTask(identity.taskId)).toMatchObject({
      status: "completed",
      chapters: [
        {
          outputs: { requested: 2, committed: 2, failed: 0 },
          outputDestination: "downloads-api",
        },
      ],
    })
    expect(await cold.history.getDownloadedChapters()).toMatchObject([
      {
        outputDestination: "downloads-api",
        saveConfirmedAt: expect.any(Number),
      },
    ])
    expect(f.download).toHaveBeenCalledOnce()
    expect(f.revoke).toHaveBeenCalledTimes(2)
  })

  it("accounts for acknowledged loose files when a later handoff is rejected", async () => {
    const f = await fixture(2)
    await f.native.handleOutputReady(f.ready(0))
    f.download.mockRejectedValueOnce(new Error("Chrome rejected the file"))
    await f.native.handleOutputReady(f.ready(1))
    await f.native.handleDownloadChanged({
      id: 41,
      state: { current: "complete" },
    })
    await f.finish()
    expect(await f.queue.getTask(identity.taskId)).toMatchObject({
      status: "partial_success",
      chapters: [{ outputs: { requested: 2, committed: 1, failed: 1 } }],
    })
    expect(await f.history.getDownloadedChapters()).toEqual([])
    expect(await f.repository.getByOutputId("output-0")).toBeUndefined()
  })

  it("reports an unknown save outcome when Chrome observation is unavailable", async () => {
    const f = await fixture(1)
    await f.native.handleOutputReady(f.ready(0))
    f.search.mockRejectedValue(new Error("Chrome search unavailable"))
    await f.finish()
    expect(await f.queue.getTask(identity.taskId)).toMatchObject({
      status: "failed",
      errorCategory: "browser_output_unconfirmed",
      chapters: [{ nativeOutputSettlement: { outputUncertain: true } }],
    })
    expect(await f.history.getDownloadedChapters()).toHaveLength(0)
    expect(f.revoke).not.toHaveBeenCalled()
  })

  it("restores pending native work when an exact paused download is observed before settlement", async () => {
    const f = await fixture(1)
    await f.native.handleOutputReady(f.ready(0))
    f.search.mockRejectedValueOnce(new Error("Temporary Chrome query failure"))
    await f.native.reconcile()
    expect(await f.repository.getByOutputId("output-0")).toMatchObject({
      phase: "outcome_unknown",
      accountingDisposition: "pending",
    })
    f.search.mockResolvedValue([
      {
        id: 41,
        url: f.ready(0).fileUrl,
        state: "in_progress",
        paused: true,
      } as chrome.downloads.DownloadItem,
    ])
    await f.finish()
    expect(await f.queue.getTask(identity.taskId)).toMatchObject({
      status: "downloading",
      chapters: [{ status: "downloading" }],
    })
    expect(await f.repository.getByOutputId("output-0")).toMatchObject({
      phase: "waiting",
      accountingDisposition: "pending",
    })
    expect(await f.history.getDownloadedChapters()).toEqual([])
    expect(f.revoke).not.toHaveBeenCalled()
    const { effects } = await f.native.handleDownloadChanged({
      id: 41,
      state: { current: "complete" },
    })
    await f.terminal.continueAfterNativeOutputSettlement(effects)
    expect(await f.queue.getTask(identity.taskId)).toMatchObject({
      status: "completed",
      chapters: [{ saveConfirmedAt: expect.any(Number) }],
    })
    expect(await f.history.getDownloadedChapters()).toHaveLength(1)
    expect(f.revoke).toHaveBeenCalledOnce()
  })

  it.each([false, true])(
    "keeps a durable unknown outcome fixed after a crash before its accounting receipt with lost ID=%s",
    async (lostId) => {
      const f = await fixture(1, "downloads-api", 2)
      if (lostId)
        vi.spyOn(f.repository, "attachDownload").mockRejectedValueOnce(
          new Error("Download ID receipt unavailable")
        )
      await f.native.handleOutputReady(f.ready(0))
      vi.spyOn(f.repository, "markAccountingDisposition").mockRejectedValueOnce(
        new Error("Accounting receipt unavailable")
      )
      await expect(f.finish()).rejects.toThrow("Accounting receipt unavailable")
      const before = await f.queue.getTask(identity.taskId)
      expect(before).toMatchObject({
        status: "downloading",
        chapters: [
          {
            status: "failed",
            nativeOutputSettlement: { outputUncertain: true },
          },
          { status: "queued" },
        ],
      })
      expect(await f.repository.getByOutputId("output-0")).toMatchObject({
        phase: "outcome_unknown",
        accountingDisposition: "pending",
      })
      f.search.mockResolvedValue([
        {
          id: 41,
          url: f.ready(0).fileUrl,
          state: "in_progress",
          paused: true,
        } as chrome.downloads.DownloadItem,
      ])
      const cold = f.runtime()
      await cold.queue.initialize()
      await cold.native.initialize()
      expect(await cold.repository.getByOutputId("output-0")).toMatchObject({
        phase: "outcome_unknown",
        accountingDisposition: "accounted",
      })
      expect(await cold.queue.getTask(identity.taskId)).toEqual(before)
      expect(f.revoke).not.toHaveBeenCalled()
      const result = await cold.native.handleDownloadChanged({
        id: 41,
        state: { current: "complete" },
      })
      for (const effect of result.effects)
        await cold.native.acknowledgeSettlement(effect)
      expect(await cold.queue.getTask(identity.taskId)).toEqual(before)
      expect(await cold.history.getDownloadedChapters()).toEqual([])
      expect(f.revoke).toHaveBeenCalledOnce()
    }
  )

  it.each([false, true])(
    "retains the original failure with earlier output uncertainty and producer error=%s",
    async (producerFailed) => {
      const f = await fixture(2)
      await f.native.handleOutputReady(f.ready(0))
      await f.native.handleOutputReady(f.ready(1))
      await f.native.handleDownloadChanged({
        id: 42,
        state: { current: "interrupted" },
        error: { current: "FILE_NO_SPACE" },
      })
      await f.terminal.handle(
        f.terminalPayload({
          status: "failed",
          outputsRequested: 2,
          outputsCommitted: 0,
          outputsFailedBeforeHandoff: 0,
          ...(producerFailed
            ? {
                errorMessage: "Archive creation failed",
                errorCategory: "archive_creation_failed" as const,
              }
            : {}),
        })
      )
      const cause = producerFailed
        ? {
            errorMessage: "Archive creation failed",
            errorCategory: "archive_creation_failed",
          }
        : {
            errorMessage: "FILE_NO_SPACE",
            errorCategory: "browser_download_interrupted",
          }
      const before = await f.queue.getTask(identity.taskId)
      expect(before).toMatchObject({
        status: "failed",
        ...cause,
        chapters: [
          {
            ...cause,
            nativeOutputSettlement: { outputUncertain: true },
            outputs: { requested: 2, committed: 0, failed: 2 },
          },
        ],
      })
      expect(await f.repository.getByOutputId("output-1")).toBeUndefined()
      expect(await f.repository.getByOutputId("output-0")).toMatchObject({
        phase: "outcome_unknown",
      })
      expect(f.revoke).toHaveBeenCalledOnce()
      const cold = f.runtime()
      await cold.queue.initialize()
      await cold.native.initialize()
      const result = await cold.native.handleDownloadChanged({
        id: 41,
        state: { current: "complete" },
      })
      for (const effect of result.effects)
        await cold.native.acknowledgeSettlement(effect)
      expect(await cold.queue.getTask(identity.taskId)).toEqual(before)
      expect(await cold.history.getDownloadedChapters()).toEqual([])
      expect(f.revoke).toHaveBeenCalledTimes(2)
    }
  )

  it("releases retained output using an existing durable settlement receipt", async () => {
    const f = await fixture(1)
    await f.native.handleOutputReady(f.ready(0))
    await f.terminal.settle(
      f.terminalPayload({
        status: "completed",
        outputsRequested: 1,
        outputsCommitted: 0,
        outputsFailedBeforeHandoff: 0,
      })
    )
    await f.repository.markTerminal({
      downloadId: 41,
      phase: "interrupted",
      now: Date.now(),
    })
    await f.queue.applyNativeOutputSettlement({
      ...identity,
      requested: 1,
      completed: 0,
      interrupted: 1,
      now: Date.now(),
    })
    const recorded = await f.queue.getTask(identity.taskId)
    const cold = f.runtime()
    await cold.queue.initialize()
    const effects = await cold.native.initialize()
    await cold.terminal.continueAfterNativeOutputSettlement(effects)
    expect(await cold.queue.getTask(identity.taskId)).toEqual(recorded)
    expect(await cold.native.hasLiveDependencies()).toBe(false)
    expect(f.revoke).toHaveBeenCalledOnce()
    expect(await cold.history.getDownloadedChapters()).toEqual([])
  })

  it("keeps confirmed history through task removal and later browser erasure", async () => {
    const f = await fixture(1)
    await f.native.handleOutputReady(f.ready(0))
    await f.native.handleDownloadChanged({
      id: 41,
      state: { current: "complete" },
    })
    await f.finish()
    await f.queue.clearTerminalHistory()
    const cold = f.runtime()
    await cold.queue.initialize()
    await cold.native.initialize()
    expect(await cold.queue.getQueue()).toEqual([])
    expect(f.revoke).toHaveBeenCalledOnce()
    await cold.native.handleDownloadErased(41)
    expect(await cold.history.getDownloadedChapters()).toMatchObject([
      { outputDestination: "downloads-api" },
    ])
    expect(await cold.native.hasLiveDependencies()).toBe(false)
    expect(f.revoke).toHaveBeenCalledOnce()
  })

  it("records successful direct writes as saved to the folder", async () => {
    const f = await fixture(2, "fsa")
    await f.finish()
    expect(await f.queue.getTask(identity.taskId)).toMatchObject({
      status: "completed",
      chapters: [
        {
          outputDestination: "fsa",
          saveConfirmedAt: expect.any(Number),
          outputs: { requested: 2, committed: 2, failed: 0 },
        },
      ],
    })
    expect(await f.history.getDownloadedChapters()).toMatchObject([
      { outputDestination: "fsa", saveConfirmedAt: expect.any(Number) },
    ])
    expect(f.download).not.toHaveBeenCalled()
  })

  it("records a saved folder chapter before later chapters finish", async () => {
    const f = await fixture(1, "fsa", 2)
    await f.finish()
    expect(await f.queue.getTask(identity.taskId)).toMatchObject({
      status: "downloading",
      chapters: [{ status: "completed" }, { status: "queued" }],
    })
    expect(await f.history.getDownloadedChapters()).toMatchObject([
      { chapterId: identity.chapterId, outputDestination: "fsa" },
    ])
  })

  it("preserves a chapter-history clear while folder output continues", async () => {
    const f = await fixture(1, "fsa", 2)
    await f.finish()
    expect(await f.history.getDownloadedChapters()).toHaveLength(1)
    await f.history.clearAllDownloadHistory()
    const result = await f.queue.settleTaskChapter({
      taskId: identity.taskId,
      chapterId: "next-chapter",
      status: "completed",
      now: Date.now() + 10,
      updates: {
        outputDestination: "fsa",
        outputs: { requested: 1, committed: 1, failed: 0 },
      },
    })
    expect(result.outcome).toBe("applied")
    await f.terminal.continueTask(identity.taskId)
    expect(
      (await new HistoryRepository().getDownloadedChapters()).map(
        (record) => record.chapterId
      )
    ).toEqual(["next-chapter"])
  })

  it("preserves folder repair and partial writes when the destination fails", async () => {
    const f = await fixture(2, "fsa")
    await f.terminal.handle(
      f.terminalPayload({
        status: "partial_success",
        outputsRequested: 2,
        outputsCommitted: 1,
        outputsFailedBeforeHandoff: 0,
        errorCategory: "folder_write_failed",
        errorMessage: "Closing the second file failed",
      })
    )
    expect(await f.queue.getTask(identity.taskId)).toMatchObject({
      status: "queued",
      activeBlock: "destination_action_required",
      destinationIssue: { kind: "fsa_write_failed" },
      chapters: [
        {
          outputs: { requested: 2, committed: 1, failed: 1 },
          errorMessage: "Closing the second file failed",
        },
      ],
    })
    expect(await f.history.getDownloadedChapters()).toEqual([])
  })
})
