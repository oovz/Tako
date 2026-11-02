import { beforeEach, describe, expect, it, vi } from "vitest"

import { DownloadTaskCancellationCoordinator } from "@/entrypoints/background/download-task-cancellation-coordinator"
import type { NativeOutputCoordinator } from "@/entrypoints/background/native-output-coordinator"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import type {
  ActiveDispatchLease,
  DownloadTaskState,
} from "@/src/domain/queue/state"
import { createDispatchLease } from "@/src/runtime/dispatch-lease"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { LOCAL_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import type { RuntimeMessageResponse } from "@/src/runtime/runtime-message-contracts"
import { createQueueRepositoryTestHarness } from "../background/queue-repository-test-harness"

const lease: ActiveDispatchLease = {
  ...createDispatchLease({
    jobId: "job-1",
    attempt: 1,
    taskId: "task-1",
    chapterId: "chapter-1",
    fingerprint: "a".repeat(64),
    saveMode: "downloads-api",
    now: 1,
  }),
  documentInstanceId: "document-1",
}

function task(
  status: DownloadTaskState["status"] = "downloading"
): DownloadTaskState {
  return {
    id: "task-1",
    status,
    created: 1,
    siteIntegrationId: "mangadex",
    mangaId: "series-1",
    seriesTitle: "Series",
    settingsSnapshot: createTaskSettingsSnapshot(DEFAULT_SETTINGS, "mangadex"),
    chapters: [
      {
        id: "chapter-1",
        url: "https://mangadex.org/chapter/1",
        title: "Chapter 1",
        requestedPath: "Series/Chapter 1.cbz",
        index: 0,
        status: "downloading",
        lastUpdated: 1,
      },
      {
        id: "chapter-2",
        url: "https://mangadex.org/chapter/2",
        title: "Chapter 2",
        requestedPath: "Series/Chapter 2.cbz",
        index: 1,
        status: "queued",
        lastUpdated: 1,
      },
    ],
  }
}

type CancellationResponse = Extract<
  RuntimeMessageResponse<"OFFSCREEN_CANCEL_JOB">,
  { success: true }
>

function acknowledgement(
  overrides: Partial<CancellationResponse> = {}
): CancellationResponse {
  return {
    success: true,
    canceled: true,
    status: "canceled",
    lastSequence: 1,
    jobId: lease.jobId,
    attempt: lease.attempt,
    taskId: lease.taskId,
    chapterId: lease.chapterId,
    fingerprint: lease.fingerprint,
    documentInstanceId: "document-1",
    ...overrides,
  }
}

async function setup(queue = [task()]) {
  const repository = createQueueRepositoryTestHarness(queue)
  await chrome.storage.local.set({
    [LOCAL_STORAGE_KEYS.activeDispatchLease]: lease,
  })
  const sendMessage = vi.fn(
    async (): Promise<RuntimeMessageResponse<"OFFSCREEN_CANCEL_JOB">> =>
      acknowledgement()
  )
  Object.assign(chrome, { runtime: { sendMessage } })
  const native = {
    cancelTask: vi.fn(async () => undefined),
    armLiveness: vi.fn(async () => undefined),
    getLiveTaskIds: vi.fn(async (): Promise<string[]> => []),
  }
  const settingsRepository = {
    getSettings: vi.fn(async () => DEFAULT_SETTINGS),
  }
  const coordinator = new DownloadTaskCancellationCoordinator(
    repository,
    native as unknown as NativeOutputCoordinator,
    {
      settingsRepository,
      historyRepository: {
        getDownloadedChapters: vi.fn(async () => []),
        restoreChapterFromCompletedTask: vi.fn(async () => true),
      },
    }
  )
  return { repository, coordinator, sendMessage, native, settingsRepository }
}

describe("producer cancellation and durable lease retention", () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([
    ["job", { jobId: "job-2" }],
    ["attempt", { attempt: 2 }],
    ["task", { taskId: "task-2" }],
    ["chapter", { chapterId: "chapter-2" }],
    ["fingerprint", { fingerprint: "b".repeat(64) }],
    ["document", { documentInstanceId: "document-2" }],
  ] satisfies Array<[string, Partial<CancellationResponse>]>)(
    "retains the lease when the acknowledgement belongs to another %s",
    async (_field, mismatch) => {
      const { coordinator, repository, sendMessage } = await setup()
      sendMessage.mockResolvedValue(acknowledgement(mismatch))
      await expect(
        coordinator.cancelProducerAndClearLease(lease)
      ).resolves.toBeUndefined()
      expect(await repository.getActiveDispatchLease()).toEqual(lease)
    }
  )

  it.each([
    { canceled: true, status: "canceled" },
    { canceled: false, status: "absent" },
    { canceled: false, status: "terminal" },
  ] satisfies Array<Pick<CancellationResponse, "canceled" | "status">>)(
    "releases an exact lease after $status producer confirmation",
    async (confirmation) => {
      const { coordinator, repository, sendMessage } = await setup()
      sendMessage.mockResolvedValue(acknowledgement(confirmation))
      await expect(
        coordinator.cancelProducerAndClearLease(lease)
      ).resolves.toMatchObject({
        jobId: lease.jobId,
        documentInstanceId: "document-1",
      })
      expect(await repository.getActiveDispatchLease()).toBeNull()
    }
  )

  it.each([
    { canceled: false, status: "active" },
    { canceled: true, status: "terminal" },
    { canceled: false, status: "canceled" },
  ] satisfies Array<Pick<CancellationResponse, "canceled" | "status">>)(
    "retains ownership for an inconsistent or active acknowledgement $status/$canceled",
    async (confirmation) => {
      const { coordinator, repository, sendMessage } = await setup()
      sendMessage.mockResolvedValue(acknowledgement(confirmation))
      await expect(
        coordinator.cancelProducerAndClearLease(lease)
      ).resolves.toBeUndefined()
      expect(await repository.getActiveDispatchLease()).toEqual(lease)
    }
  )

  it("retains recovery authority if persisting the lease release fails", async () => {
    const { coordinator, repository } = await setup()
    vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(
      new Error("storage unavailable")
    )
    await expect(
      coordinator.cancelProducerAndClearLease(lease)
    ).resolves.toBeUndefined()
    expect(await repository.getActiveDispatchLease()).toEqual(lease)
  })

  it("quarantines a terminal save failure until producer cancellation is confirmed", async () => {
    const { coordinator, repository, sendMessage, native, settingsRepository } =
      await setup()
    sendMessage.mockResolvedValue(
      acknowledgement({ documentInstanceId: "old-document" })
    )
    await expect(
      coordinator.failTaskForSave({
        taskId: "task-1",
        errorMessage: "Folder access lost",
        errorCategory: "folder_permission_required",
      })
    ).resolves.toBe("quarantined")
    expect(await repository.getTask("task-1")).toMatchObject({
      status: "failed",
      errorMessage: "Folder access lost",
      chapters: [{ status: "failed" }, { status: "skipped" }],
    })
    expect(await repository.getActiveDispatchLease()).toEqual(lease)
    expect(native.armLiveness).toHaveBeenCalledOnce()
    expect(settingsRepository.getSettings).not.toHaveBeenCalled()
  })

  it("settles a save failure after exact lease release and preserves its cause", async () => {
    const { coordinator, repository, settingsRepository } = await setup()
    await expect(
      coordinator.failTaskForSave({
        taskId: "task-1",
        errorMessage: "Folder access lost",
        errorCategory: "folder_permission_required",
      })
    ).resolves.toBe("settled")
    expect(await repository.getActiveDispatchLease()).toBeNull()
    expect(await repository.getTask("task-1")).toMatchObject({
      status: "failed",
      errorMessage: "Folder access lost",
      chapters: [{ status: "failed" }, { status: "skipped" }],
    })
    expect(settingsRepository.getSettings).toHaveBeenCalledOnce()
  })

  it("preserves live native output when interruption requests its protection", async () => {
    const { coordinator, repository, sendMessage, native } = await setup()
    native.getLiveTaskIds.mockResolvedValue(["task-1"])
    await expect(
      coordinator.interruptTask({
        taskId: "task-1",
        errorMessage: "disabled",
        preserveNativeOutput: true,
      })
    ).resolves.toBe("not-applied")
    expect((await repository.getTask("task-1"))?.status).toBe("downloading")
    expect(await repository.getActiveDispatchLease()).toEqual(lease)
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it("arms recovery for a lease whose task is already terminal", async () => {
    const { coordinator, repository, sendMessage, native } = await setup([
      task("failed"),
    ])
    await expect(
      coordinator.interruptTask({ taskId: "task-1", errorMessage: "disabled" })
    ).resolves.toBe("quarantined")
    expect(await repository.getActiveDispatchLease()).toEqual(lease)
    expect(native.armLiveness).toHaveBeenCalledOnce()
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it("converges an active cancellation replay and rejects reuse by another command", async () => {
    const { coordinator, repository, native } = await setup()
    await expect(coordinator.cancelTask("task-1", "cancel-1")).resolves.toEqual(
      { result: { kind: "active" }, queueCanContinue: true }
    )
    await expect(coordinator.cancelTask("task-1", "cancel-1")).resolves.toEqual(
      { result: { kind: "active" }, queueCanContinue: true }
    )
    await expect(coordinator.cancelTask("task-1", "cancel-2")).rejects.toThrow(
      Error
    )
    expect((await repository.getTask("task-1"))?.activeCancel).toEqual({
      commandId: "cancel-1",
    })
    expect(await repository.getActiveDispatchLease()).toBeNull()
    expect(native.cancelTask).toHaveBeenCalledTimes(2)
  })

  it("rejects a cancellation whose Undo identity already belongs to another task", async () => {
    const queuedTask = task("queued")
    queuedTask.chapters.forEach((chapter) => {
      chapter.status = "queued"
    })
    const { coordinator, repository, native } = await setup([queuedTask])
    await chrome.storage.local.set({
      [LOCAL_STORAGE_KEYS.pendingUndoActions]: [
        {
          token: "cancel:cancel-1",
          type: "cancel_queued",
          taskSnapshot: { ...queuedTask, id: "other-task" },
          previousQueuePosition: 0,
          createdAt: 1,
          expiresAt: Date.now() + 5000,
        },
      ],
    })
    await expect(coordinator.cancelTask("task-1", "cancel-1")).rejects.toThrow(
      Error
    )
    expect((await repository.getTask("task-1"))?.status).toBe("queued")
    expect(native.cancelTask).not.toHaveBeenCalled()
  })
})
