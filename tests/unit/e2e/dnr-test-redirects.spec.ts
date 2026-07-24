import { describe, expect, it } from "vitest"
import type { Worker } from "@playwright/test"

import {
  DEFAULT_DNR_RESOURCE_TYPES,
  DNR_TEST_NETWORK_BLOCK_RULE_ID,
  installDnrRedirectRules,
} from "@/tests/e2e/fixtures/dnr-test-redirects"

describe("mocked E2E DNR rules", () => {
  it("redirects declared endpoints and blocks undeclared extension traffic", async () => {
    let sessionRules: Array<Record<string, unknown>> = []
    const originalChrome = globalThis.chrome
    Object.assign(globalThis, {
      chrome: {
        declarativeNetRequest: {
          getSessionRules: async () => sessionRules,
          updateSessionRules: async ({
            removeRuleIds = [],
            addRules = [],
          }: {
            removeRuleIds?: number[]
            addRules?: Array<Record<string, unknown>>
          }) => {
            sessionRules = [
              ...sessionRules.filter(
                (rule) => !removeRuleIds.includes(rule.id as number)
              ),
              ...addRules,
            ]
          },
        },
      },
    })

    const worker = {
      evaluate: async <T, Arg>(
        callback: (argument: Arg) => Promise<T>,
        argument: Arg
      ): Promise<T> => callback(argument),
    } as unknown as Worker

    try {
      await installDnrRedirectRules(worker, "abcdefghijklmnop", [
        {
          id: 9000,
          regexFilter: "^https?://api\\.example\\.test/(.*)$",
          regexSubstitution: "http://127.0.0.1:9999/mock/\\1",
        },
      ])
    } finally {
      Object.assign(globalThis, { chrome: originalChrome })
    }

    const redirect = sessionRules.find((rule) => rule.id === 9000)
    const deny = sessionRules.find(
      (rule) => rule.id === DNR_TEST_NETWORK_BLOCK_RULE_ID
    )

    expect(redirect).toMatchObject({
      priority: 100,
      action: { type: "redirect" },
      condition: {
        initiatorDomains: ["abcdefghijklmnop"],
      },
    })
    expect(deny).toMatchObject({
      priority: 1,
      action: { type: "block" },
      condition: {
        regexFilter: "^https?://",
        initiatorDomains: ["abcdefghijklmnop"],
        excludedRequestDomains: ["127.0.0.1", "localhost"],
        resourceTypes: DEFAULT_DNR_RESOURCE_TYPES,
      },
    })
  })

  it("reserves the deny-rule id for the fixture guard", async () => {
    const worker = { evaluate: async () => undefined } as unknown as Worker

    await expect(
      installDnrRedirectRules(worker, "abcdefghijklmnop", [
        {
          id: DNR_TEST_NETWORK_BLOCK_RULE_ID,
          regexFilter: "^https?://api\\.example\\.test/(.*)$",
          regexSubstitution: "http://127.0.0.1:9999/mock/\\1",
        },
      ])
    ).rejects.toThrow(/reserved/)
  })
})
