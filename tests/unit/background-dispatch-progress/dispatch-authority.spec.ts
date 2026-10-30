import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest"
import {
  ChapterDispatchCoordinator,
  type ChapterDispatchSession,
} from "@/entrypoints/background/chapter-dispatch-coordinator"
import { DownloadTaskCancellationCoordinator } from "@/entrypoints/background/download-task-cancellation-coordinator"
import type { NativeOutputCoordinator } from "@/entrypoints/background/native-output-coordinator"
import { QueueRepository } from "@/src/storage/queue-repository"
import { QueueProjectionService } from "@/src/storage/queue-projection-service"
import { HistoryRepository } from "@/src/storage/history-repository"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import type { SiteIntegrationEnablementMap } from "@/src/domain/site-integrations/storage-schemas"
import type { DownloadTaskState } from "@/src/domain/queue/state"
import { LOCAL_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import type { RuntimeMessageRequest } from "@/src/runtime/runtime-message-contracts"
import {
  ProviderNetworkPolicyPendingError,
  ProviderNetworkPolicyActionRequiredError,
  SiteIntegrationSessionRuleManager,
} from "@/src/site-integrations/session-rule-manager"

type DispatchMessage = RuntimeMessageRequest<"OFFSCREEN_DOWNLOAD_CHAPTER">
const mocks = vi.hoisted(() => ({ context: vi.fn() }))
vi.mock("@/src/runtime/site-integration-dispatch-context", () => ({
  resolveSiteIntegrationDispatchContext: mocks.context,
}))
vi.mock("@/src/runtime/logger", () => ({
  default: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

function task(): DownloadTaskState {
  return {
    id: "task",
    siteIntegrationId: "mangadex",
    mangaId: "series",
    seriesTitle: "Series",
    created: 1,
    status: "downloading",
    started: 1,
    chapters: [
      {
        id: "chapter",
        title: "Chapter",
        url: "https://mangadex.org/chapter/chapter",
        index: 1,
        status: "queued",
        requestedPath: "Series/Chapter.cbz",
        lastUpdated: 1,
      },
    ],
    settingsSnapshot: createTaskSettingsSnapshot(DEFAULT_SETTINGS, "mangadex"),
  }
}

function acknowledge(message: DispatchMessage) {
  const { payload } = message
  return {
    success: true,
    accepted: true,
    jobId: payload.jobId,
    attempt: payload.attempt,
    taskId: payload.taskId,
    chapterId: payload.chapter.id,
    fingerprint: payload.fingerprint,
    documentInstanceId: "document",
  }
}

let repository: QueueRepository
let session: ChapterDispatchSession
let send: ReturnType<typeof vi.fn>
let network: Mock<SiteIntegrationSessionRuleManager["ensureNetworkReady"]>
let enablement: { getAll: Mock<() => Promise<SiteIntegrationEnablementMap>> }
let cancellation: DownloadTaskCancellationCoordinator
let local: Record<string, unknown>

beforeEach(async () => {
  vi.clearAllMocks()
  mocks.context.mockResolvedValue(undefined)
  send = vi.fn(async (message: DispatchMessage) => acknowledge(message))
  network = vi.fn<SiteIntegrationSessionRuleManager["ensureNetworkReady"]>(
    async () => undefined
  )
  enablement = {
    getAll: vi.fn<() => Promise<SiteIntegrationEnablementMap>>(async () => ({
      mangadex: true,
    })),
  }
  local = {
    [LOCAL_STORAGE_KEYS.downloadQueue]: [task()],
    [LOCAL_STORAGE_KEYS.activeDispatchLease]: null,
    [LOCAL_STORAGE_KEYS.pendingUndoActions]: [],
  }
  vi.stubGlobal("chrome", {
    runtime: { sendMessage: send },
    storage: {
      local: {
        get: async (keys: string | string[]) =>
          Object.fromEntries(
            (Array.isArray(keys) ? keys : [keys]).map((key) => [
              key,
              structuredClone(local[key]),
            ])
          ),
        set: async (values: Record<string, unknown>) => {
          Object.assign(local, structuredClone(values))
        },
      },
      session: { get: async () => ({}), set: async () => undefined },
    },
    action: {
      setBadgeText: async () => undefined,
      setBadgeBackgroundColor: async () => undefined,
    },
  })
  const history = new HistoryRepository()
  repository = new QueueRepository(new QueueProjectionService(), history)
  cancellation = new DownloadTaskCancellationCoordinator(
    repository,
    {} as NativeOutputCoordinator,
    {
      settingsRepository: { getSettings: async () => DEFAULT_SETTINGS },
      historyRepository: history,
    }
  )
  const currentTask = (await repository.getTask("task"))!
  session = {
    task: currentTask,
    taskId: currentTask.id,
    settingsSnapshot: currentTask.settingsSnapshot,
    chapterOutcomesByIndex: [],
    shouldStopDispatch: false,
    lastDownloadMode: "browser",
  }
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function coordinator(
  admission: <T>(operation: () => Promise<T>) => Promise<T> = async (
    operation
  ) => operation()
) {
  const manager = new SiteIntegrationSessionRuleManager({
    service: enablement,
    onReconciliationSucceeded: () => undefined,
    awaitSchemaMigration: async () => undefined,
  })
  vi.spyOn(manager, "ensureNetworkReady").mockImplementation(network)
  return new ChapterDispatchCoordinator(
    repository,
    admission,
    cancellation,
    manager,
    enablement,
    { getAll: async () => ({}), getForSite: async () => ({}) }
  )
}

describe("chapter dispatch authority", () => {
  it("persists authority before sending and reuses an identical recovered dispatch", async () => {
    const dispatch = coordinator()
    send.mockImplementation(async (message: DispatchMessage) => {
      expect(await repository.getActiveDispatchLease()).toMatchObject({
        jobId: message.payload.jobId,
        fingerprint: message.payload.fingerprint,
      })
      return acknowledge(message)
    })
    const first = await dispatch.dispatch(session, 0)
    expect(first).toMatchObject({ documentInstanceId: "document", attempt: 1 })
    expect(session.currentLeaseForTask).toEqual(first)
    const second = await dispatch.dispatch(session, 0)
    expect(second).toEqual(first)
    expect(send).toHaveBeenCalledTimes(2)
    expect(network).toHaveBeenCalledTimes(1)
    expect(
      (await repository.getTask("task"))!.chapters[0]!.dispatchAttempt
    ).toBe(1)
  })

  it("persists a transport failure without discarding producer ownership", async () => {
    send.mockRejectedValueOnce(new Error("transport unavailable"))
    const authority = await coordinator().dispatch(session, 0)
    expect(authority).toBeDefined()
    expect(session.currentLeaseForTask).toEqual(authority)
    expect((await repository.getTask("task"))!).toMatchObject({
      errorMessage: "transport unavailable",
      chapters: [{ status: "failed", errorMessage: "transport unavailable" }],
    })
    expect(session.chapterOutcomesByIndex[0]).toMatchObject({
      status: "failed",
      errorMessage: "transport unavailable",
    })
  })

  it("stops admission after cancellation while provider context is resolving", async () => {
    const pending = Promise.withResolvers<undefined>()
    mocks.context.mockReturnValueOnce(pending.promise)
    const running = coordinator().dispatch(session, 0)
    await vi.waitFor(() => expect(mocks.context).toHaveBeenCalled())
    await repository.cancelDownloadTask({
      taskId: "task",
      commandId: "cancel",
      now: 2,
    })
    pending.resolve(undefined)
    expect(await running).toBeUndefined()
    expect(send).not.toHaveBeenCalled()
    expect(session.shouldStopDispatch).toBe(true)
    expect(await repository.getActiveDispatchLease()).toBeNull()
  })

  it("rechecks authority inside offscreen admission and preserves cancellation", async () => {
    const dispatch = coordinator(async (operation) => {
      await repository.cancelDownloadTask({
        taskId: "task",
        commandId: "cancel",
        now: 2,
      })
      return operation()
    })
    await dispatch.dispatch(session, 0)
    expect(send).not.toHaveBeenCalled()
    expect(session.shouldStopDispatch).toBe(true)
    expect((await repository.getTask("task"))!.status).toBe("canceled")
    expect((await repository.getTask("task"))!.errorMessage).toBeUndefined()
  })

  it("rejects an acknowledgement for a different producer before binding its incarnation", async () => {
    send.mockImplementationOnce(async (message: DispatchMessage) => ({
      ...acknowledge(message),
      fingerprint: "f".repeat(64),
    }))
    await coordinator().dispatch(session, 0)
    expect(
      (await repository.getActiveDispatchLease())!.documentInstanceId
    ).toBeUndefined()
    expect((await repository.getTask("task"))!.chapters[0]!.status).toBe(
      "failed"
    )
    expect(session.chapterOutcomesByIndex[0]!.errorMessage).toContain(
      "acknowledgement"
    )
  })

  it("rejects changed recovered work before sending another producer", async () => {
    const dispatch = coordinator()
    const first = await dispatch.dispatch(session, 0)
    session.task.chapters[0]!.requestedPath = "Changed/Chapter.cbz"
    expect(await dispatch.dispatch(session, 0)).toBeUndefined()
    expect(send).toHaveBeenCalledTimes(1)
    expect(await repository.getActiveDispatchLease()).toMatchObject(first!)
    expect(session.shouldStopDispatch).toBe(true)
    expect((await repository.getTask("task"))!.chapters[0]!.status).toBe(
      "downloading"
    )
    const preservedTask = (await repository.getTask("task"))!
    expect(preservedTask.errorMessage).toBeUndefined()
    expect(preservedTask.errorCategory).toBeUndefined()
    expect(preservedTask.chapters[0]).toMatchObject({
      id: "chapter",
      status: "downloading",
      requestedPath: "Series/Chapter.cbz",
      dispatchAttempt: first!.attempt,
    })
    expect(preservedTask.chapters[0]!.errorMessage).toBeUndefined()
    expect(preservedTask.chapters[0]!.errorCategory).toBeUndefined()
    expect(await repository.getActiveDispatchLease()).toEqual(first)
  })

  it("propagates a disabled-provider block before beginning a producer", async () => {
    enablement.getAll.mockResolvedValue({ mangadex: false })
    await expect(coordinator().dispatch(session, 0)).rejects.toBeInstanceOf(
      ProviderNetworkPolicyActionRequiredError
    )
    expect(send).not.toHaveBeenCalled()
    expect(await repository.getActiveDispatchLease()).toBeNull()
    expect(session.chapterOutcomesByIndex).toEqual([])
  })

  it("preserves an unbound producer when policy cancellation cannot be confirmed", async () => {
    send.mockRejectedValueOnce(
      new ProviderNetworkPolicyPendingError(
        "mangadex",
        new Error("Network policy unavailable")
      )
    )
    await expect(coordinator().dispatch(session, 0)).rejects.toBeInstanceOf(
      ProviderNetworkPolicyPendingError
    )
    expect(await repository.getActiveDispatchLease()).not.toBeNull()
    expect(session.currentLeaseForTask).toBeDefined()
    expect((await repository.getTask("task"))!.chapters[0]!.status).toBe(
      "downloading"
    )
  })

  it("clears a recovered producer only after its cancellation acknowledgement", async () => {
    const dispatch = coordinator()
    await dispatch.dispatch(session, 0)
    send.mockImplementation(async (message) => {
      if (message.type === "OFFSCREEN_DOWNLOAD_CHAPTER")
        throw new ProviderNetworkPolicyPendingError(
          "mangadex",
          new Error("Network policy unavailable")
        )
      return {
        success: true,
        canceled: true,
        status: "canceled",
        lastSequence: 0,
        ...message.payload,
      }
    })
    await expect(dispatch.dispatch(session, 0)).rejects.toBeInstanceOf(
      ProviderNetworkPolicyPendingError
    )
    expect(await repository.getActiveDispatchLease()).toBeNull()
    expect(session.currentLeaseForTask).toBeUndefined()
  })
})
