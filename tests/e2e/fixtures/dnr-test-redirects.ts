/**
 * Redirect extension requests, including offscreen fetches, to the local mock
 * server. Test rules use IDs 9000–9999, separate from production provider rules.
 */

import type { Worker } from "@playwright/test"

export interface DnrRedirectRule {
  /** Unique test-range ID, removed during fixture cleanup. */
  id: number
  /**
   * RE2 filter string matching the URL to redirect. Capture groups are
   * referenced by `regexSubstitution` via `\1`, `\2`, ....
   * Example: `^https?://(?:www\\.)?manhuagui\\.com/(.*)$`
   */
  regexFilter: string
  /**
   * Substitution template. Use `http://127.0.0.1:<port>/<prefix>/\1`
   * to route into `local-mock-server.ts`. Do NOT include a trailing
   * wildcard — the captured group already contains the remaining path.
   */
  regexSubstitution: string
  /**
   * Defaults to subresource types. Excluding `main_frame` keeps page navigations
   * on their original host, where Playwright routes supply the fixture HTML.
   */
  resourceTypes?: chrome.declarativeNetRequest.ResourceType[]
  /**
   * Defaults to the extension ID, covering service-worker, offscreen, and
   * extension-page requests. Override only for intentional page-origin routing.
   */
  initiatorDomains?: string[]
}

/** Subresource requests; page navigations retain their original host. */
export const DEFAULT_DNR_RESOURCE_TYPES: chrome.declarativeNetRequest.ResourceType[] =
  [
    "sub_frame",
    "xmlhttprequest",
    "script",
    "stylesheet",
    "image",
    "media",
    "font",
    "object",
    "other",
    "websocket",
    "ping",
    "csp_report",
  ] as chrome.declarativeNetRequest.ResourceType[]

/** Reserved rule id range for test-only DNR rules. */
export const DNR_TEST_RULE_ID_MIN = 9000
export const DNR_TEST_RULE_ID_MAX = 9999

/**
 * A low-priority deny rule makes deterministic E2E fail closed: a new
 * extension-origin provider request cannot silently escape the local mock
 * server just because an integration acquired another endpoint. Redirect
 * rules have a higher priority and localhost is excluded so their rewritten
 * requests can reach the fixture server.
 */
export const DNR_TEST_NETWORK_BLOCK_RULE_ID = 9999
const DNR_TEST_REDIRECT_PRIORITY = 100
const DNR_TEST_NETWORK_BLOCK_PRIORITY = 1
const LOCAL_MOCK_DOMAINS = ["127.0.0.1", "localhost"]

function assertTestRuleId(id: number): void {
  if (
    !Number.isInteger(id) ||
    id < DNR_TEST_RULE_ID_MIN ||
    id > DNR_TEST_RULE_ID_MAX
  ) {
    throw new Error(
      `DNR test rule id ${id} is outside the reserved test range ${DNR_TEST_RULE_ID_MIN}–${DNR_TEST_RULE_ID_MAX}.`
    )
  }

  if (id === DNR_TEST_NETWORK_BLOCK_RULE_ID) {
    throw new Error(
      `DNR test rule id ${id} is reserved for the extension-network deny rule.`
    )
  }
}

/**
 * Replace reserved test rules with extension-scoped redirects and a lower-priority
 * HTTP(S) deny rule. Loopback requests remain allowed to reach the mock server.
 * A rule may explicitly override its initiator scope.
 */
export async function installDnrRedirectRules(
  swWorker: Worker,
  extensionId: string,
  rules: DnrRedirectRule[]
): Promise<void> {
  for (const rule of rules) assertTestRuleId(rule.id)

  const payload = JSON.stringify({
    minId: DNR_TEST_RULE_ID_MIN,
    maxId: DNR_TEST_RULE_ID_MAX,
    defaultResourceTypes: DEFAULT_DNR_RESOURCE_TYPES,
    defaultInitiatorDomains: [extensionId],
    networkBlockRuleId: DNR_TEST_NETWORK_BLOCK_RULE_ID,
    networkBlockPriority: DNR_TEST_NETWORK_BLOCK_PRIORITY,
    redirectPriority: DNR_TEST_REDIRECT_PRIORITY,
    localMockDomains: LOCAL_MOCK_DOMAINS,
    rules,
  })

  await swWorker.evaluate(async (payloadJson: string) => {
    const {
      rules,
      minId,
      maxId,
      defaultResourceTypes,
      defaultInitiatorDomains,
      networkBlockRuleId,
      networkBlockPriority,
      redirectPriority,
      localMockDomains,
    } = JSON.parse(payloadJson) as {
      rules: Array<{
        id: number
        regexFilter: string
        regexSubstitution: string
        resourceTypes?: chrome.declarativeNetRequest.ResourceType[]
        initiatorDomains?: string[]
      }>
      minId: number
      maxId: number
      defaultResourceTypes: chrome.declarativeNetRequest.ResourceType[]
      defaultInitiatorDomains: string[]
      networkBlockRuleId: number
      networkBlockPriority: number
      redirectPriority: number
      localMockDomains: string[]
    }
    // Replace only installed rules in the reserved test range.
    const existing = await chrome.declarativeNetRequest.getSessionRules()
    const staleTestIds = existing
      .filter((rule) => rule.id >= minId && rule.id <= maxId)
      .map((rule) => rule.id)

    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: Array.from(
        new Set([...staleTestIds, ...rules.map((rule) => rule.id)])
      ),
      addRules: [
        ...rules.map((rule) => ({
          id: rule.id,
          priority: redirectPriority,
          action: {
            type: "redirect" as chrome.declarativeNetRequest.RuleActionType,
            redirect: { regexSubstitution: rule.regexSubstitution },
          },
          condition: {
            regexFilter: rule.regexFilter,
            resourceTypes: rule.resourceTypes ?? defaultResourceTypes,
            initiatorDomains: rule.initiatorDomains ?? defaultInitiatorDomains,
          },
        })),
        {
          id: networkBlockRuleId,
          priority: networkBlockPriority,
          action: {
            type: "block" as chrome.declarativeNetRequest.RuleActionType,
          },
          condition: {
            // Only HTTP(S) provider traffic is governed by this test-only
            // guard; extension resources and unrelated URL schemes remain
            // outside the rule.
            regexFilter: "^https?://",
            resourceTypes: defaultResourceTypes,
            initiatorDomains: defaultInitiatorDomains,
            excludedRequestDomains: localMockDomains,
          },
        },
      ],
    })
  }, payload)
}

/** Remove only test-range session rules during fixture cleanup. */
export async function clearDnrRedirectRules(
  swWorker: Pick<Worker, "evaluate">
): Promise<void> {
  await swWorker.evaluate(
    async ({ minId, maxId }: { minId: number; maxId: number }) => {
      const existing = await chrome.declarativeNetRequest.getSessionRules()
      const staleIds = existing
        .filter((rule) => rule.id >= minId && rule.id <= maxId)
        .map((rule) => rule.id)
      if (staleIds.length > 0) {
        await chrome.declarativeNetRequest.updateSessionRules({
          removeRuleIds: staleIds,
        })
      }
    },
    { minId: DNR_TEST_RULE_ID_MIN, maxId: DNR_TEST_RULE_ID_MAX }
  )
}
