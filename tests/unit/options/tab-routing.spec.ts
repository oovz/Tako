import { describe, expect, it } from "vitest"

import {
  getInitialOptionsSection,
  getLinkedActivityTaskId,
  getOptionsSectionUrl,
} from "@/entrypoints/options/tab-routing"

describe("options section URL routing", () => {
  it("opens task links only in Activity and clears them during section navigation", () => {
    const url =
      "chrome-extension://example/options.html?tab=activity&task=folder%26task"

    expect(getLinkedActivityTaskId(new URL(url).search)).toBe("folder&task")
    expect(
      getLinkedActivityTaskId("?tab=storage&task=folder%26task")
    ).toBeUndefined()
    expect(getOptionsSectionUrl(url, "storage")).toBe(
      "chrome-extension://example/options.html?tab=storage"
    )
  })

  it("preserves unrelated query parameters when changing sections", () => {
    expect(
      getOptionsSectionUrl(
        "chrome-extension://example/options.html?source=sidepanel",
        "storage"
      )
    ).toBe(
      "chrome-extension://example/options.html?source=sidepanel&tab=storage"
    )
  })

  it("round-trips every supported section", () => {
    for (const section of [
      "general",
      "storage",
      "network",
      "integrations",
      "activity",
    ] as const) {
      const url = getOptionsSectionUrl(
        "chrome-extension://example/options.html",
        section
      )
      expect(getInitialOptionsSection(new URL(url).search)).toBe(section)
    }
  })

  it("uses the general section for unrecognized query values", () => {
    expect(getInitialOptionsSection("?tab=unknown")).toBe("general")
    expect(getInitialOptionsSection("?tab=constructor")).toBe("general")
    expect(getInitialOptionsSection("::not-a-query")).toBe("general")
  })

  it("uses the general section when the query has no section", () => {
    expect(getInitialOptionsSection("")).toBe("general")
    expect(getInitialOptionsSection("?foo=bar")).toBe("general")
  })
})
