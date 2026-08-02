import { describe, expect, it } from "vitest"

import { getTaskStatusLabel } from "@/entrypoints/sidepanel/components/command-center-queue-helpers"

describe("command center task status labels", () => {
  it("uses the explicit Partial success label required by the product spec", () => {
    expect(getTaskStatusLabel("partial_success")).toBe("Partial success")
  })

  it("surfaces nonterminal block reasons ahead of the broad task status", () => {
    expect(getTaskStatusLabel("queued", "destination_action_required")).toBe(
      "Download folder action required"
    )
    expect(
      getTaskStatusLabel("queued", "provider_network_policy_pending")
    ).toBe("Waiting for provider access")
  })

  it("surfaces durable Chrome download waiting state", () => {
    expect(
      getTaskStatusLabel("downloading", undefined, {
        downloadIds: [42],
        since: 1_000,
      })
    ).toBe("Waiting for Chrome Downloads")
  })
})
