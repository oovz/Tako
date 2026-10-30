import { describe, expect, it } from "vitest"
import {
  canonicalizeCoverageMap,
  canonicalizeCoveragePath,
} from "@/scripts/coverage-map.mjs"

describe("coverage path input boundaries", () => {
  it.each([
    ["file:///repo/space%20dir/file.ts", "/repo", "space dir/file.ts"],
    ["file://localhost/repo/src/file.ts", "/repo", "src/file.ts"],
    [
      "file://server/share/repo/src/file.ts",
      "\\\\server\\share\\repo",
      "src/file.ts",
    ],
    ["src\\file.ts", "/repo", "src/file.ts"],
    [".", "/repo", ""],
  ])("canonicalizes %s within its repository", (input, root, expected) => {
    expect(canonicalizeCoveragePath(input, root)).toBe(expected)
  })

  it.each(["", null, 1])("rejects an invalid coverage path %s", (input) => {
    expect(() => canonicalizeCoveragePath(input, "/repo")).toThrow(TypeError)
  })

  it.each(["", null, 1])("rejects an invalid repository root %s", (root) => {
    expect(() => canonicalizeCoveragePath("src/file.ts", root)).toThrow(
      TypeError
    )
  })

  it.each([
    ["/other/file.ts", "/repo"],
    ["../file.ts", "/repo"],
    ["..", "/repo"],
    ["D:/repo/file.ts", "C:/repo"],
    ["file://another/share/repo/file.ts", "\\\\server\\share\\repo"],
  ])("rejects paths escaping the root: %s", (input, root) => {
    expect(() => canonicalizeCoveragePath(input, root)).toThrow(
      /outside the repository/
    )
  })

  it("rejects conflicting map identities before adding coverage", async () => {
    await expect(
      canonicalizeCoverageMap(
        {
          "/repo/one.ts": { path: "/repo/two.ts" },
        },
        "/repo"
      )
    ).rejects.toThrow(/key and embedded path disagree/)
  })
})
