import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

describe("global motion preference styles", () => {
  it("supports system and reduced motion without a full-motion override", async () => {
    const css = await readFile(
      new URL("../../../globals.css", import.meta.url),
      "utf8"
    )
    const uiSources = await Promise.all(
      [
        "../../../entrypoints/sidepanel/SidePanelApp.tsx",
        "../../../entrypoints/sidepanel/components/SidePanelQueueRegion.tsx",
        "../../../entrypoints/sidepanel/components/SeriesInlineSelection.tsx",
        "../../../entrypoints/sidepanel/components/SeriesContextCard.tsx",
        "../../../entrypoints/sidepanel/components/ChapterSelector.tsx",
      ].map((path) => readFile(new URL(path, import.meta.url), "utf8"))
    )

    expect(css).toContain("@media (prefers-reduced-motion: reduce)")
    expect(css).not.toContain("html:not([data-tako-motion='full'])")
    expect(css).toMatch(/html\[data-tako-motion=(?:"reduce"|'reduce')\]/)
    expect(css).toContain("animation-duration: 0.01ms !important")
    expect(css).toContain("transition-duration: 0.01ms !important")
    expect(css).toContain("scroll-behavior: auto !important")
    expect(css).not.toContain("data-tako-reduced-motion")
    expect(uiSources.join("\n")).not.toContain("motion-reduce:")
  })
})
