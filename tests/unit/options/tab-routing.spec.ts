import { describe, expect, it } from "vitest"

import {
  getInitialOptionsSection,
  getOptionsSectionUrl,
} from "@/entrypoints/options/tab-routing"

describe("options section URL routing", () => {
  it("preserves unrelated query parameters when changing sections", () => {
    expect(
      getOptionsSectionUrl(
        "chrome-extension://example/options.html?source=sidepanel",
        "downloads"
      )
    ).toBe(
      "chrome-extension://example/options.html?source=sidepanel&tab=downloads"
    )
  })

  it("round-trips every supported section", () => {
    for (const section of [
      "global",
      "integrations",
      "downloads",
      "debug",
    ] as const) {
      const url = getOptionsSectionUrl(
        "chrome-extension://example/options.html",
        section
      )
      expect(getInitialOptionsSection(new URL(url).search)).toBe(section)
    }
  })
})
