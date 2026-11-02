import { describe, expect, it } from "vitest"
import { isInternalUrl } from "@/entrypoints/sidepanel/hooks/sidepanelActiveTabHelpers"

describe("tab URL classification", () => {
  it.each([
    "chrome://newtab",
    "chrome://settings",
    "chrome-extension://test-extension/popup.html",
    "about:blank",
    "edge://settings",
    "devtools://devtools/inspector.html",
    "",
    undefined,
  ])("treats %s as an internal page", (url) => {
    expect(isInternalUrl(url)).toBe(true)
  })

  it.each([
    "https://mangadex.org/",
    "https://mangadex.org/title/abc123/manga-name",
    "https://example.com/",
    "http://localhost:3000",
  ])("treats %s as a web page", (url) => {
    expect(isInternalUrl(url)).toBe(false)
  })
})
