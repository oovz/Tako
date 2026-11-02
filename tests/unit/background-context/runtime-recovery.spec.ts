import { beforeEach, describe, expect, it, vi } from "vitest"
import { BackgroundRuntimeKernel } from "@/entrypoints/background/background-runtime-kernel"
import { TabContextStateService } from "@/entrypoints/background/tab-context-state-service"
import { createQueueRepositoryTestHarness } from "@/tests/unit/background/queue-repository-test-harness"
import { HistoryRepository } from "@/src/storage/history-repository"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import { InvalidDurableStateError } from "@/src/runtime/runtime-phase-errors"

const integrations = vi.hoisted(() => ({
  reconcile:
    vi.fn<
      () => Promise<{ changed: boolean; enablement: Record<string, boolean> }>
    >(),
  validate: vi.fn(),
}))
vi.mock("@/src/site-integrations/host-permission-service", () => ({
  reconcileOptionalHostPermissionEnablement: integrations.reconcile,
}))
vi.mock("@/src/runtime/background-site-integration-initialization", () => ({
  validateBackgroundSiteIntegrations: integrations.validate,
}))
vi.mock("@/src/runtime/i18n", () => ({
  applyUiLanguagePreference: vi.fn(async () => undefined),
}))
vi.mock("@/src/runtime/logger", () => ({
  default: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

function fixture() {
  const queue = createQueueRepositoryTestHarness([])
  Object.assign(chrome.storage.session, {
    setAccessLevel: vi.fn(async () => undefined),
  })
  const send = vi.fn(async () => ({
    success: true,
    initializationState: "ready",
    documentInstanceId: "producer",
    activeJobCount: 0,
    activeTransientWorkCount: 0,
    activeTaskIds: [],
  }))
  const contexts = vi.fn(async (): Promise<unknown[]> => [
    { documentId: "browser-document" },
  ])
  Object.assign(chrome, {
    offscreen: { hasDocument: async () => true },
    runtime: {
      sendMessage: send,
      getURL: (path: string) => `chrome-extension://test/${path}`,
      getContexts: contexts,
    },
  })
  const native = {
    initialize: vi.fn(async () => []),
    reconcileStartupOpenManifests: vi.fn(async () => ({
      effects: [],
      observedJobSealed: false,
    })),
    getLiveTaskIds: async () => [],
    reconcile: async () => [],
    hasLiveDependencies: async () => false,
  }
  const alarm = vi.fn(async () => undefined)
  const kernel = new BackgroundRuntimeKernel({
    queueRepository: queue,
    historyRepository: new HistoryRepository(),
    settingsRepository: {
      getSettings: async () => structuredClone(DEFAULT_SETTINGS),
    } as never,
    siteIntegrationEnablementService: {} as never,
    tabContextStateService: new TabContextStateService(),
    nativeOutputCoordinator: native as never,
    terminalCoordinator: {
      continueAfterNativeOutputSettlement: async () => undefined,
    } as never,
    queueScheduler: {} as never,
    awaitSchemaMigration: async () => undefined,
    ensureLivenessAlarm: alarm,
    setLivenessAlarmArmed: alarm,
  })
  return { kernel, queue, send, contexts, native }
}

beforeEach(() => {
  vi.clearAllMocks()
  integrations.reconcile.mockResolvedValue({
    changed: false,
    enablement: { mangadex: true },
  })
})

describe("runtime startup offscreen evidence", () => {
  it("recovers an empty durable queue using a live offscreen status snapshot", async () => {
    const { kernel, queue, send, native } = fixture()
    await kernel.ensure("runtime-ready")
    expect(send).toHaveBeenCalledWith({
      target: "offscreen",
      type: "OFFSCREEN_STATUS",
    })
    expect(native.reconcileStartupOpenManifests).toHaveBeenCalledWith({
      offscreenJob: null,
      activeLease: null,
    })
    expect(await queue.getQueue()).toEqual([])
  })
  it("accepts disappearance when no offscreen browser context remains", async () => {
    const { kernel, send, contexts } = fixture()
    send.mockRejectedValue(new Error("document disappeared"))
    contexts.mockResolvedValue([])
    await expect(kernel.ensure("runtime-ready")).resolves.toBeUndefined()
    expect(contexts).toHaveBeenCalledOnce()
  })
  it("keeps runtime recovery pending when an existing offscreen document cannot report status", async () => {
    const { kernel, queue, send } = fixture()
    send.mockRejectedValue(new Error("document unresponsive"))
    const recover = vi.spyOn(queue, "recoverQueueAfterStartup")
    await expect(kernel.ensure("runtime-ready")).rejects.toThrow(
      "Unable to query the existing offscreen document"
    )
    expect(recover).not.toHaveBeenCalled()
  })
})

describe("integration generation recovery", () => {
  it("ignores an obsolete generation failure after a newer refresh succeeds", async () => {
    let rejectOld!: (error: Error) => void
    const old = new Promise<{
      changed: boolean
      enablement: Record<string, boolean>
    }>((_resolve, reject) => {
      rejectOld = reject
    })
    integrations.reconcile.mockReturnValueOnce(old)
    const { kernel } = fixture()
    const original = kernel.ensure("integrations-ready")
    await vi.waitFor(() =>
      expect(integrations.reconcile).toHaveBeenCalledOnce()
    )
    await kernel.refreshIntegrations()
    rejectOld(new Error("obsolete permission snapshot"))
    await expect(original).resolves.toBeUndefined()
    expect(integrations.validate).toHaveBeenCalledOnce()
  })
  it("keeps fatal integration initialization errors sticky within the worker", async () => {
    integrations.reconcile.mockRejectedValue(
      new InvalidDurableStateError("Invalid enablement state")
    )
    const { kernel } = fixture()
    await expect(kernel.ensure("integrations-ready")).rejects.toThrow(
      "Invalid enablement state"
    )
    await expect(kernel.ensure("integrations-ready")).rejects.toThrow(
      "Invalid enablement state"
    )
    expect(integrations.reconcile).toHaveBeenCalledOnce()
    expect(integrations.validate).not.toHaveBeenCalled()
  })
})
