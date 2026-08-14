import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  assertValidSessionRefererRuleDeclaration,
  assertValidSiteIntegrationNetworkCapabilities,
} from "@/src/site-integrations/manifest-validation"
import {
  SITE_INTEGRATION_MANIFESTS,
  type SiteIntegrationManifest,
} from "@/src/site-integrations/manifest"
import { isAllowedManhuaguiImageUrl } from "@/src/site-integrations/manhuagui/shared"
import { normalizePixivImageUrl } from "@/src/site-integrations/pixiv-comic/shared"

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function installChromeMock(input?: {
  contains?: (permissions: chrome.permissions.Permissions) => Promise<boolean>
  storedEnablement?: Record<string, boolean>
  updateSessionRules?: (
    options: chrome.declarativeNetRequest.UpdateRuleOptions
  ) => Promise<void>
}) {
  const updateSessionRules = vi.fn(
    input?.updateSessionRules ?? (async () => undefined)
  )
  const storageChangeListeners: Array<
    Parameters<typeof chrome.storage.onChanged.addListener>[0]
  > = []
  const permissionAddedListeners: Array<
    Parameters<typeof chrome.permissions.onAdded.addListener>[0]
  > = []
  const permissionRemovedListeners: Array<
    Parameters<typeof chrome.permissions.onRemoved.addListener>[0]
  > = []
  const alarmListeners: Array<
    Parameters<typeof chrome.alarms.onAlarm.addListener>[0]
  > = []
  const createAlarm = vi.fn<
    (name: string, alarmInfo: chrome.alarms.AlarmCreateInfo) => Promise<void>
  >(async () => undefined)
  const clearAlarm = vi.fn<(name: string) => Promise<boolean>>(async () => true)

  vi.stubGlobal("chrome", {
    runtime: { id: "test-extension-id" },
    storage: {
      local: {
        get: vi.fn(async () => ({
          siteIntegrationEnablement: input?.storedEnablement ?? {},
        })),
      },
      onChanged: {
        addListener: vi.fn((listener) => storageChangeListeners.push(listener)),
      },
    },
    declarativeNetRequest: {
      updateSessionRules,
      RuleActionType: { MODIFY_HEADERS: "modifyHeaders" },
      HeaderOperation: { SET: "set" },
      ResourceType: { XMLHTTPREQUEST: "xmlhttprequest", OTHER: "other" },
    },
    permissions: {
      contains: vi.fn(input?.contains ?? (async () => true)),
      onAdded: {
        addListener: vi.fn((listener) =>
          permissionAddedListeners.push(listener)
        ),
      },
      onRemoved: {
        addListener: vi.fn((listener) =>
          permissionRemovedListeners.push(listener)
        ),
      },
    },
    alarms: {
      create: createAlarm,
      clear: clearAlarm,
      onAlarm: {
        addListener: vi.fn((listener) => alarmListeners.push(listener)),
      },
    },
  })

  return {
    alarmListeners,
    clearAlarm,
    createAlarm,
    permissionAddedListeners,
    permissionRemovedListeners,
    storageChangeListeners,
    updateSessionRules,
  }
}

async function loadManager() {
  return await import("@/src/site-integrations/session-rule-manager")
}

describe("site integration session-rule manager", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it("builds a referer rule scoped to the extension initiator", async () => {
    installChromeMock()
    const { buildSessionRefererRule } = await loadManager()

    const rule = buildSessionRefererRule(
      {
        id: 41_099,
        requestDomains: ["images.example.com"],
        resourceTypes: ["xmlhttprequest", "other"],
        referer: "https://reader.example.com/",
      },
      "test-extension-id"
    )

    expect(rule).toEqual({
      id: 41_099,
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [
          {
            header: "referer",
            operation: "set",
            value: "https://reader.example.com/",
          },
        ],
      },
      condition: {
        initiatorDomains: ["test-extension-id"],
        requestDomains: ["images.example.com"],
        resourceTypes: ["xmlhttprequest", "other"],
      },
    })
  })

  it("rejects invalid provider rule declarations and cross-policy drift", () => {
    expect(() =>
      assertValidSessionRefererRuleDeclaration({
        id: 40_999,
        requestDomains: ["images.example.com"],
        resourceTypes: ["other"],
        referer: "https://reader.example.com/",
      })
    ).toThrow("extension-managed range")

    expect(() =>
      assertValidSessionRefererRuleDeclaration({
        id: 41_099,
        requestDomains: ["Images.Example.com"],
        resourceTypes: ["other"],
        referer: "https://reader.example.com/",
      })
    ).toThrow("Invalid DNR request domain")

    const invalidManifest: SiteIntegrationManifest = {
      ...SITE_INTEGRATION_MANIFESTS[1],
      network: {
        sessionRefererRules: [
          {
            id: 41_099,
            requestDomains: ["outside.example.com"],
            resourceTypes: ["other"],
            referer: "https://comic.pixiv.net/",
          },
        ],
      },
    }
    expect(() =>
      assertValidSiteIntegrationNetworkCapabilities([invalidManifest])
    ).toThrow("not covered by requiredOrigins")
  })

  it("keeps DNR request domains accepted by each provider runtime policy", () => {
    for (const manifest of SITE_INTEGRATION_MANIFESTS) {
      for (const rule of manifest.network?.sessionRefererRules ?? []) {
        for (const domain of rule.requestDomains) {
          const imageUrl = `https://${domain}/contract-test-image.jpg`
          if (manifest.id === "manhuagui") {
            expect(isAllowedManhuaguiImageUrl(imageUrl)).toBe(true)
          } else if (manifest.id === "pixiv-comic") {
            expect(() => normalizePixivImageUrl(imageUrl)).not.toThrow()
          } else {
            throw new Error(
              `Add a runtime network-policy assertion for ${manifest.id}`
            )
          }
        }
      }
    }
  })

  it("installs only rules for enabled providers", async () => {
    const { updateSessionRules } = installChromeMock()
    const { reconcileSiteIntegrationSessionRules } = await loadManager()

    await reconcileSiteIntegrationSessionRules({
      "pixiv-comic": false,
      manhuagui: true,
    })

    expect(updateSessionRules).toHaveBeenCalledWith({
      removeRuleIds: [41001, 41002],
      addRules: [
        expect.objectContaining({
          id: 41002,
          condition: expect.objectContaining({
            initiatorDomains: ["test-extension-id"],
          }),
        }),
      ],
    })
  })

  it("a definitive permission denial removes only the affected provider rule", async () => {
    const { updateSessionRules } = installChromeMock({
      contains: async ({ origins }) =>
        !origins?.includes("https://www.manhuagui.com/*"),
    })
    const { reconcileSiteIntegrationSessionRules } = await loadManager()

    await reconcileSiteIntegrationSessionRules({
      "pixiv-comic": true,
      manhuagui: true,
    })

    expect(updateSessionRules).toHaveBeenCalledWith({
      removeRuleIds: [41001, 41002],
      addRules: [expect.objectContaining({ id: 41001 })],
    })
  })

  it("preserves the current rule set when host-permission status is indeterminate", async () => {
    const { createAlarm, updateSessionRules } = installChromeMock({
      contains: async () => {
        throw new Error("permissions API unavailable")
      },
    })
    const {
      reconcileSiteIntegrationSessionRules,
      SITE_INTEGRATION_SESSION_RULE_RETRY_ALARM,
    } = await loadManager()

    await expect(
      reconcileSiteIntegrationSessionRules({
        "pixiv-comic": true,
        manhuagui: true,
      })
    ).rejects.toThrow("Unable to verify host permission")

    expect(updateSessionRules).not.toHaveBeenCalled()
    expect(createAlarm).toHaveBeenCalledWith(
      SITE_INTEGRATION_SESSION_RULE_RETRY_ALARM,
      expect.objectContaining({
        delayInMinutes: 0.5,
        persistAcrossSessions: true,
      })
    )
  })

  it("fails explicitly when the required session-rule API is unavailable", async () => {
    vi.stubGlobal("chrome", {})
    const { reconcileSiteIntegrationSessionRules } = await loadManager()

    await expect(
      reconcileSiteIntegrationSessionRules({
        "pixiv-comic": true,
        manhuagui: true,
      })
    ).rejects.toThrow("Required extension capability is unavailable")
  })

  it("retries a failed initial update from one named alarm and clears it after success", async () => {
    const { alarmListeners, clearAlarm, createAlarm, updateSessionRules } =
      installChromeMock()
    updateSessionRules
      .mockRejectedValueOnce(new Error("DNR unavailable"))
      .mockResolvedValueOnce(undefined)
    const onReconciled = vi.fn()
    const {
      initializeSiteIntegrationSessionRuleManager,
      SITE_INTEGRATION_SESSION_RULE_RETRY_ALARM,
    } = await loadManager()

    await expect(
      initializeSiteIntegrationSessionRuleManager({ onReconciled })
    ).rejects.toThrow("DNR unavailable")
    expect(createAlarm).toHaveBeenCalledTimes(1)
    expect(onReconciled).not.toHaveBeenCalled()

    alarmListeners[0]({
      name: SITE_INTEGRATION_SESSION_RULE_RETRY_ALARM,
      scheduledTime: Date.now(),
      persistAcrossSessions: true,
    })

    await vi.waitFor(() => expect(updateSessionRules).toHaveBeenCalledTimes(2))
    await vi.waitFor(() =>
      expect(clearAlarm).toHaveBeenCalledWith(
        SITE_INTEGRATION_SESSION_RULE_RETRY_ALARM
      )
    )
    await vi.waitFor(() => expect(onReconciled).toHaveBeenCalledTimes(1))
  })

  it("allows an explicit initializer retry after the first reconciliation rejects", async () => {
    const { updateSessionRules } = installChromeMock()
    updateSessionRules
      .mockRejectedValueOnce(new Error("DNR unavailable"))
      .mockResolvedValueOnce(undefined)
    const { initializeSiteIntegrationSessionRuleManager } = await loadManager()

    await expect(initializeSiteIntegrationSessionRuleManager()).rejects.toThrow(
      "DNR unavailable"
    )
    await expect(
      initializeSiteIntegrationSessionRuleManager()
    ).resolves.toBeUndefined()

    expect(updateSessionRules).toHaveBeenCalledTimes(2)
  })

  it("caps retry backoff and does not replace an already scheduled retry", async () => {
    const { alarmListeners, createAlarm } = installChromeMock({
      updateSessionRules: async () => {
        throw new Error("DNR unavailable")
      },
    })
    const {
      initializeSiteIntegrationSessionRuleManager,
      reconcileSiteIntegrationSessionRules,
      SITE_INTEGRATION_SESSION_RULE_RETRY_ALARM,
    } = await loadManager()

    await expect(
      initializeSiteIntegrationSessionRuleManager()
    ).rejects.toThrow()
    await expect(reconcileSiteIntegrationSessionRules()).rejects.toThrow()
    expect(createAlarm).toHaveBeenCalledTimes(1)

    for (let index = 0; index < 6; index += 1) {
      alarmListeners[0]({
        name: SITE_INTEGRATION_SESSION_RULE_RETRY_ALARM,
        scheduledTime: Date.now(),
        persistAcrossSessions: true,
      })
      await vi.waitFor(() =>
        expect(createAlarm).toHaveBeenCalledTimes(index + 2)
      )
    }

    expect(
      createAlarm.mock.calls.map(([, alarmInfo]) => alarmInfo.delayInMinutes)
    ).toEqual([0.5, 1, 2, 4, 8, 8, 8])
  })

  it("registers, de-duplicates, and exercises lifecycle listeners", async () => {
    let manhuaguiHostAccess = true
    const {
      alarmListeners,
      permissionAddedListeners,
      permissionRemovedListeners,
      storageChangeListeners,
      updateSessionRules,
    } = installChromeMock({
      contains: async ({ origins }) =>
        !origins?.includes("https://www.manhuagui.com/*") ||
        manhuaguiHostAccess,
    })
    const { initializeSiteIntegrationSessionRuleManager } = await loadManager()

    const firstInitialization = initializeSiteIntegrationSessionRuleManager()
    const secondInitialization = initializeSiteIntegrationSessionRuleManager()

    expect(secondInitialization).toBe(firstInitialization)
    expect(storageChangeListeners).toHaveLength(1)
    expect(permissionAddedListeners).toHaveLength(1)
    expect(permissionRemovedListeners).toHaveLength(1)
    expect(alarmListeners).toHaveLength(1)
    await firstInitialization

    storageChangeListeners[0](
      {
        siteIntegrationEnablement: {
          newValue: { "pixiv-comic": false, manhuagui: true },
        },
      },
      "local"
    )
    await vi.waitFor(() => expect(updateSessionRules).toHaveBeenCalledTimes(2))
    expect(updateSessionRules).toHaveBeenLastCalledWith({
      removeRuleIds: [41001, 41002],
      addRules: [expect.objectContaining({ id: 41002 })],
    })

    permissionAddedListeners[0]({ origins: ["https://example.com/*"] })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(updateSessionRules).toHaveBeenCalledTimes(2)

    permissionAddedListeners[0]({
      origins: ["https://comic.pixiv.net/*"],
    })
    await vi.waitFor(() => expect(updateSessionRules).toHaveBeenCalledTimes(3))
    manhuaguiHostAccess = false
    permissionRemovedListeners[0]({
      origins: ["https://www.manhuagui.com/*"],
    })
    await vi.waitFor(() => expect(updateSessionRules).toHaveBeenCalledTimes(4))
    expect(updateSessionRules).toHaveBeenLastCalledWith({
      removeRuleIds: [41001, 41002],
      addRules: [expect.objectContaining({ id: 41001 })],
    })
  })

  it("serializes lifecycle changes that arrive during an active reconciliation", async () => {
    const gate = deferred<void>()
    let activeUpdates = 0
    let maximumActiveUpdates = 0
    const {
      permissionAddedListeners,
      storageChangeListeners,
      updateSessionRules,
    } = installChromeMock({
      updateSessionRules: async () => {
        activeUpdates += 1
        maximumActiveUpdates = Math.max(maximumActiveUpdates, activeUpdates)
        if (updateSessionRules.mock.calls.length === 1) {
          await gate.promise
        }
        activeUpdates -= 1
      },
    })
    const { initializeSiteIntegrationSessionRuleManager } = await loadManager()

    const initial = initializeSiteIntegrationSessionRuleManager()
    await vi.waitFor(() => expect(updateSessionRules).toHaveBeenCalledTimes(1))
    storageChangeListeners[0](
      { siteIntegrationEnablement: { newValue: { manhuagui: true } } },
      "local"
    )
    permissionAddedListeners[0]({ origins: ["https://comic.pixiv.net/*"] })
    gate.resolve()
    await initial
    await vi.waitFor(() => expect(updateSessionRules).toHaveBeenCalledTimes(2))

    expect(maximumActiveUpdates).toBe(1)
  })

  it("blocks DNR-dependent readiness while allowing unrelated providers through", async () => {
    const gate = deferred<void>()
    const { updateSessionRules } = installChromeMock({
      updateSessionRules: async () => gate.promise,
    })
    const {
      ensureSiteIntegrationNetworkReady,
      initializeSiteIntegrationSessionRuleManager,
    } = await loadManager()

    const initial = initializeSiteIntegrationSessionRuleManager()
    let manhuaguiReady = false
    const dependentReadiness = ensureSiteIntegrationNetworkReady(
      "manhuagui"
    ).then(() => {
      manhuaguiReady = true
    })

    await expect(
      ensureSiteIntegrationNetworkReady("shonenjumpplus")
    ).resolves.toBeUndefined()
    await vi.waitFor(() => expect(updateSessionRules).toHaveBeenCalledTimes(1))
    expect(manhuaguiReady).toBe(false)

    gate.resolve()
    await initial
    await dependentReadiness
    expect(manhuaguiReady).toBe(true)
  })

  it("re-reads enablement when a provider is enabled immediately before dispatch", async () => {
    const storedEnablement = { manhuagui: false }
    const { updateSessionRules } = installChromeMock({ storedEnablement })
    const {
      ensureSiteIntegrationNetworkReady,
      initializeSiteIntegrationSessionRuleManager,
    } = await loadManager()

    await initializeSiteIntegrationSessionRuleManager()
    expect(updateSessionRules).toHaveBeenLastCalledWith({
      removeRuleIds: [41001, 41002],
      addRules: [expect.objectContaining({ id: 41001 })],
    })

    storedEnablement.manhuagui = true
    await ensureSiteIntegrationNetworkReady("manhuagui")

    expect(updateSessionRules).toHaveBeenLastCalledWith({
      removeRuleIds: [41001, 41002],
      addRules: [
        expect.objectContaining({ id: 41001 }),
        expect.objectContaining({ id: 41002 }),
      ],
    })
  })

  it("does not rewrite an already-current managed rule set for each dependent task", async () => {
    const { updateSessionRules } = installChromeMock({
      storedEnablement: { manhuagui: true },
    })
    const {
      ensureSiteIntegrationNetworkReady,
      initializeSiteIntegrationSessionRuleManager,
    } = await loadManager()

    await initializeSiteIntegrationSessionRuleManager()
    await ensureSiteIntegrationNetworkReady("manhuagui")
    await ensureSiteIntegrationNetworkReady("manhuagui")

    expect(updateSessionRules).toHaveBeenCalledTimes(1)
  })

  it("classifies transient reconciliation failure separately from host-access denial", async () => {
    let shouldThrow = true
    const { updateSessionRules } = installChromeMock({
      storedEnablement: { manhuagui: true },
      updateSessionRules: async () => {
        if (shouldThrow) throw new Error("temporary DNR failure")
      },
    })
    const {
      ensureSiteIntegrationNetworkReady,
      initializeSiteIntegrationSessionRuleManager,
      ProviderNetworkPolicyPendingError,
      ProviderNetworkPolicyActionRequiredError,
    } = await loadManager()

    await expect(initializeSiteIntegrationSessionRuleManager()).rejects.toThrow(
      "temporary DNR failure"
    )
    await expect(
      ensureSiteIntegrationNetworkReady("manhuagui")
    ).rejects.toBeInstanceOf(ProviderNetworkPolicyPendingError)

    shouldThrow = false
    vi.mocked(
      chrome.permissions.contains as (
        permissions: chrome.permissions.Permissions
      ) => Promise<boolean>
    ).mockResolvedValue(false)
    await expect(
      ensureSiteIntegrationNetworkReady("manhuagui")
    ).rejects.toBeInstanceOf(ProviderNetworkPolicyActionRequiredError)
    expect(updateSessionRules).toHaveBeenCalled()
  })
})
