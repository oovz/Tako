import { afterEach, describe, expect, it, vi } from "vitest"

import { getDefinitions } from "@/src/site-integrations/catalog"
import {
  ProviderNetworkPolicyActionRequiredError,
  ProviderNetworkPolicyPendingError,
  SITE_INTEGRATION_SESSION_RULE_RETRY_ALARM,
  SiteIntegrationSessionRuleManager,
} from "@/src/site-integrations/session-rule-manager"

function setup() {
  const enablement = Object.fromEntries(
    getDefinitions().map(({ id }) => [id, false])
  )
  enablement.readmanga = true
  const getAll = vi.fn(async () => enablement)
  const contains = vi.fn(async () => true)
  const updateSessionRules = vi.fn(async () => undefined)
  const createAlarm = vi.fn(async () => undefined)
  const values: Record<string, unknown> = {}
  const permissionListeners: Array<
    (permissions: chrome.permissions.Permissions) => void
  > = []
  vi.stubGlobal("chrome", {
    runtime: { id: "extension-id" },
    permissions: {
      contains,
      onAdded: {
        addListener: (
          listener: (permissions: chrome.permissions.Permissions) => void
        ) => permissionListeners.push(listener),
      },
    },
    declarativeNetRequest: {
      updateSessionRules,
      RuleActionType: { MODIFY_HEADERS: "modifyHeaders" },
      HeaderOperation: { SET: "set" },
      ResourceType: { XMLHTTPREQUEST: "xmlhttprequest", OTHER: "other" },
    },
    storage: {
      session: {
        get: async (key: string) => ({ [key]: values[key] }),
        set: async (next: Record<string, unknown>) => {
          Object.assign(values, next)
        },
        remove: async (key: string) => {
          delete values[key]
        },
      },
    },
    alarms: { create: createAlarm, clear: async () => true },
  })
  const manager = new SiteIntegrationSessionRuleManager({
    service: { getAll },
    awaitSchemaMigration: async () => undefined,
    onReconciliationSucceeded: async () => undefined,
  })
  return {
    manager,
    enablement,
    getAll,
    contains,
    createAlarm,
    updateSessionRules,
    permissionListeners,
  }
}

afterEach(() => vi.unstubAllGlobals())

describe("dispatch-time provider network readiness failures", () => {
  it("keeps a failed fresh read pending even when retry reconciliation succeeds", async () => {
    const { manager, getAll, updateSessionRules } = setup()
    const failure = new Error("fresh enablement read failed")
    getAll.mockRejectedValueOnce(failure)
    await expect(manager.ensureNetworkReady("readmanga")).rejects.toMatchObject(
      { name: "ProviderNetworkPolicyPendingError", cause: failure }
    )
    expect(updateSessionRules).toHaveBeenCalledOnce()
    await expect(
      manager.ensureNetworkReady("readmanga")
    ).resolves.toBeUndefined()
    expect(updateSessionRules).toHaveBeenCalledOnce()
  })

  it("arms reconciliation retry when enablement remains unreadable", async () => {
    const { manager, getAll, createAlarm, updateSessionRules } = setup()
    getAll.mockRejectedValue(new Error("storage unavailable"))
    await expect(
      manager.ensureNetworkReady("readmanga")
    ).rejects.toBeInstanceOf(ProviderNetworkPolicyPendingError)
    expect(createAlarm).toHaveBeenCalledWith(
      SITE_INTEGRATION_SESSION_RULE_RETRY_ALARM,
      expect.objectContaining({ persistAcrossSessions: true })
    )
    expect(updateSessionRules).not.toHaveBeenCalled()
  })

  it("classifies disabled integration readiness as a required user action", async () => {
    const { manager, enablement, contains } = setup()
    enablement.readmanga = false
    await expect(
      manager.ensureNetworkReady("readmanga")
    ).rejects.toBeInstanceOf(ProviderNetworkPolicyActionRequiredError)
    await expect(manager.ensureNetworkReady("readmanga")).rejects.toMatchObject(
      { reason: "integration_disabled" }
    )
    expect(contains).not.toHaveBeenCalled()
  })

  it("keeps an indeterminate final permission read pending", async () => {
    const { manager, contains } = setup()
    contains
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error("permission service unavailable"))
    await expect(
      manager.ensureNetworkReady("readmanga")
    ).rejects.toBeInstanceOf(ProviderNetworkPolicyPendingError)
  })

  it("reports absent installed rules when a grant appears after reconciliation", async () => {
    const { manager, contains } = setup()
    contains.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    await expect(manager.ensureNetworkReady("readmanga")).rejects.toThrow(
      /missing DNR rule/
    )
  })

  it.each<chrome.runtime.ManifestPermission>([
    "declarativeNetRequest",
    "declarativeNetRequestWithHostAccess",
  ])(
    "reconciles after the managed capability %s changes",
    async (permission) => {
      const { manager, permissionListeners, updateSessionRules } = setup()
      manager.registerListeners()
      await manager.start()
      permissionListeners[0]({ permissions: [permission] })
      await vi.waitFor(() =>
        expect(updateSessionRules).toHaveBeenCalledTimes(2)
      )
    }
  )
})
