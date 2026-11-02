import console from "node:console"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mergeCoverageReports } from "@/scripts/merge-coverage-runner.mjs"

let workspace
function coverage(file, hits) {
  return {
    [file]: {
      path: file,
      statementMap: {
        0: { start: { line: 1, column: 0 }, end: { line: 1, column: 5 } },
      },
      fnMap: {},
      branchMap: {},
      s: { 0: hits },
      f: {},
      b: {},
    },
  }
}
function write(relative, value) {
  const target = path.join(workspace, relative)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, JSON.stringify(value))
}

beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "tako-merge-artifacts-"))
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(workspace, { recursive: true, force: true })
})

describe("combined coverage artifacts", () => {
  it("merges every JSON source and writes equal canonical maps for direct and NYC consumers", async () => {
    write(
      "coverage/coverage-final.json",
      coverage(path.join(workspace, "src/file.ts"), 2)
    )
    write("coverage/runtime/coverage-final.json", coverage("src/file.ts", 2))
    write(".nyc_output/e2e/coverage-page-one.json", coverage("src/file.ts", 3))
    write(
      ".nyc_output/e2e/coverage-worker-one.json",
      coverage("src/file.ts", 5)
    )
    write(".nyc_output/e2e/additional.json", coverage("src/file.ts", 7))
    fs.writeFileSync(
      path.join(workspace, ".nyc_output/e2e/ignored.txt"),
      "not JSON"
    )
    await mergeCoverageReports(workspace)
    const merged = fs.readFileSync(
      path.join(workspace, ".nyc_output/merged/coverage-final.json"),
      "utf8"
    )
    expect(
      fs.readFileSync(
        path.join(workspace, ".nyc_output/coverage-final.json"),
        "utf8"
      )
    ).toBe(merged)
    expect(Object.keys(JSON.parse(merged))).toEqual(["src/file.ts"])
    expect(JSON.parse(merged)["src/file.ts"].s).toEqual({ 0: 17 })
  })

  it("selects runtime Istanbul records by file identity and retains V8-only sources", async () => {
    const runtimePath = "src/file.ts"
    const nativeRuntime = coverage(path.join(workspace, runtimePath), 100)
    const nativeFile = Object.values(nativeRuntime)[0]
    nativeFile.statementMap[1] = {
      start: { line: 2, column: 0 },
      end: { line: 2, column: 5 },
    }
    nativeFile.s[1] = 100
    write("coverage/coverage-final.json", {
      ...nativeRuntime,
      ...coverage("scripts/tool.mjs", 5),
      ...coverage("src/site-integrations/mangadex/probe.ts", 7),
    })
    const runtime = coverage(runtimePath, 0)
    runtime[runtimePath].branchMap[0] = {
      type: "if",
      loc: { start: { line: 3, column: 0 }, end: { line: 3, column: 5 } },
      locations: [
        { start: { line: 3, column: 0 }, end: { line: 3, column: 2 } },
        { start: { line: 3, column: 3 }, end: { line: 3, column: 5 } },
      ],
    }
    runtime[runtimePath].b[0] = [0, 0]
    write("coverage/runtime/coverage-final.json", runtime)
    write(".nyc_output/e2e/coverage-page-one.json", coverage(runtimePath, 3))
    write(".nyc_output/e2e/coverage-worker-one.json", coverage(runtimePath, 0))

    await mergeCoverageReports(workspace)

    const merged = JSON.parse(
      fs.readFileSync(
        path.join(workspace, ".nyc_output/merged/coverage-final.json"),
        "utf8"
      )
    )
    expect(merged[runtimePath].s).toEqual({ 0: 3 })
    expect(merged[runtimePath].b).toEqual({ 0: [0, 0] })
    expect(merged["scripts/tool.mjs"].s).toEqual({ 0: 5 })
    expect(merged["src/site-integrations/mangadex/probe.ts"].s).toEqual({
      0: 7,
    })
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(workspace, "coverage/coverage-final.json"),
          "utf8"
        )
      )[path.join(workspace, runtimePath)].s
    ).toEqual({ 0: 100, 1: 100 })
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(workspace, "coverage/runtime/coverage-final.json"),
          "utf8"
        )
      )
    ).toEqual(runtime)
  })

  it.each(["native", "runtime", "page", "worker"])(
    "rejects missing %s input before replacing prior output",
    async (missing) => {
      if (missing !== "native")
        write("coverage/coverage-final.json", coverage("src/file.ts", 1))
      if (missing !== "runtime")
        write(
          "coverage/runtime/coverage-final.json",
          coverage("src/file.ts", 1)
        )
      if (missing !== "page")
        write(
          ".nyc_output/e2e/coverage-page-one.json",
          coverage("src/file.ts", 1)
        )
      if (missing !== "worker")
        write(
          ".nyc_output/e2e/coverage-worker-one.json",
          coverage("src/file.ts", 1)
        )
      write(".nyc_output/merged/coverage-final.json", {
        retained: "prior result",
      })
      await expect(mergeCoverageReports(workspace)).rejects.toThrow(
        /Cannot merge partial coverage/
      )
      expect(
        JSON.parse(
          fs.readFileSync(
            path.join(workspace, ".nyc_output/merged/coverage-final.json"),
            "utf8"
          )
        )
      ).toEqual({ retained: "prior result" })
      expect(
        fs.existsSync(path.join(workspace, ".nyc_output/coverage-final.json"))
      ).toBe(false)
    }
  )

  it("rejects a missing browser coverage directory before writing", async () => {
    write("coverage/coverage-final.json", coverage("src/file.ts", 1))
    write("coverage/runtime/coverage-final.json", coverage("src/file.ts", 1))
    await expect(mergeCoverageReports(workspace)).rejects.toThrow(
      /Cannot merge partial coverage/
    )
    expect(fs.existsSync(path.join(workspace, ".nyc_output"))).toBe(false)
  })

  it.each([
    ["V8", "coverage/coverage-final.json"],
    ["runtime", "coverage/runtime/coverage-final.json"],
    ["page", ".nyc_output/e2e/coverage-page-one.json"],
    ["worker", ".nyc_output/e2e/coverage-worker-one.json"],
  ])(
    "rejects an empty %s producer before replacing prior report artifacts",
    async (_producer, emptyPath) => {
      const usable = coverage("src/file.ts", 0)
      write("coverage/coverage-final.json", usable)
      write("coverage/runtime/coverage-final.json", usable)
      write(".nyc_output/e2e/coverage-page-one.json", usable)
      write(".nyc_output/e2e/coverage-worker-one.json", usable)
      write(emptyPath, {})
      const prior = { retained: "prior result" }
      write(".nyc_output/merged/coverage-final.json", prior)
      write(".nyc_output/coverage-final.json", prior)

      await expect(mergeCoverageReports(workspace)).rejects.toThrow(
        /Cannot merge partial coverage/
      )

      for (const relative of [
        ".nyc_output/merged/coverage-final.json",
        ".nyc_output/coverage-final.json",
      ]) {
        expect(
          JSON.parse(fs.readFileSync(path.join(workspace, relative), "utf8"))
        ).toEqual(prior)
      }
    }
  )

  it("accepts zero-hit producers and individually empty browser artifacts within usable groups", async () => {
    const zero = coverage("src/file.ts", 0)
    write("coverage/coverage-final.json", zero)
    write("coverage/runtime/coverage-final.json", zero)
    write(".nyc_output/e2e/coverage-page-empty.json", {})
    write(".nyc_output/e2e/coverage-page-usable.json", zero)
    write(".nyc_output/e2e/coverage-worker-empty.json", {})
    write(".nyc_output/e2e/coverage-worker-usable.json", zero)

    await mergeCoverageReports(workspace)

    const merged = JSON.parse(
      fs.readFileSync(
        path.join(workspace, ".nyc_output/merged/coverage-final.json"),
        "utf8"
      )
    )
    expect(merged["src/file.ts"].s).toEqual({ 0: 0 })
  })

  it("rejects empty combined maps before writing report artifacts", async () => {
    write("coverage/coverage-final.json", {})
    write("coverage/runtime/coverage-final.json", {})
    write(".nyc_output/e2e/coverage-page-one.json", {})
    write(".nyc_output/e2e/coverage-worker-one.json", {})
    await expect(mergeCoverageReports(workspace)).rejects.toThrow(
      /Cannot merge partial coverage/
    )
    expect(fs.existsSync(path.join(workspace, ".nyc_output/merged"))).toBe(
      false
    )
  })

  it("propagates malformed JSON without replacing report artifacts", async () => {
    write("coverage/coverage-final.json", {})
    fs.writeFileSync(path.join(workspace, "coverage/coverage-final.json"), "{")
    await expect(mergeCoverageReports(workspace)).rejects.toThrow(SyntaxError)
    expect(fs.existsSync(path.join(workspace, ".nyc_output"))).toBe(false)
  })
})
