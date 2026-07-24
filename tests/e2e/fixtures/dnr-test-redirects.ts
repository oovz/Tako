/**
 * @file dnr-test-redirects.ts
 * @description Install `chrome.declarativeNetRequest` session rules that
 * redirect specific external URLs to our local mock server.
 *
 * Background: Playwright's `context.route` does not intercept offscreen
 * document fetches (confirmed empirically in the MangaDex download-workflow
 * investigation — a test that "passed" was actually hitting live CDN for
 * 9 MB chapters). DNR rules installed at test-setup time apply to ALL
 * extension-initiated requests, including those from offscreen, and can
 * redirect them to a local `http://127.0.0.1:<port>/...` endpoint that
 * `local-mock-server.ts` serves.
 *
 * Rule IDs are sourced from a dedicated test-only range (9_000 – 9_999) so
 * they never collide with production rules (e.g. image referer-rewrite
 * rules in `background-startup.ts` use ids outside this range).
 */

import type { Worker } from "@playwright/test"

export interface DnrRedirectRule {
  /**
   * Unique rule id. Must be in 9_000 – 9_999 so installTestRedirectRules()
   * can safely clear stale test rules without touching production ones.
   */
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
   * Optional override for `chrome.declarativeNetRequest.RuleCondition.resourceTypes`.
   * Defaults to `DEFAULT_DNR_RESOURCE_TYPES` which covers subresource and
   * XHR fetches but NOT `main_frame`. Leaving `main_frame` out keeps
   * page-level navigations (Playwright `page.goto` targets) flowing
   * through `context.route` instead of being hijacked to 127.0.0.1,
   * which is important because the content-script URL pattern matches
   * against the live hostname.
   */
  resourceTypes?: chrome.declarativeNetRequest.ResourceType[]
  /**
   * Optional override for the rule's `initiatorDomains`. When omitted the
   * installer fills in `[<extensionId>]` so rules only redirect requests
   * originating from the extension's own contexts (service worker,
   * offscreen document, popup, options page). This is critical for
   * deterministic sidepanel-activation specs: content-script fetches
   * from `mangadex.org` pages would otherwise be redirected to the
   * mock server and race with the test's `INITIALIZE_TAB` payload,
   * clobbering synthetic series titles. Pass an explicit list here only
   * when a rule intentionally needs to apply to page-context requests.
   */
  initiatorDomains?: string[]
}

/**
 * Default resource types for test DNR rules. Excludes `main_frame` so
 * top-level navigations stay on the mocked hostname (Playwright's
 * `context.route` handles those). Includes `sub_frame` because content
 * scripts sometimes read iframes, though none of our current tests
 * exercise that path.
 */
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
 * Install (or replace) the given redirect rules in the extension's session
 * rule set. Any previously-installed rule in the reserved test range is
 * removed first so tests remain idempotent across reruns within the same
 * browser session.
 *
 * Every rule is scoped to the caller's extension origin via
 * `initiatorDomains: [extensionId]` unless the rule overrides it. This
 * prevents content-script fetches (initiator = page origin) from being
 * redirected while still covering service worker, offscreen, popup, and
 * options-page fetches. Restricting the scope keeps sidepanel-activation
 * specs deterministic: the content script's own `api.mangadex.org` fetch
 * fails (or goes unmocked) so it cannot clobber the test's synthetic
 * `INITIALIZE_TAB` payload with mock data.
 *
 * A lower-priority block rule then rejects every other HTTP(S) request from
 * that origin. This prevents a new provider endpoint from turning a mocked
 * E2E run into an accidental live-network test. The redirect rules win first
 * and the rewritten loopback request is explicitly excluded from the block.
 *
 * The call runs inside the MV3 service worker via Playwright's
 * `worker.evaluate` because `chrome.declarativeNetRequest` is only
 * available in extension-privileged contexts.
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
    // Remove any stale test rules before adding new ones. Query current
    // session rules instead of brute-force removing the full range so we
    // don't accidentally remove rules outside our band if Chrome ever
    // rejects unknown ids (safer behavior).
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

/**
 * Remove every test-range rule from the session rule set. Called on test
 * teardown so later tests (or a later spec file) start from a clean slate
 * if the same browser context is reused.
 */
export async function clearDnrRedirectRules(swWorker: Worker): Promise<void> {
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
