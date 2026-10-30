import { Window } from "happy-dom"
import { afterEach, describe, expect, it, vi } from "vitest"
import { registerBackgroundRuntimeListeners } from "@/entrypoints/background/background-runtime-listeners"
import { BackgroundRuntimeKernel } from "@/entrypoints/background/background-runtime-kernel"
import { createBackgroundOffscreenEventMessageHandlers } from "@/entrypoints/background/background-offscreen-event-message-handlers"
import { createBackgroundSettingsUiMessageHandlers } from "@/entrypoints/background/background-settings-ui-message-handlers"
import type { BackgroundRuntimeHandlerDependencies } from "@/entrypoints/background/background-runtime-handler-dependencies"
import { DownloadTaskCancellationCoordinator } from "@/entrypoints/background/download-task-cancellation-coordinator"
import { DownloadTaskExecutor } from "@/entrypoints/background/download-task-executor"
import { ChapterDispatchCoordinator } from "@/entrypoints/background/chapter-dispatch-coordinator"
import { DestinationService } from "@/entrypoints/background/destination"
import { OffscreenJobTerminalCoordinator } from "@/entrypoints/background/offscreen-job-terminal-coordinator"
import { NativeOutputCoordinator } from "@/entrypoints/background/native-output-coordinator"
import { requestBlobRevocation } from "@/entrypoints/background/native-output-blob-revocation"
import { clearActiveTaskProgress } from "@/entrypoints/background/active-task-progress-bus"
import { ProviderPolicyQueueCoordinator } from "@/entrypoints/background/provider-policy-queue-coordinator"
import { QueueScheduler } from "@/entrypoints/background/queue-scheduler"
import { TabContextStateService } from "@/entrypoints/background/tab-context-state-service"
import { createTabContextCache } from "@/entrypoints/background/tab-cache"
import {
  ensureLivenessAlarm,
  ensureOffscreenDocumentReady,
  LIVENESS_ALARM_NAME,
  queryOffscreenJob,
  runOffscreenDocumentAdmissionExclusive,
  setLivenessAlarmArmed,
} from "@/entrypoints/background/offscreen-lifecycle"
import { OffscreenWorker } from "@/entrypoints/offscreen/main-worker"
import { createOffscreenRuntimeMessageHandlers } from "@/entrypoints/offscreen/offscreen-runtime-message-handlers"
import { OFFSCREEN_HEARTBEAT_INTERVAL_MS } from "@/src/constants/timeouts"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import type { DownloadTaskState } from "@/src/domain/queue/state"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import {
  migrateDurableStateForCurrentSchema,
  CURRENT_STATE_SCHEMA_EPOCH,
} from "@/src/runtime/state-schema-migration"
import {
  dispatchRuntimeMessage,
  type RuntimeMessageHandlerMap,
} from "@/src/runtime/runtime-message-dispatcher"
import type { RuntimeMessage } from "@/src/runtime/runtime-message-contracts"
import { classifyRuntimeMessagePrincipal } from "@/src/runtime/runtime-message-sender"
import { HistoryRepository } from "@/src/storage/history-repository"
import { NativeOutputRepository } from "@/src/storage/native-output-repository"
import { QueueProjectionService } from "@/src/storage/queue-projection-service"
import { QueueRepository } from "@/src/storage/queue-repository"
import {
  SettingsRepository,
  SETTINGS_STORAGE_KEY,
} from "@/src/storage/settings-repository"
import { SiteIntegrationEnablementService } from "@/src/storage/site-integration-enablement-service"
import { SiteIntegrationSettingsService } from "@/src/storage/site-integration-settings-service"
import { SiteIntegrationSessionRuleManager } from "@/src/site-integrations/session-rule-manager"
import { SHONEN_JUMP_PLUS_SCRAMBLED_PNG } from "@/tests/e2e/fixtures/mock-data/site-integrations/shonenjumpplus/scrambled-image-fixture"

const extensionId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
const browserDocumentId = "11111111-1111-4111-8111-111111111111"

function browserEvent<T extends (...args: never[]) => unknown>() {
  const listeners: T[] = []
  return { addListener: (listener: T) => listeners.push(listener), listeners }
}

function storageArea(values: Record<string, unknown>) {
  return {
    get: async (keys: string | string[] | null) => {
      const requested = keys === null ? Object.keys(values) : [keys].flat()
      return Object.fromEntries(
        requested
          .filter((key) => key in values)
          .map((key) => [key, structuredClone(values[key])])
      )
    },
    set: async (next: Record<string, unknown>) =>
      Object.assign(values, structuredClone(next)),
    remove: async (keys: string | string[]) => {
      for (const key of [keys].flat()) delete values[key]
    },
    setAccessLevel: async () => undefined,
  }
}

async function fixture() {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-10-29T17:00:00Z"))
  const dom = new Window()
  vi.stubGlobal("DOMParser", dom.DOMParser)
  const settings = structuredClone(DEFAULT_SETTINGS)
  settings.notifications = false
  settings.downloads.defaultFormat = "none"
  settings.downloads.includeComicInfo = false
  settings.downloads.includeCoverImage = false
  settings.globalPolicy.image = { concurrency: 1, delayMs: 0 }
  settings.globalPolicy.chapter = { concurrency: 1, delayMs: 0 }
  const local: Record<string, unknown> = {
    stateSchemaEpoch: CURRENT_STATE_SCHEMA_EPOCH,
    [SETTINGS_STORAGE_KEY]: settings,
  }
  const session: Record<string, unknown> = {}
  const alarms = new Map<string, chrome.alarms.Alarm>()
  const onAlarm = browserEvent<(alarm: chrome.alarms.Alarm) => void>()
  const contextsGate = Promise.withResolvers<Array<{ documentId: string }>>()
  let blockedProgress = false
  let blockNextContextLookup = false
  let blockProgressAfterOutput = false
  let documentExists = false
  let cancelFailures = 0
  let firingAlarm: ReturnType<typeof Promise.withResolvers<void>> | undefined
  let alarmQueries = 0
  const cancellations: Array<{
    at: number
    delivered: boolean
    leaseJobId: string | undefined
  }> = []
  const messages: string[] = []
  const downloads: chrome.downloads.DownloadItem[] = []
  const worker = new OffscreenWorker()
  const offscreenHandlers = createOffscreenRuntimeMessageHandlers(
    worker,
    () => "ready"
  )
  const sender = {
    id: extensionId,
    url: `chrome-extension://${extensionId}/offscreen.html`,
    documentId: browserDocumentId,
  }
  const classifySender = (value: chrome.runtime.MessageSender) =>
    classifyRuntimeMessagePrincipal(value, extensionId)
  vi.stubGlobal("chrome", {
    storage: {
      local: storageArea(local),
      session: storageArea(session),
      onChanged: browserEvent(),
    },
    runtime: {
      id: extensionId,
      getURL: (path: string) => `chrome-extension://${extensionId}/${path}`,
      getManifest: () => ({}),
      onConnect: browserEvent(),
      onUpdateAvailable: browserEvent(),
      getContexts: async () => {
        if (blockNextContextLookup) {
          blockNextContextLookup = false
          blockedProgress = true
          return contextsGate.promise
        }
        return documentExists ? [{ documentId: browserDocumentId }] : []
      },
      sendMessage: async (message: RuntimeMessage) => {
        messages.push(message.type)
        if (message.target === "background") {
          if (
            message.type === "OFFSCREEN_DOWNLOAD_PROGRESS" &&
            blockProgressAfterOutput
          ) {
            blockProgressAfterOutput = false
            blockNextContextLookup = true
          }
          const response = await dispatchRuntimeMessage(message, sender, {
            target: "background",
            handlers: backgroundHandlers,
            classifySender,
            waitForReadiness: (phase) => kernel.ensure(phase),
          })
          if (message.type === "OFFSCREEN_OUTPUT_READY")
            blockProgressAfterOutput = true
          return response
        }
        if (message.type === "OFFSCREEN_CANCEL_JOB") {
          const delivered = cancelFailures === 0
          cancellations.push({
            at: Date.now(),
            delivered,
            leaseJobId: (await queue.getActiveDispatchLease())?.jobId,
          })
          if (!delivered) {
            cancelFailures -= 1
            throw new Error("Cooperative cancellation transport unavailable")
          }
        }
        const response = await dispatchRuntimeMessage(
          message,
          { id: extensionId },
          {
            target: "offscreen",
            handlers: offscreenHandlers,
            classifySender,
            waitForReadiness: async () => undefined,
          }
        )
        if (message.type === "OFFSCREEN_QUERY_JOB" && firingAlarm)
          alarmQueries += 1
        return response
      },
    },
    offscreen: {
      hasDocument: async () => documentExists,
      createDocument: async () => {
        documentExists = true
      },
      closeDocument: async () => {
        documentExists = false
      },
      Reason: { BLOBS: "BLOBS", WORKERS: "WORKERS", DOM_PARSER: "DOM_PARSER" },
    },
    alarms: {
      onAlarm,
      get: async (name: string) => {
        if (name === LIVENESS_ALARM_NAME && alarmQueries >= 2)
          firingAlarm?.resolve()
        return alarms.get(name)
      },
      clear: async (name: string) => alarms.delete(name),
      create: async (name: string, info: chrome.alarms.AlarmCreateInfo) => {
        alarms.set(name, {
          name,
          scheduledTime: Date.now() + (info.delayInMinutes ?? 0) * 60_000,
          periodInMinutes: info.periodInMinutes,
          persistAcrossSessions: info.persistAcrossSessions ?? true,
        })
        if (name === LIVENESS_ALARM_NAME && alarmQueries >= 2)
          firingAlarm?.resolve()
      },
    },
    tabs: {
      query: async () => [],
      onRemoved: browserEvent(),
      onReplaced: browserEvent(),
    },
    permissions: { contains: async () => true },
    action: {
      setBadgeText: async () => undefined,
      setBadgeBackgroundColor: async () => undefined,
    },
    i18n: { getUILanguage: () => "en", getMessage: (key: string) => key },
    downloads: {
      onChanged: browserEvent(),
      onErased: browserEvent(),
      download: async (options: chrome.downloads.DownloadOptions) => {
        downloads.push({
          id: 42,
          url: options.url,
          finalUrl: options.url,
          filename: options.filename!,
          incognito: false,
          danger: "safe",
          mime: "image/png",
          startTime: new Date().toISOString(),
          state: "in_progress",
          paused: false,
          canResume: false,
          referrer: "",
          bytesReceived: 0,
          totalBytes: 100,
          fileSize: 100,
          exists: true,
          byExtensionId: extensionId,
          byExtensionName: "Tako",
        })
        return 42
      },
      search: async () => structuredClone(downloads),
    },
    declarativeNetRequest: {
      getSessionRules: async () => [],
      updateSessionRules: async () => undefined,
      RuleActionType: { MODIFY_HEADERS: "modifyHeaders" },
      HeaderOperation: { SET: "set" },
      ResourceType: { XMLHTTPREQUEST: "xmlhttprequest", OTHER: "other" },
    },
  })
  vi.stubGlobal("fetch", async (url: string) => {
    if (url === "https://mycomic.com/chapters/492177")
      return new Response(
        '<img class="page" x-ref="page-1" src="https://biccam.com/chapters/492177/1-abc.png"><img class="page" x-ref="page-2" src="https://biccam.com/chapters/492177/2-def.png">',
        { headers: { "content-type": "text/html; charset=utf-8" } }
      )
    if (url.startsWith("https://biccam.com/chapters/"))
      return new Response(new Uint8Array(SHONEN_JUMP_PLUS_SCRAMBLED_PNG), {
        headers: { "content-type": "image/png" },
      })
    throw new Error(`Unexpected network request: ${url}`)
  })
  const history = new HistoryRepository()
  const queue = new QueueRepository(new QueueProjectionService(), history)
  const nativeRepository = new NativeOutputRepository()
  const settingsRepository = new SettingsRepository("warn")
  const enablement = new SiteIntegrationEnablementService()
  const native = new NativeOutputCoordinator({
    settingsRepository,
    repository: nativeRepository,
    queueRepository: queue,
    queryOffscreenJob,
    requestBlobRevocation,
    ensureLivenessAlarm,
  })
  const finalization = { historyRepository: history, settingsRepository }
  const cancellation = new DownloadTaskCancellationCoordinator(
    queue,
    native,
    finalization
  )
  const rules = new SiteIntegrationSessionRuleManager({
    service: enablement,
    awaitSchemaMigration: () => kernel.ensureSchemaMigrated(),
    onReconciliationSucceeded: async () => undefined,
  })
  const policy = new ProviderPolicyQueueCoordinator(
    queue,
    native,
    cancellation,
    rules.continuationCoordinator
  )
  const dispatch = new ChapterDispatchCoordinator(
    queue,
    runOffscreenDocumentAdmissionExclusive,
    cancellation,
    rules,
    enablement,
    new SiteIntegrationSettingsService()
  )
  const executor = new DownloadTaskExecutor(
    queue,
    ensureOffscreenDocumentReady,
    cancellation,
    policy,
    dispatch,
    rules,
    new DestinationService(),
    enablement,
    finalization
  )
  const scheduler = new QueueScheduler(queue, executor, async () => undefined)
  const terminal = new OffscreenJobTerminalCoordinator(
    queue,
    native,
    scheduler,
    finalization
  )
  const cache = createTabContextCache()
  const state = new TabContextStateService(cache)
  const kernel: BackgroundRuntimeKernel = new BackgroundRuntimeKernel({
    settingsRepository,
    siteIntegrationEnablementService: enablement,
    tabContextStateService: state,
    queueRepository: queue,
    historyRepository: history,
    nativeOutputCoordinator: native,
    terminalCoordinator: terminal,
    ensureLivenessAlarm,
    setLivenessAlarmArmed,
    queueScheduler: scheduler,
    awaitSchemaMigration: migrateDurableStateForCurrentSchema,
  })
  const deps = {
    queueRepository: queue,
    nativeOutputCoordinator: native,
    terminalCoordinator: terminal,
    settingsRepository,
    siteIntegrationEnablementService: enablement,
  } as BackgroundRuntimeHandlerDependencies
  const backgroundHandlers = {
    ...createBackgroundOffscreenEventMessageHandlers(deps),
    ...createBackgroundSettingsUiMessageHandlers(deps),
  } as RuntimeMessageHandlerMap<"background">
  kernel.markControlReady()
  await kernel.ensure("runtime-ready")
  registerBackgroundRuntimeListeners({
    waitForReadiness: (phase) => kernel.ensure(phase),
    getTabContextStateService: () => kernel.getTabContextStateService(),
    queueRepository: queue,
    nativeOutputCoordinator: native,
    queueScheduler: scheduler,
    terminalCoordinator: terminal,
    providerPolicyQueueCoordinator: policy,
    tabContextCache: cache,
    ensureLivenessAlarm,
    livenessAlarmName: LIVENESS_ALARM_NAME,
    settingsRepository,
  })
  documentExists = true
  await worker.initialize()
  const task: DownloadTaskState = {
    id: "cancel-task",
    siteIntegrationId: "mycomic",
    mangaId: "123",
    seriesTitle: "Series",
    chapters: [
      {
        id: "492177",
        url: "https://mycomic.com/chapters/492177",
        title: "Chapter 1",
        index: 1,
        requestedPath: "Tako/Chapter",
        status: "queued",
        lastUpdated: Date.now(),
      },
    ],
    status: "queued",
    created: Date.now(),
    settingsSnapshot: createTaskSettingsSnapshot(settings, "mycomic"),
  }
  expect((await queue.enqueueDownloadTask(task)).outcome).toBe("applied")
  expect(await executor.execute(task.id)).toBe("active")
  await vi.waitFor(() => expect(blockedProgress).toBe(true), {
    interval: 1,
    timeout: 2_000,
  })
  const lease = (await queue.getActiveDispatchLease())!
  expect(await nativeRepository.getManifest(lease.jobId)).toMatchObject({
    phase: "open",
    outputsRequested: 2,
  })
  expect(
    worker.getJobState({
      ...lease,
      documentInstanceId: lease.documentInstanceId!,
    })
  ).toMatchObject({ status: "active" })

  async function alarm() {
    alarmQueries = 0
    firingAlarm = Promise.withResolvers<void>()
    const value = alarms.get(LIVENESS_ALARM_NAME)!
    expect(value).toBeDefined()
    alarms.delete(LIVENESS_ALARM_NAME)
    onAlarm.listeners[0](value)
    await firingAlarm.promise
    firingAlarm = undefined
  }
  async function expire() {
    await vi.advanceTimersByTimeAsync(OFFSCREEN_HEARTBEAT_INTERVAL_MS)
    const current = (await queue.getActiveDispatchLease())!
    await vi.advanceTimersByTimeAsync(
      Math.max(0, current.leaseExpiresAt - Date.now() + 1)
    )
  }
  async function cleanup() {
    cancelFailures = 0
    const current = await queue.getActiveDispatchLease()
    if (current) {
      const stopped = await cancellation.cancelProducerAndClearLease(current)
      if (stopped) await native.cancelTask(task.id, stopped)
    }
    contextsGate.resolve([{ documentId: browserDocumentId }])
    await vi.advanceTimersByTimeAsync(1)
    for (const item of downloads)
      Object.assign(item, {
        state: "complete",
        endTime: new Date().toISOString(),
        bytesReceived: 100,
      })
    await terminal.continueAfterNativeOutputSettlement(await native.reconcile())
    await clearActiveTaskProgress()
    await dom.happyDOM.abort()
  }
  return {
    task,
    worker,
    lease,
    queue,
    nativeRepository,
    history,
    cancellation,
    cancellations,
    messages,
    alarm,
    expire,
    cleanup,
    failNextCancel: () => {
      cancelFailures = 1
    },
    releaseProgress: () =>
      contextsGate.resolve([{ documentId: browserDocumentId }]),
  }
}

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("native producer cancellation recovery", () => {
  it("keeps an authorized active producer and renews its expired lease", async () => {
    const runtime = await fixture()
    try {
      await runtime.expire()
      await runtime.alarm()
      expect(runtime.cancellations).toHaveLength(0)
      expect(await runtime.queue.getTask(runtime.task.id)).toMatchObject({
        status: "downloading",
      })
      expect(await runtime.queue.getActiveDispatchLease()).toMatchObject({
        jobId: runtime.lease.jobId,
        leaseExpiresAt: expect.any(Number),
      })
      expect(
        (await runtime.queue.getActiveDispatchLease())!.leaseExpiresAt
      ).toBeGreaterThan(Date.now())
    } finally {
      await runtime.cleanup()
    }
  })

  it("retries a canceled open producer on the next alarm while retaining its lease until stop confirmation", async () => {
    const runtime = await fixture()
    try {
      runtime.failNextCancel()
      expect(
        await runtime.cancellation.cancelTask(runtime.task.id, "cancel-command")
      ).toMatchObject({ queueCanContinue: false })
      expect(await runtime.queue.getTask(runtime.task.id)).toMatchObject({
        status: "canceled",
      })
      expect(await runtime.queue.getActiveDispatchLease()).toMatchObject({
        jobId: runtime.lease.jobId,
      })
      await runtime.expire()
      await runtime.alarm()
      expect(runtime.cancellations).toHaveLength(2)
      expect(runtime.cancellations[1]).toMatchObject({
        delivered: true,
        leaseJobId: runtime.lease.jobId,
      })
      expect(
        runtime.worker.getJobState({
          ...runtime.lease,
          documentInstanceId: runtime.lease.documentInstanceId!,
        })
      ).toMatchObject({ status: "canceled" })
      expect(await runtime.queue.getActiveDispatchLease()).toBeNull()
      const [output] = Object.values(
        (await runtime.nativeRepository.snapshot()).outputsByOutputId
      )
      expect(output.phase).toBe("waiting")
      expect(output.blobReleasedAt).toBeUndefined()
      expect(output.dependencyReleasedAt).toBeUndefined()
      expect(await runtime.nativeRepository.hasLiveDependencies()).toBe(true)
      expect(await runtime.history.getDownloadedChapters()).toEqual([])
    } finally {
      await runtime.cleanup()
    }
  })

  it("lets a healthy rejected event self-stop the producer before liveness cleanup", async () => {
    const runtime = await fixture()
    try {
      runtime.failNextCancel()
      await runtime.cancellation.cancelTask(runtime.task.id, "cancel-command")
      runtime.releaseProgress()
      await vi.advanceTimersByTimeAsync(1)
      expect(
        runtime.worker.getJobState({
          ...runtime.lease,
          documentInstanceId: runtime.lease.documentInstanceId!,
        })
      ).toMatchObject({ status: "canceled" })
      expect(await runtime.queue.getActiveDispatchLease()).toMatchObject({
        jobId: runtime.lease.jobId,
      })
      await runtime.expire()
      await runtime.alarm()
      expect(await runtime.queue.getActiveDispatchLease()).toBeNull()
    } finally {
      await runtime.cleanup()
    }
  })

  it("releases a canceled producer's lease after a delivered exact stop acknowledgment", async () => {
    const runtime = await fixture()
    try {
      runtime.failNextCancel()
      await runtime.cancellation.cancelTask(runtime.task.id, "cancel-command")
      expect(await runtime.queue.getActiveDispatchLease()).toMatchObject({
        jobId: runtime.lease.jobId,
      })
      await expect(
        runtime.cancellation.cancelTask(runtime.task.id, "cancel-command")
      ).resolves.toMatchObject({ queueCanContinue: true })
      expect(runtime.cancellations).toEqual([
        expect.objectContaining({
          delivered: false,
          leaseJobId: runtime.lease.jobId,
        }),
        expect.objectContaining({
          delivered: true,
          leaseJobId: runtime.lease.jobId,
        }),
      ])
      expect(
        runtime.worker.getJobState({
          ...runtime.lease,
          documentInstanceId: runtime.lease.documentInstanceId!,
        })
      ).toMatchObject({ status: "canceled" })
      expect(await runtime.queue.getActiveDispatchLease()).toBeNull()
      expect(
        await runtime.nativeRepository.getManifest(runtime.lease.jobId)
      ).toMatchObject({ phase: "sealed" })
      expect(await runtime.nativeRepository.hasLiveDependencies()).toBe(true)
    } finally {
      await runtime.cleanup()
    }
  })

  it("retains the canceled producer's lease and outputs when the watchdog stop attempt is unconfirmed", async () => {
    const runtime = await fixture()
    try {
      runtime.failNextCancel()
      await runtime.cancellation.cancelTask(runtime.task.id, "cancel-command")
      runtime.failNextCancel()
      await runtime.expire()
      await runtime.alarm()
      expect(runtime.cancellations).toHaveLength(2)
      expect(runtime.cancellations[1]).toMatchObject({
        delivered: false,
        leaseJobId: runtime.lease.jobId,
      })
      expect(await runtime.queue.getActiveDispatchLease()).toEqual(
        runtime.lease
      )
      expect(
        runtime.worker.getJobState({
          ...runtime.lease,
          documentInstanceId: runtime.lease.documentInstanceId!,
        })
      ).toMatchObject({ status: "active" })
      expect(
        await runtime.nativeRepository.getManifest(runtime.lease.jobId)
      ).toMatchObject({ phase: "open" })
      const [output] = Object.values(
        (await runtime.nativeRepository.snapshot()).outputsByOutputId
      )
      expect(output.phase).toBe("waiting")
      expect(output.blobReleasedAt).toBeUndefined()
      expect(output.dependencyReleasedAt).toBeUndefined()
      expect(await runtime.history.getDownloadedChapters()).toEqual([])
    } finally {
      await runtime.cleanup()
    }
  })
})
