import { describe, expect, it } from "vitest"

import { getTaskStatusLabel } from "@/entrypoints/sidepanel/components/command-center-queue-helpers"

describe("command center task status labels", () => {
  it("uses the explicit Partial success label", () => {
    expect(getTaskStatusLabel("partial_success")).toBe("Partial success")
  })

  it("labels completed results from save evidence and preserves failure status", () => {
    expect(getTaskStatusLabel("completed", undefined, "downloads-api")).toBe(
      "Previously processed"
    )
    expect(
      getTaskStatusLabel("completed", undefined, "downloads-api", 42)
    ).toBe("Saved")
    expect(getTaskStatusLabel("completed", undefined, "fsa", 42)).toBe(
      "Saved to folder"
    )
    expect(getTaskStatusLabel("completed")).toBe("Previously processed")
    expect(getTaskStatusLabel("failed", undefined, "downloads-api")).toBe(
      "Failed"
    )
    expect(getTaskStatusLabel("partial_success", undefined, "fsa")).toBe(
      "Partial success"
    )
  })

  it("surfaces nonterminal block reasons ahead of the broad task status", () => {
    expect(getTaskStatusLabel("queued", "destination_action_required")).toBe(
      "Download folder action required"
    )
    expect(
      getTaskStatusLabel("queued", "provider_network_policy_pending")
    ).toBe("Waiting for provider access")
  })
})
