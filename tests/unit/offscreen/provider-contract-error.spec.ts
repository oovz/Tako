import { describe, expect, it } from "vitest"

import { classifyOffscreenErrorCategory } from "@/entrypoints/offscreen/error-categories"
import { ProviderContractError } from "@/src/site-integrations/provider-contract-error"

describe("provider contract errors", () => {
  it("uses the structured provider_changed category without parsing text", () => {
    const error = new ProviderContractError(
      "A deliberately opaque provider failure."
    )

    expect(classifyOffscreenErrorCategory(error)).toBe("provider_changed")
  })

  it("ignores unknown explicit categories", () => {
    expect(
      classifyOffscreenErrorCategory({
        category: "not-a-real-category",
        message: "opaque",
      })
    ).toBe("unknown")
  })
})
