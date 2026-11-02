import { afterEach, describe, expect, it, vi } from "vitest"

import { QueueApplicationCommands } from "@/entrypoints/background/queue-application-commands"
import type { NativeOutputCoordinator } from "@/entrypoints/background/native-output-coordinator"
import type { OffscreenJobTerminalCoordinator } from "@/entrypoints/background/offscreen-job-terminal-coordinator"
import type { DownloadTaskCancellationCoordinator } from "@/entrypoints/background/download-task-cancellation-coordinator"
import type { QueueScheduler } from "@/entrypoints/background/queue-scheduler"
import type {
  DownloadTaskState,
  PendingUndoAction,
} from "@/src/domain/queue/state"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import { getEffectiveTaskDestination } from "@/src/domain/queue/task-destination"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { LOCAL_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import { createQueueRepositoryTestHarness } from "../background/queue-repository-test-harness"

function sourceTask(
  status: DownloadTaskState["status"] = "queued"
): DownloadTaskState {
  return {
    id: "source",
    status,
    siteIntegrationId: "mangadex",
    mangaId: "series",
    seriesTitle: "Series",
    created: 1,
    settingsSnapshot: {
      ...createTaskSettingsSnapshot(DEFAULT_SETTINGS, "mangadex"),
      destination: { kind: "file-system-access", handleId: "original-folder" },
    },
    chapters: [
      {
        id: "chapter-1",
        title: "Chapter 1",
        url: "https://mangadex.org/chapter/1",
        index: 0,
        status: "queued",
        lastUpdated: 1,
        requestedPath: "Original/Chapter.cbz",
      },
    ],
  }
}

function setup(queue: DownloadTaskState[] = []) {
  const repository = createQueueRepositoryTestHarness(queue)
  Object.assign(chrome, { alarms: { clear: vi.fn(async () => true) } })
  const activate = vi.fn(async () => undefined)
  const commands = new QueueApplicationCommands({
    queueRepository: repository,
    queueScheduler: { activate } as unknown as QueueScheduler,
    nativeOutputCoordinator: {} as NativeOutputCoordinator,
    terminalCoordinator: {} as OffscreenJobTerminalCoordinator,
    cancellationCoordinator: {} as DownloadTaskCancellationCoordinator,
    siteIntegrationEnablementService: { getAll: vi.fn(async () => ({})) },
    startDownloadSettings: {
      settingsRepository: { reload: vi.fn(async () => DEFAULT_SETTINGS) },
      siteOverridesService: { getAll: vi.fn(async () => ({})) },
      siteIntegrationSettingsService: { getForSite: vi.fn(async () => ({})) },
    },
    getCurrentSeriesContext: vi.fn(async () => undefined),
  })
  return { repository, activate, commands }
}

async function seedUndo(expiresAt: number) {
  const action: PendingUndoAction = {
    type: "cancel_queued",
    token: "cancel:command-1",
    taskSnapshot: sourceTask(),
    previousQueuePosition: 0,
    createdAt: 1,
    expiresAt,
  }
  await chrome.storage.local.set({
    [LOCAL_STORAGE_KEYS.pendingUndoActions]: [action],
  })
  return action.token
}

afterEach(() => vi.restoreAllMocks())

describe("queue commands with durable task state", () => {
  it("restores a canceled task's captured folder and paths and converges on replay", async () => {
    vi.spyOn(Date, "now").mockReturnValue(10_000)
    const { repository, commands, activate } = setup()
    const token = await seedUndo(20_000)
    await expect(commands.undoQueueAction(token)).resolves.toEqual({
      restoredQueuedTask: true,
    })
    await expect(commands.undoQueueAction(token)).resolves.toEqual({
      restoredQueuedTask: true,
    })
    const queue = await repository.getQueue()
    expect(queue).toHaveLength(1)
    expect(queue[0]?.chapters[0]?.requestedPath).toBe("Original/Chapter.cbz")
    expect(getEffectiveTaskDestination(queue[0]!)).toEqual({
      kind: "file-system-access",
      handleId: "original-folder",
    })
    expect(activate).toHaveBeenCalledTimes(2)
  })

  it("finalizes an expired queued cancellation without activating the queue", async () => {
    vi.spyOn(Date, "now").mockReturnValue(20_000)
    const { repository, commands, activate } = setup()
    const token = await seedUndo(20_000)
    await expect(commands.undoQueueAction(token)).rejects.toThrow(Error)
    expect((await repository.getTask("source"))?.status).toBe("canceled")
    expect(activate).not.toHaveBeenCalled()
  })

  it("rejects an unknown Undo token without restoring or activating work", async () => {
    const { repository, commands, activate } = setup()
    await expect(commands.undoQueueAction("missing-token")).rejects.toThrow(
      Error
    )
    expect(await repository.getQueue()).toEqual([])
    expect(activate).not.toHaveBeenCalled()
  })

  it("retries failed chapters once while retaining an already selected Chrome fallback", async () => {
    const source = sourceTask("partial_success")
    source.settingsSnapshot.allowChromeFallback = true
    source.useChromeFallback = true
    source.chapters[0]!.status = "failed"
    const { repository, commands, activate } = setup([source])
    const first = await commands.retryFailedChapters("source", "retry-command")
    await expect(
      commands.retryFailedChapters("source", "retry-command")
    ).resolves.toEqual(first)
    const retry = await repository.getTask(first.newTaskId)
    expect(retry?.chapters[0]?.requestedPath).toBe("Original/Chapter.cbz")
    expect(getEffectiveTaskDestination(retry!)).toEqual({
      kind: "downloads-api",
    })
    expect(await repository.getQueue()).toHaveLength(2)
    expect(activate).toHaveBeenCalledOnce()
  })

  it("restarts a failed task once with its captured folder and requested path", async () => {
    const source = sourceTask("failed")
    source.chapters[0]!.status = "failed"
    const { repository, commands, activate } = setup([source])
    const first = await commands.restartTask("source", "restart-command")
    await expect(
      commands.restartTask("source", "restart-command")
    ).resolves.toEqual(first)
    const restart = await repository.getTask(first.newTaskId)
    expect(restart?.chapters[0]?.requestedPath).toBe("Original/Chapter.cbz")
    expect(getEffectiveTaskDestination(restart!)).toEqual({
      kind: "file-system-access",
      handleId: "original-folder",
    })
    expect(await repository.getQueue()).toHaveLength(2)
    expect(activate).toHaveBeenCalledOnce()
  })

  it("rejects retry and restart of missing or ineligible tasks without queue effects", async () => {
    const { repository, commands, activate } = setup([sourceTask()])
    await expect(
      commands.retryFailedChapters("missing", "one")
    ).rejects.toThrow(Error)
    await expect(commands.restartTask("missing", "two")).rejects.toThrow(Error)
    await expect(
      commands.retryFailedChapters("source", "three")
    ).rejects.toThrow(Error)
    await expect(commands.restartTask("source", "four")).rejects.toThrow(Error)
    expect(await repository.getQueue()).toHaveLength(1)
    expect(activate).not.toHaveBeenCalled()
  })
})
