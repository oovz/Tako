import type { BrowserContext, Worker } from "@playwright/test"

export async function getExtensionServiceWorker(
  context: BrowserContext,
  extensionId: string
): Promise<Worker> {
  return (
    context
      .serviceWorkers()
      .find((candidate) =>
        candidate.url().startsWith(`chrome-extension://${extensionId}/`)
      ) ??
    (await context.waitForEvent("serviceworker", {
      timeout: 10_000,
      predicate: (candidate) =>
        candidate.url().startsWith(`chrome-extension://${extensionId}/`),
    }))
  )
}

export async function readExtensionSessionRules(
  context: BrowserContext,
  extensionId: string
): Promise<chrome.declarativeNetRequest.Rule[]> {
  const worker = await getExtensionServiceWorker(context, extensionId)
  return await worker.evaluate(async () =>
    chrome.declarativeNetRequest.getSessionRules()
  )
}

export async function testExtensionSessionRuleMatch(
  context: BrowserContext,
  extensionId: string,
  request: chrome.declarativeNetRequest.TestMatchRequestDetails
): Promise<number[]> {
  const worker = await getExtensionServiceWorker(context, extensionId)
  return await worker.evaluate(async (details) => {
    const result = await chrome.declarativeNetRequest.testMatchOutcome(details)
    return result.matchedRules.map((rule) => rule.ruleId)
  }, request)
}

export async function retainExtensionSessionRules(
  context: BrowserContext,
  extensionId: string,
  keepRuleIds: number[]
): Promise<void> {
  const worker = await getExtensionServiceWorker(context, extensionId)
  await worker.evaluate(async (retainedRuleIds) => {
    const currentRules = await chrome.declarativeNetRequest.getSessionRules()
    const removeRuleIds = currentRules
      .map((rule) => rule.id)
      .filter((ruleId) => !retainedRuleIds.includes(ruleId))
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds })
  }, keepRuleIds)
}

export async function setIntegrationEnabledFromWorker(
  context: BrowserContext,
  extensionId: string,
  siteIntegrationId: string,
  enabled: boolean
): Promise<void> {
  const worker = await getExtensionServiceWorker(context, extensionId)
  await worker.evaluate(
    async ({ enabled, siteIntegrationId }) => {
      const storageKey = "siteIntegrationEnablement"
      const stored = await chrome.storage.local.get(storageKey)
      const current =
        typeof stored[storageKey] === "object" &&
        stored[storageKey] !== null &&
        !Array.isArray(stored[storageKey])
          ? stored[storageKey]
          : {}
      await chrome.storage.local.set({
        [storageKey]: {
          ...current,
          [siteIntegrationId]: enabled,
        },
      })
    },
    { enabled, siteIntegrationId }
  )
}
