import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("FsaBanner download-state query boundary", () => {
  const source = readFileSync(
    join(
      process.cwd(),
      "entrypoints",
      "sidepanel",
      "components",
      "FsaBanner.tsx"
    ),
    "utf8"
  )

  it("uses the typed sidepanel query and storage signals without durable reads", () => {
    expect(source).toContain('type: "GET_SIDEPANEL_DOWNLOAD_STATE"')
    expect(source).toContain("chrome.storage.onChanged.addListener")
    expect(source).not.toContain("useChromeStorageValue")
    expect(source).not.toContain("chrome.storage.local.get")
  })

  it("keeps the narrow sidepanel layout responsive", () => {
    expect(source).toContain("flex-wrap")
    expect(source).toContain("break-words")
    expect(source).toContain("max-w-full")
  })
})
