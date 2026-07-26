import { describe, expect, it } from "vitest"

import {
  INLINE_SELECTION_LAYOUT_TRANSITION_PROPERTY,
  shouldUnmountInlineSelectionAfterTransition,
} from "@/entrypoints/sidepanel/SidePanelApp"

describe("inline selection presence", () => {
  it("unmounts the heavy selector only after its layout transition finishes", () => {
    expect(
      shouldUnmountInlineSelectionAfterTransition(
        { propertyName: INLINE_SELECTION_LAYOUT_TRANSITION_PROPERTY },
        false,
        "closed"
      )
    ).toBe(true)
  })

  it("ignores a stale close animation when the selector has been reopened", () => {
    expect(
      shouldUnmountInlineSelectionAfterTransition(
        { propertyName: INLINE_SELECTION_LAYOUT_TRANSITION_PROPERTY },
        true,
        "open"
      )
    ).toBe(false)
  })

  it("does not unmount for an unrelated animation event", () => {
    expect(
      shouldUnmountInlineSelectionAfterTransition(
        { propertyName: "opacity" },
        false,
        "closed"
      )
    ).toBe(false)
  })
})
