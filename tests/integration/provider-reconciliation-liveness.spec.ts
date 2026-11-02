import { Window } from "happy-dom"
import { afterEach, describe, expect, it, vi } from "vitest"
import type {
  ActiveDispatchLease,
  DownloadTaskState,
} from "@/src/domain/queue/state"
import type { RuntimeMessage } from "@/src/runtime/runtime-message-contracts"
import type { RuntimeMessageListener } from "@/src/runtime/runtime-message-dispatcher"
import type { OffscreenJobIncarnation } from "@/src/runtime/offscreen-job-contracts"
// Transform packaged provider dependencies before entering a timed browser
// fixture. resetModules still gives each fixture fresh application state.
import "@/entrypoints/offscreen/main-worker"
import "@/src/runtime/background-site-integration-initialization"
import "@/entrypoints/background/background-runtime-kernel"
import "@/entrypoints/background/background-runtime-message-handlers"
import "@/entrypoints/background/background-navigation-listeners"
import "@/entrypoints/background/offscreen-lifecycle"
import "@/src/site-integrations/session-rule-manager"
import "@/src/runtime/state-schema-migration"

const extensionId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
const browserDocumentId = "11111111-1111-4111-8111-111111111111"
const activeTaskId = "active-fsa-task"
const siblingTaskId = "queued-provider-task"
const selectedFolderId = "selected-folder"
let cleanupCurrentFixture: (() => Promise<void>) | undefined

function browserEvent<T extends (...args: never[]) => unknown>() {
  const listeners: T[] = []
  return {
    listeners,
    addListener: (listener: T) => listeners.push(listener),
  }
}

function directoryDatabase() {
  const directory = {
    kind: "directory",
    name: "Selected folder",
    queryPermission: async () => "granted",
    async *entries() {},
  }
  const stores = new Map<string, Map<string, unknown>>([
    ["handles", new Map([[selectedFolderId, directory]])],
    ["managed-handles", new Map([[selectedFolderId, true]])],
  ])

  return {
    open: () => {
      const request: {
        result?: unknown
        onsuccess?: () => void
        onupgradeneeded?: () => void
      } = {}
      queueMicrotask(() => {
        request.result = {
          objectStoreNames: { contains: (name: string) => stores.has(name) },
          close: () => undefined,
          transaction: () => {
            const transaction: {
              oncomplete?: () => void
              objectStore?: (name: string) => unknown
            } = {}
            transaction.objectStore = (name: string) => {
              const store = stores.get(name)!
              const operation = (work: () => unknown) => {
                const pending: { result?: unknown; onsuccess?: () => void } = {}
                queueMicrotask(() => {
                  pending.result = work()
                  pending.onsuccess?.()
                  queueMicrotask(() => transaction.oncomplete?.())
                })
                return pending
              }
              return {
                get: (key: string) => operation(() => store.get(key)),
                getAllKeys: () => operation(() => [...store.keys()]),
                put: (value: unknown, key: string) =>
                  operation(() => {
                    store.set(key, value)
                    return key
                  }),
                delete: (key: string) => operation(() => store.delete(key)),
              }
            }
            return transaction
          },
        }
        request.onsuccess?.()
      })
      return request
    },
  }
}

async function fixture() {
  vi.resetModules()
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-10-30T10:00:00Z"))
  const dom = new Window()
  const lifetime = new AbortController()
  const runtimeDisposal: { run?: () => Promise<void> } = {}
  let cleanupPromise: Promise<void> | undefined
  const cleanup = () =>
    (cleanupPromise ??= (async () => {
      lifetime.abort(new Error("Browser fixture disposed"))
      try {
        await runtimeDisposal.run?.()
      } finally {
        await dom.happyDOM.abort()
      }
    })())
  cleanupCurrentFixture = cleanup
  vi.stubGlobal("DOMParser", dom.DOMParser)
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    throw new Error(
      `Unexpected network request before producer release: ${input}`
    )
  })
  vi.stubGlobal("indexedDB", directoryDatabase())
  vi.stubGlobal("__TAKO_E2E_STATE_SEED__", false)

  const [
    { DEFAULT_SETTINGS },
    { getDefinitions },
    { siteIntegrationWxtPermissions },
    { createTaskSettingsSnapshot },
    { CURRENT_STATE_SCHEMA_EPOCH },
    { LIVENESS_ALARM_NAME },
    { createCommandEnvelope },
    { sendRuntimeMessage },
  ] = await Promise.all([
    import("@/src/domain/settings/defaults"),
    import("@/src/site-integrations/catalog"),
    import("@/src/runtime/generated/site-integration-wxt-permissions"),
    import("@/src/runtime/settings-snapshot"),
    import("@/src/runtime/state-schema-migration"),
    import("@/entrypoints/background/offscreen-lifecycle"),
    import("@/src/runtime/command-envelope"),
    import("@/src/runtime/send-runtime-message"),
  ])
  lifetime.signal.throwIfAborted()
  const settings = structuredClone(DEFAULT_SETTINGS)
  settings.notifications = false
  settings.downloads.destination = "file-system-access"
  settings.downloads.customDirectoryHandleId = selectedFolderId
  settings.downloads.defaultFormat = "none"
  settings.downloads.includeComicInfo = false
  settings.downloads.includeCoverImage = false
  settings.globalPolicy.image = { concurrency: 1, delayMs: 0 }
  settings.globalPolicy.chapter = { concurrency: 1, delayMs: 0 }

  function task(id: string, integrationId: string): DownloadTaskState {
    return {
      id,
      siteIntegrationId: integrationId,
      mangaId: "123",
      seriesTitle: "Series",
      created: Date.now(),
      status: "queued",
      chapters: [
        {
          id: integrationId === "mycomic" ? "492177" : "chapter-id",
          title: "Chapter 1",
          url:
            integrationId === "mycomic"
              ? "https://mycomic.com/chapters/492177"
              : "https://mangadex.org/chapter/chapter-id",
          index: 1,
          requestedPath: "Series/Chapter",
          status: "queued",
          lastUpdated: Date.now(),
        },
      ],
      settingsSnapshot: createTaskSettingsSnapshot(settings, integrationId),
    }
  }
  const local: Record<string, unknown> = {
    stateSchemaEpoch: CURRENT_STATE_SCHEMA_EPOCH,
    "settings:global": settings,
    siteIntegrationEnablement: {
      ...Object.fromEntries(
        getDefinitions().map((definition) => [definition.id, false])
      ),
      mycomic: true,
      mangadex: true,
    },
    downloadQueue: [
      task(activeTaskId, "mycomic"),
      task(siblingTaskId, "mangadex"),
    ],
    activeDispatchLease: null,
    pendingUndoActions: [],
  }
  const session: Record<string, unknown> = {}
  const onStorageChanged =
    browserEvent<
      (
        changes: Record<string, chrome.storage.StorageChange>,
        area: chrome.storage.AreaName
      ) => void
    >()
  const onAlarm = browserEvent<(alarm: chrome.alarms.Alarm) => void>()
  const onPermissionRemoved =
    browserEvent<(permissions: chrome.permissions.Permissions) => void>()
  const onMessage = browserEvent<RuntimeMessageListener>()
  const alarms = new Map<string, chrome.alarms.Alarm>()
  const contexts = Promise.withResolvers<Array<{ documentId: string }>>()
  let documentExists = false
  let broadPermissionGranted = true
  let blockContextForProgress = false
  let blockedProgress = false
  let failCancel = false
  let watchingProviderChange = false
  let providerChangeFinished = false
  let offscreenInitialization: Promise<void> = Promise.resolve()
  let offscreenInitializationState: "initializing" | "ready" = "initializing"
  let installedRules: chrome.declarativeNetRequest.Rule[] = []
  const dispatchedJobs = new Map<string, OffscreenJobIncarnation>()
  const cancellationReplies: Array<{
    delivered: boolean
    status?: string
    leaseJobId?: string
  }> = []
  const alarmTrace: Array<{
    action: string
    name: string
    retainedLease: boolean
  }> = []

  const queueTask = (id: string) =>
    (local.downloadQueue as DownloadTaskState[]).find(
      (value) => value.id === id
    )
  const lease = () => local.activeDispatchLease as ActiveDispatchLease | null
  const emitChanges = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: chrome.storage.AreaName
  ) => {
    if (Object.keys(changes).length === 0) return
    queueMicrotask(() => {
      for (const listener of onStorageChanged.listeners) listener(changes, area)
    })
  }
  function storageArea(
    values: Record<string, unknown>,
    area: "local" | "session"
  ) {
    return {
      get: async (keys: string | string[] | null = null) => {
        const requested = keys === null ? Object.keys(values) : [keys].flat()
        return Object.fromEntries(
          requested
            .filter((key) => key in values)
            .map((key) => [key, structuredClone(values[key])])
        )
      },
      set: async (next: Record<string, unknown>) => {
        const changes: Record<string, chrome.storage.StorageChange> = {}
        for (const [key, value] of Object.entries(next)) {
          if (JSON.stringify(values[key]) === JSON.stringify(value)) continue
          changes[key] = {
            oldValue: structuredClone(values[key]),
            newValue: structuredClone(value),
          }
          values[key] = structuredClone(value)
        }
        emitChanges(changes, area)
      },
      remove: async (keys: string | string[]) => {
        const changes: Record<string, chrome.storage.StorageChange> = {}
        for (const key of [keys].flat()) {
          if (!(key in values)) continue
          changes[key] = { oldValue: structuredClone(values[key]) }
          delete values[key]
        }
        emitChanges(changes, area)
        if (
          area === "session" &&
          watchingProviderChange &&
          queueTask(siblingTaskId)?.status === "failed" &&
          [keys]
            .flat()
            .some((key) => key.includes("providerNetworkPolicyContinuation"))
        )
          providerChangeFinished = true
      },
      setAccessLevel: async () => undefined,
    }
  }

  const offscreenSender = {
    id: extensionId,
    url: `chrome-extension://${extensionId}/offscreen.html`,
    documentId: browserDocumentId,
  }
  const sidepanelSender = {
    id: extensionId,
    url: `chrome-extension://${extensionId}/sidepanel.html`,
  }
  vi.stubGlobal("chrome", {
    storage: {
      local: storageArea(local, "local"),
      session: storageArea(session, "session"),
      onChanged: onStorageChanged,
    },
    runtime: {
      id: extensionId,
      getURL: (path: string) => `chrome-extension://${extensionId}/${path}`,
      getManifest: () => ({
        host_permissions: siteIntegrationWxtPermissions.requiredOrigins,
        optional_host_permissions:
          siteIntegrationWxtPermissions.optionalOrigins,
      }),
      onMessage,
      onConnect: browserEvent(),
      onUpdateAvailable: browserEvent(),
      getContexts: async () => {
        if (blockContextForProgress) {
          blockContextForProgress = false
          blockedProgress = true
          return contexts.promise
        }
        return documentExists ? [{ documentId: browserDocumentId }] : []
      },
      sendMessage: async (message: RuntimeMessage) => {
        if (message.target === "offscreen") {
          if (message.type === "OFFSCREEN_DOWNLOAD_CHAPTER") {
            const { payload } = message
            dispatchedJobs.set(payload.jobId, {
              jobId: payload.jobId,
              attempt: payload.attempt,
              taskId: payload.taskId,
              chapterId: payload.chapter.id,
              fingerprint: payload.fingerprint,
              documentInstanceId: worker.documentInstanceId,
            })
          }
          if (message.type === "OFFSCREEN_CANCEL_JOB" && failCancel) {
            failCancel = false
            cancellationReplies.push({
              delivered: false,
              leaseJobId: lease()?.jobId,
            })
            throw new Error("Cooperative cancellation transport unavailable")
          }
          const response = await dispatchOffscreen(message)
          if (message.type === "OFFSCREEN_CANCEL_JOB")
            cancellationReplies.push({
              delivered: true,
              status: worker.getJobState(message.payload)?.status,
              leaseJobId: lease()?.jobId,
            })
          return response
        }
        if (message.type === "OFFSCREEN_DOWNLOAD_PROGRESS" && !blockedProgress)
          blockContextForProgress = true
        const sender =
          message.type.startsWith("OFFSCREEN_") ||
          message.type === "GET_SITE_INTEGRATION_ENABLEMENT"
            ? offscreenSender
            : sidepanelSender
        return await new Promise((resolve, reject) => {
          if (
            !onMessage.listeners.some((listener) =>
              listener(message, sender, resolve)
            )
          )
            reject(new Error(`No registered listener claimed ${message.type}`))
        })
      },
    },
    offscreen: {
      hasDocument: async () => documentExists,
      createDocument: async () => {
        documentExists = true
        offscreenInitialization = worker.initialize().then(() => {
          offscreenInitializationState = "ready"
        })
        await offscreenInitialization
      },
      closeDocument: async () => {
        documentExists = false
      },
      Reason: { BLOBS: "BLOBS", WORKERS: "WORKERS", DOM_PARSER: "DOM_PARSER" },
    },
    alarms: {
      onAlarm,
      get: async (name: string) => alarms.get(name),
      clear: async (name: string) => {
        alarmTrace.push({
          action: "clear",
          name,
          retainedLease: lease() !== null,
        })
        return alarms.delete(name)
      },
      create: async (name: string, info: chrome.alarms.AlarmCreateInfo) => {
        alarmTrace.push({
          action: "create",
          name,
          retainedLease: lease() !== null,
        })
        alarms.set(name, {
          name,
          scheduledTime: Date.now() + (info.delayInMinutes ?? 0) * 60_000,
          periodInMinutes: info.periodInMinutes,
          persistAcrossSessions: info.persistAcrossSessions ?? true,
        })
      },
    },
    permissions: {
      contains: async (permissions: chrome.permissions.Permissions) =>
        broadPermissionGranted || !permissions.origins?.includes("https://*/*"),
      getAll: async () => ({
        origins: [
          ...siteIntegrationWxtPermissions.requiredOrigins,
          ...(broadPermissionGranted ? ["https://*/*"] : []),
        ],
      }),
      remove: async () => false,
      onAdded: browserEvent(),
      onRemoved: onPermissionRemoved,
    },
    tabs: {
      query: async () => [],
      onRemoved: browserEvent(),
      onReplaced: browserEvent(),
      onActivated: browserEvent(),
      onUpdated: browserEvent(),
    },
    windows: {
      getLastFocused: async () => ({ id: 1 }),
      getAll: async () => [],
    },
    webNavigation: {
      onDOMContentLoaded: browserEvent(),
      onCommitted: browserEvent(),
      onHistoryStateUpdated: browserEvent(),
    },
    sidePanel: {
      setPanelBehavior: async () => undefined,
      setOptions: async () => undefined,
    },
    notifications: {
      onClicked: browserEvent(),
      create: async () => "notification",
    },
    action: {
      setBadgeText: async () => undefined,
      setBadgeBackgroundColor: async () => undefined,
      setIcon: async () => undefined,
      setTitle: async () => undefined,
    },
    i18n: { getUILanguage: () => "en", getMessage: (key: string) => key },
    downloads: {
      onChanged: browserEvent(),
      onErased: browserEvent(),
      search: async () => [],
    },
    declarativeNetRequest: {
      getSessionRules: async () => structuredClone(installedRules),
      updateSessionRules: async (options: {
        removeRuleIds?: number[]
        addRules?: chrome.declarativeNetRequest.Rule[]
      }) => {
        installedRules = installedRules.filter(
          (rule) => !options.removeRuleIds?.includes(rule.id)
        )
        for (const rule of options.addRules ?? []) {
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

  const [
    { OffscreenWorker },
    { createOffscreenRuntimeMessageHandlers },
    { dispatchRuntimeMessage },
    { classifyRuntimeMessagePrincipal },
  ] = await Promise.all([
    import("@/entrypoints/offscreen/main-worker"),
    import("@/entrypoints/offscreen/offscreen-runtime-message-handlers"),
    import("@/src/runtime/runtime-message-dispatcher"),
    import("@/src/runtime/runtime-message-sender"),
  ])
  lifetime.signal.throwIfAborted()
  const worker = new OffscreenWorker()
  const handlers = createOffscreenRuntimeMessageHandlers(
    worker,
    () => offscreenInitializationState
  )
  const dispatchOffscreen = (message: RuntimeMessage) =>
    dispatchRuntimeMessage(
      message,
      { id: extensionId },
      {
        target: "offscreen",
        handlers,
        classifySender: (sender) =>
          classifyRuntimeMessagePrincipal(sender, extensionId),
        waitForReadiness: async () => {
          await offscreenInitialization
        },
      }
    )
  runtimeDisposal.run = teardownRuntime
  const { default: background } = await import("@/entrypoints/background/index")
  lifetime.signal.throwIfAborted()
  background.main()
  await vi.waitFor(
    () => {
      expect(blockedProgress).toBe(true)
      expect(lease()).toMatchObject({
        taskId: activeTaskId,
        saveMode: "fsa",
        documentInstanceId: worker.documentInstanceId,
      })
      expect(queueTask(siblingTaskId)?.status).toBe("queued")
      expect(alarms.has(LIVENESS_ALARM_NAME)).toBe(true)
    },
    { interval: 1, timeout: 2_000 }
  )
  lifetime.signal.throwIfAborted()
  const capturedLease = structuredClone(lease()!)

  async function cancel(undelivered: boolean) {
    failCancel = undelivered
    expect(
      await sendRuntimeMessage({
        target: "background",
        type: "CANCEL_TASK",
        ...createCommandEnvelope(),
        payload: { taskId: activeTaskId },
      })
    ).toMatchObject({ success: true })
  }
  async function removeSiblingPermission() {
    watchingProviderChange = true
    broadPermissionGranted = false
    for (const listener of onPermissionRemoved.listeners)
      listener({ origins: ["https://*/*"] })
    await vi.waitFor(
      () => {
        expect(queueTask(siblingTaskId)?.status).toBe("failed")
        expect(
          (local.siteIntegrationEnablement as Record<string, boolean>).mangadex
        ).toBe(false)
        expect(providerChangeFinished).toBe(true)
      },
      { interval: 1, timeout: 2_000 }
    )
  }
  async function fireLiveness() {
    const current = alarms.get(LIVENESS_ALARM_NAME)
    expect(current).toBeDefined()
    alarms.delete(LIVENESS_ALARM_NAME)
    for (const listener of onAlarm.listeners) listener(current!)
    await vi.waitFor(
      () => {
        expect(lease() === null || alarms.has(LIVENESS_ALARM_NAME)).toBe(true)
      },
      { interval: 1, timeout: 2_000 }
    )
  }
  async function nativeSnapshot() {
    const { NativeOutputRepository } =
      await import("@/src/storage/native-output-repository")
    return await new NativeOutputRepository().snapshot()
  }
  async function teardownRuntime() {
    failCancel = false
    try {
      for (const identity of dispatchedJobs.values()) worker.cancelJob(identity)
    } finally {
      contexts.resolve(
        documentExists ? [{ documentId: browserDocumentId }] : []
      )
      await vi.advanceTimersByTimeAsync(1)
    }
  }
  return {
    capturedLease,
    worker,
    queueTask,
    lease,
    alarms,
    alarmTrace,
    cancellationReplies,
    cancel,
    removeSiblingPermission,
    fireLiveness,
    nativeSnapshot,
    cleanup,
    livenessName: LIVENESS_ALARM_NAME,
  }
}

afterEach(async () => {
  try {
    await cleanupCurrentFixture?.()
  } finally {
    cleanupCurrentFixture = undefined
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  }
})

describe("provider reconciliation and retained producer liveness", () => {
  it("keeps recovery armed when disabling a queued sibling leaves an unconfirmed canceled folder producer", async () => {
    const runtime = await fixture()
    try {
      await runtime.cancel(true)
      expect(runtime.queueTask(activeTaskId)?.status).toBe("canceled")
      expect(runtime.lease()).toEqual(runtime.capturedLease)
      await vi.advanceTimersByTimeAsync(30_000)
      await runtime.fireLiveness()
      expect(runtime.cancellationReplies).toHaveLength(1)
      expect(runtime.alarms.has(runtime.livenessName)).toBe(true)

      await runtime.removeSiblingPermission()

      expect(runtime.lease()).toEqual(runtime.capturedLease)
      expect(
        runtime.worker.getJobState({
          ...runtime.capturedLease,
          documentInstanceId: runtime.capturedLease.documentInstanceId!,
        })
      ).toMatchObject({ status: "active" })
      expect(await runtime.nativeSnapshot()).toEqual({
        manifestsByJobId: {},
        outputsByOutputId: {},
      })
      expect(
        runtime.alarms.has(runtime.livenessName),
        JSON.stringify({
          activeTask: runtime.queueTask(activeTaskId)?.status,
          siblingTask: runtime.queueTask(siblingTaskId)?.status,
          lease: runtime.lease(),
          producer: runtime.worker.getJobState({
            ...runtime.capturedLease,
            documentInstanceId: runtime.capturedLease.documentInstanceId!,
          }),
          alarms: [...runtime.alarms.values()],
          alarmTrace: runtime.alarmTrace,
          cancellationReplies: runtime.cancellationReplies,
        })
      ).toBe(true)
    } finally {
      await runtime.cleanup()
    }
  })

  it("retires recovery after a confirmed folder-producer stop and disabled sibling cleanup", async () => {
    const runtime = await fixture()
    try {
      await runtime.removeSiblingPermission()
      expect(runtime.queueTask(activeTaskId)?.status).toBe("downloading")
      expect(runtime.alarms.has(runtime.livenessName)).toBe(true)
      await runtime.cancel(true)
      await vi.advanceTimersByTimeAsync(
        runtime.capturedLease.leaseExpiresAt - Date.now() + 1
      )
      await runtime.fireLiveness()
      await vi.waitFor(
        () => {
          expect(runtime.lease()).toBeNull()
          expect(runtime.alarms.has(runtime.livenessName)).toBe(false)
        },
        { interval: 1, timeout: 2_000 }
      )
      expect(runtime.cancellationReplies).toHaveLength(2)
      expect(runtime.cancellationReplies[1]).toMatchObject({
        delivered: true,
        status: "canceled",
        leaseJobId: runtime.capturedLease.jobId,
      })
      expect(runtime.queueTask(activeTaskId)?.status).toBe("canceled")
      expect(runtime.queueTask(siblingTaskId)?.status).toBe("failed")
      expect(await runtime.nativeSnapshot()).toEqual({
        manifestsByJobId: {},
        outputsByOutputId: {},
      })
    } finally {
      await runtime.cleanup()
    }
  })
})
