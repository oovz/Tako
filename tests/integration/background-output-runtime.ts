import { Window } from "happy-dom"
import { expect, vi } from "vitest"
import { registerBackgroundRuntimeListeners } from "@/entrypoints/background/background-runtime-listeners"
import { BackgroundRuntimeKernel } from "@/entrypoints/background/background-runtime-kernel"
import { createBackgroundOffscreenEventMessageHandlers } from "@/entrypoints/background/background-offscreen-event-message-handlers"
import { createBackgroundSettingsUiMessageHandlers } from "@/entrypoints/background/background-settings-ui-message-handlers"
import type { BackgroundRuntimeHandlerDependencies } from "@/entrypoints/background/background-runtime-handler-dependencies"
import { DownloadTaskCancellationCoordinator } from "@/entrypoints/background/download-task-cancellation-coordinator"
import { DownloadTaskExecutor } from "@/entrypoints/background/download-task-executor"
import { ChapterDispatchCoordinator } from "@/entrypoints/background/chapter-dispatch-coordinator"
import { createChapterDispatchMessage } from "@/entrypoints/background/chapter-dispatch-coordinator-context"
import { resolveDownloadPlan } from "@/entrypoints/background/queue-helpers"
import { createDispatchLease } from "@/src/runtime/dispatch-lease"
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
  refreshLivenessAlarmForDurableWork,
  scheduleOffscreenCloseIfIdle,
} from "@/entrypoints/background/offscreen-lifecycle"
import { OffscreenWorker } from "@/entrypoints/offscreen/main-worker"
import { createOffscreenRuntimeMessageHandlers } from "@/entrypoints/offscreen/offscreen-runtime-message-handlers"
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
let disposeCurrent: (() => Promise<void>) | undefined

export async function disposeBackgroundOutputRuntime(): Promise<void> {
  try {
    await disposeCurrent?.()
  } finally {
    disposeCurrent = undefined
  }
}

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

export async function backgroundOutputRuntime(
  initialQueue: Array<{ id: string; integrationId?: string }> = []
) {
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
  const notificationGate = Promise.withResolvers<string>()
  const notifications: string[] = []
  let holdNotifications = false
  let holdNextProgress = false
  let closedDocuments = 0
  let installedRules: chrome.declarativeNetRequest.Rule[] = []
  let blockedProgress = false
  let browserDocumentId = crypto.randomUUID()
  let blockNextContextLookup = false
  let blockProgressAfterOutput = false
  let documentExists = false
  let cancelFailures = 0
  const cancellations: Array<{
    at: number
    delivered: boolean
    leaseJobId: string | undefined
  }> = []
  const messages: string[] = []
  const dispatches: Array<
    RuntimeMessage & { type: "OFFSCREEN_DOWNLOAD_CHAPTER" }
  > = []
  const downloads: chrome.downloads.DownloadItem[] = []
  let worker = new OffscreenWorker()
  let offscreenHandlers = createOffscreenRuntimeMessageHandlers(
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
            (blockProgressAfterOutput || holdNextProgress)
          ) {
            blockProgressAfterOutput = false
            holdNextProgress = false
            blockNextContextLookup = true
          }
          const response = await dispatchRuntimeMessage(
            message,
            { ...sender, documentId: browserDocumentId },
            {
              target: "background",
              handlers: backgroundHandlers,
              classifySender,
              waitForReadiness: (phase) => kernel.ensure(phase),
            }
          )
          return response
        }
        if (message.type === "OFFSCREEN_DOWNLOAD_CHAPTER")
          dispatches.push(structuredClone(message))
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
        return response
      },
    },
    offscreen: {
      hasDocument: async () => documentExists,
      createDocument: async () => {
        if (closedDocuments > 0) {
          worker = new OffscreenWorker()
          offscreenHandlers = createOffscreenRuntimeMessageHandlers(
            worker,
            () => "ready"
          )
          browserDocumentId = crypto.randomUUID()
          await worker.initialize()
        }
        documentExists = true
      },
      closeDocument: async () => {
        documentExists = false
        closedDocuments += 1
      },
      Reason: { BLOBS: "BLOBS", WORKERS: "WORKERS", DOM_PARSER: "DOM_PARSER" },
    },
    alarms: {
      onAlarm,
      get: async (name: string) => alarms.get(name),
      clear: async (name: string) => alarms.delete(name),
      create: async (name: string, info: chrome.alarms.AlarmCreateInfo) => {
        alarms.set(name, {
          name,
          scheduledTime: Date.now() + (info.delayInMinutes ?? 0) * 60_000,
          periodInMinutes: info.periodInMinutes,
          persistAcrossSessions: info.persistAcrossSessions ?? true,
        })
      },
    },
    notifications: {
      create: async (id: string) => {
        notifications.push(id)
        return holdNotifications ? await notificationGate.promise : id
      },
      onClicked: browserEvent(),
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
          id: 42 + downloads.length,
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
        return downloads.at(-1)!.id
      },
      search: async () => structuredClone(downloads),
    },
    declarativeNetRequest: {
      getSessionRules: async () => structuredClone(installedRules),
      updateSessionRules: async (update: {
        removeRuleIds?: number[]
        addRules?: chrome.declarativeNetRequest.Rule[]
      }) => {
        installedRules = installedRules.filter(
          (rule) => !update.removeRuleIds?.includes(rule.id)
        )
        for (const rule of update.addRules ?? []) {
          if (installedRules.some((current) => current.id === rule.id))
            throw new Error("Duplicate browser session-rule identity")
          installedRules.push(structuredClone(rule))
        }
      },
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
    onReconciliationSucceeded: async (enablement) => {
      try {
        await kernel.ensure("runtime-ready")
        if (await policy.failDisabledTasks(enablement))
          await scheduler.activate()
        if (await policy.resumeBlockedQueue()) await scheduler.activate()
      } catch (error) {
        await ensureLivenessAlarm()
        throw error
      }
    },
  })
  const policy = new ProviderPolicyQueueCoordinator(
    queue,
    native,
    cancellation,
    rules.continuationCoordinator
  )
  const siteSettings = new SiteIntegrationSettingsService()
  const dispatch = new ChapterDispatchCoordinator(
    queue,
    runOffscreenDocumentAdmissionExclusive,
    cancellation,
    rules,
    enablement,
    siteSettings
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
  const scheduler = new QueueScheduler(queue, executor, async () => {
    await scheduleOffscreenCloseIfIdle(queue, native)
    await refreshLivenessAlarmForDurableWork(queue, native)
  })
  const terminal = new OffscreenJobTerminalCoordinator(
    queue,
    native,
    scheduler,
    finalization
  )
  const cache = createTabContextCache()
  const state = new TabContextStateService(cache)
  function createKernel(): BackgroundRuntimeKernel {
    return new BackgroundRuntimeKernel({
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
  }
  const kernel = createKernel()
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
  let cleanupPromise: Promise<void> | undefined
  disposeCurrent = () => (cleanupPromise ??= cleanup())
  kernel.markControlReady()
  for (const item of initialQueue) await enqueue(item.id, item.integrationId)
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
  function task(
    id: string,
    integrationId = "mycomic",
    chapterIds = integrationId === "mangadex"
      ? ["22222222-2222-4222-8222-222222222222"]
      : ["492177"]
  ): DownloadTaskState {
    return {
      id,
      siteIntegrationId: integrationId,
      mangaId:
        integrationId === "mangadex"
          ? "33333333-3333-4333-8333-333333333333"
          : "123",
      seriesTitle: "Series",
      created: Date.now(),
      status: "queued",
      chapters: chapterIds.map((chapterId, index) => ({
        id: chapterId,
        url:
          integrationId === "mycomic"
            ? `https://mycomic.com/chapters/${chapterId}`
            : `https://mangadex.org/chapter/${chapterId}`,
        title: `Chapter ${index + 1}`,
        index: index + 1,
        requestedPath: `Tako/Chapter${index + 1}`,
        status: "queued",
        lastUpdated: Date.now(),
      })),
      settingsSnapshot: createTaskSettingsSnapshot(settings, integrationId),
    }
  }
  async function enqueue(
    id: string,
    integrationId = "mycomic",
    chapterIds?: string[]
  ) {
    const value = task(id, integrationId, chapterIds)
    expect((await queue.enqueueDownloadTask(value)).outcome).toBe("applied")
    return value
  }
  async function start(id: string, integrationId = "mycomic") {
    const value = await enqueue(id, integrationId)
    holdNextProgress = true
    expect(await executor.execute(id)).toBe("active")
    await vi.waitFor(() => expect(blockedProgress).toBe(true), {
      interval: 1,
      timeout: 2000,
    })
    const lease = (await queue.getActiveDispatchLease())!
    expect(lease).toMatchObject({
      taskId: id,
      documentInstanceId: worker.documentInstanceId,
    })
    return { task: value, lease }
  }

  async function admitUnbound(id: string) {
    await enqueue(id)
    const started = await queue.startDownloadTask({
      taskId: id,
      now: Date.now(),
    })
    expect(started.outcome).toBe("applied")
    const value = (await queue.getTask(id))!
    const plan = await resolveDownloadPlan(value)
    const chapter = plan.chapters[0]
    const identity = {
      jobId: crypto.randomUUID(),
      taskId: id,
      chapterId: chapter.id,
      attempt: (value.chapters[0].dispatchAttempt ?? 0) + 1,
    }
    const message = await createChapterDispatchMessage(
      {
        plan,
        chapter,
        taskChapter: value.chapters[0],
        latestTask: value,
        destination: value.settingsSnapshot.destination,
        saveMode: "downloads-api",
      },
      { identity },
      value.settingsSnapshot,
      siteSettings
    )
    const lease = createDispatchLease({
      ...identity,
      fingerprint: message.payload.fingerprint,
      saveMode: "downloads-api",
    })
    expect(
      (
        await queue.beginChapterDispatch({
          taskId: id,
          chapterId: chapter.id,
          lease,
          expectedPreviousLease: null,
          now: Date.now(),
        })
      ).outcome
    ).toBe("applied")
    return { lease, message }
  }

  async function alarm() {
    const value = alarms.get(LIVENESS_ALARM_NAME)
    expect(value).toBeDefined()
    await vi.advanceTimersByTimeAsync(
      Math.max(0, value!.scheduledTime - Date.now())
    )
    alarms.delete(LIVENESS_ALARM_NAME)
    onAlarm.listeners[0](value!)
    await vi.advanceTimersByTimeAsync(1)
  }
  async function expire() {
    const current = (await queue.getActiveDispatchLease())!
    await vi.advanceTimersByTimeAsync(
      Math.max(0, current.leaseExpiresAt - Date.now() + 1)
    )
  }
  async function cleanup() {
    cancelFailures = 0
    for (const task of await queue.getQueue()) {
      if (task.status === "queued" || task.status === "downloading")
        await cancellation.cancelTask(task.id, crypto.randomUUID())
    }
    const current = await queue.getActiveDispatchLease()
    if (current) {
      const stopped = await cancellation.cancelProducerAndClearLease(current)
      if (stopped) await native.cancelTask(current.taskId, stopped)
    }
    notificationGate.resolve("notification")
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
    settings,
    settingsRepository,
    local,
    session,
    get worker() {
      return worker
    },
    queue,
    native,
    nativeRepository,
    history,
    cancellation,
    terminal,
    scheduler,
    kernel,
    executor,
    createKernel,
    siteSettings,
    enablement,
    cancellations,
    messages,
    dispatches,
    alarms,
    notifications,
    alarm,
    expire,
    cleanup,
    enqueue,
    start,
    admitUnbound,
    holdNotifications: () => {
      holdNotifications = true
    },
    releaseNotifications: () => notificationGate.resolve("notification"),
    holdProgress: () => {
      holdNextProgress = true
    },
    holdProgressAfterOutput: () => {
      blockProgressAfterOutput = true
    },
    failNextCancel: () => {
      cancelFailures = 1
    },
    closeCount: () => closedDocuments,
    documentPresent: () => documentExists,
    releaseProgress: () =>
      contextsGate.resolve([{ documentId: browserDocumentId }]),
  }
}

export type BackgroundOutputRuntime = Awaited<
  ReturnType<typeof backgroundOutputRuntime>
>
