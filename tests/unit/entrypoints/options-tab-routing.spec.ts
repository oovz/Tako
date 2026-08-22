import { describe, expect, it } from "vitest"

import { getInitialOptionsSection } from "@/entrypoints/options/tab-routing"

describe("options tab routing", () => {
  it("maps integrations deep-link query to integrations section", () => {
    expect(getInitialOptionsSection("?tab=integrations")).toBe("integrations")
  })

  it("returns general for unknown tabs and invalid query strings", () => {
    expect(getInitialOptionsSection("?tab=removed-section")).toBe("general")
    expect(getInitialOptionsSection("?tab=unknown")).toBe("general")
    expect(getInitialOptionsSection("::not-a-query")).toBe("general")
  })

  it("returns general when no tab parameter is present", () => {
    expect(getInitialOptionsSection("")).toBe("general")
    expect(getInitialOptionsSection("?foo=bar")).toBe("general")
  })
})
