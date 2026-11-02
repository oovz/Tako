import { afterEach, describe, expect, it, vi } from "vitest"

import {
  ProviderNetworkPolicyContinuationCoordinator,
  SITE_INTEGRATION_SESSION_RULE_CONTINUATION_ALARM,
  type ProviderNetworkPolicyStateSnapshot,
} from "@/src/site-integrations/provider-network-policy-continuation"
import { SESSION_STORAGE_KEYS } from "@/src/runtime/storage-keys"

const storageKey = SESSION_STORAGE_KEYS.providerNetworkPolicyContinuation

function installSession(initial: unknown) {
  const values: Record<string, unknown> = { [storageKey]: initial }
  const set = vi.fn(async (next: Record<string, unknown>) => {
    Object.assign(values, next)
  })
  const remove = vi.fn(async (key: string) => {
    delete values[key]
  })
  const clear = vi.fn<(name: string) => Promise<boolean>>(async () => true)
  const create = vi.fn(async () => undefined)
  vi.stubGlobal("chrome", {
    storage: {
      session: {
        get: vi.fn(async (key: string) => ({ [key]: values[key] })),
        set,
        remove,
      },
    },
    alarms: { clear, create },
  })
  return { values, set, remove, clear, create }
}

function createCoordinator(
  overrides: Partial<ProviderNetworkPolicyStateSnapshot> = {}
) {
  const reconcile = vi.fn(async () => undefined)
  const onQueueResume = vi.fn(async () => undefined)
  const state = (): ProviderNetworkPolicyStateSnapshot => ({
    dirty: false,
    successfulRevision: 3,
    requestedRevision: 3,
    lastSuccessfulEnablement: { readmanga: true },
    isRevisionCurrent: (revision) => revision === 3,
    ...overrides,
  })
  const coordinator = new ProviderNetworkPolicyContinuationCoordinator({
    state,
    reconcile,
    onQueueResume,
  })
  return { coordinator, reconcile, onQueueResume }
}

afterEach(() => vi.unstubAllGlobals())

describe("provider policy continuation recovery", () => {
  it("retains durable acknowledgement when alarm cleanup fails", async () => {
    const session = installSession({ revision: 3, consumed: true })
    session.clear.mockRejectedValueOnce(new Error("alarm service unavailable"))
    const { coordinator } = createCoordinator()
    await expect(coordinator.handleContinuationAlarm()).resolves.toBeUndefined()
    expect(session.values).not.toHaveProperty(storageKey)
  })
  it.each([
    { revision: 2, consumed: false },
    { revision: 3, consumed: true },
  ])(
    "acknowledges stale or consumed persisted marker $revision/$consumed without resuming",
    async (marker) => {
      const session = installSession(marker)
      const { coordinator, onQueueResume } = createCoordinator()
      await coordinator.handleContinuationAlarm()
      expect(onQueueResume).not.toHaveBeenCalled()
      expect(session.set).toHaveBeenCalledWith({
        [storageKey]: { revision: marker.revision, consumed: true },
      })
      expect(session.values).not.toHaveProperty(storageKey)
      expect(session.clear).toHaveBeenCalledWith(
        SITE_INTEGRATION_SESSION_RULE_CONTINUATION_ALARM
      )
    }
  )

  it("reconciles an orphaned wakeup before an unhydrated worker can resume the queue", async () => {
    const session = installSession(undefined)
    const { coordinator, reconcile, onQueueResume } = createCoordinator({
      dirty: true,
      successfulRevision: 0,
      requestedRevision: 1,
    })
    await coordinator.handleContinuationAlarm()
    expect(reconcile).toHaveBeenCalledOnce()
    expect(onQueueResume).not.toHaveBeenCalled()
    expect(session.clear).not.toHaveBeenCalled()
  })

  it("rebuilds a lost marker after successful reconciliation and keeps its wakeup", async () => {
    const session = installSession({ revision: -1 })
    const { coordinator, onQueueResume } = createCoordinator()
    await coordinator.handleContinuationAlarm()
    expect(session.values[storageKey]).toEqual({ revision: 3, consumed: false })
    expect(session.create).toHaveBeenCalledOnce()
    expect(session.clear).not.toHaveBeenCalled()
    expect(onQueueResume).not.toHaveBeenCalled()
  })

  it("clears a wakeup with no marker, successful state or outstanding reconciliation", async () => {
    const session = installSession(null)
    const { coordinator, reconcile } = createCoordinator({
      lastSuccessfulEnablement: undefined,
    })
    await coordinator.handleContinuationAlarm()
    expect(session.clear).toHaveBeenCalledOnce()
    expect(reconcile).not.toHaveBeenCalled()
  })

  it("retains a current marker until the queue acknowledges durable admission", async () => {
    const session = installSession({ revision: 3, consumed: false })
    const { coordinator, onQueueResume } = createCoordinator()
    await coordinator.handleContinuationAlarm()
    expect(onQueueResume).toHaveBeenCalledWith({ readmanga: true })
    expect(session.values[storageKey]).toEqual({ revision: 3, consumed: false })
    expect(session.create).toHaveBeenCalledOnce()
    await coordinator.clearContinuation(3)
    expect(session.values).not.toHaveProperty(storageKey)
  })
})
