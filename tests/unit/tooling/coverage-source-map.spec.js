import console from "node:console"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import vm from "node:vm"
import ts from "typescript"
import { transformWithOxc } from "vite"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  canonicalizeCoverageMap,
  mergeCoverageMaps,
} from "@/scripts/coverage-map.mjs"
import { mergeCoverageReports } from "@/scripts/merge-coverage-runner.mjs"

const require = createRequire(import.meta.url)
const { createInstrumenter } = createRequire(
  require.resolve("nyc/package.json")
)("istanbul-lib-instrument")
const source = `type Input = {
  value: number
}
function choose(input: Input): number {
  const result = input.value > 0 ? input.value : -input.value
  return result
}
`
let workspace

function transpile(code, fileName) {
  return ts.transpileModule(code, {
    fileName,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      sourceMap: true,
      inlineSources: true,
    },
  })
}

function collectedCoverage({
  original = false,
  values = [3, -2],
  sourceText = source,
} = {}) {
  const file = path.join(workspace, "src/sample.ts")
  const instrumenter = createInstrumenter({ parserPlugins: ["typescript"] })
  const compiled = transpile(sourceText, file)
  const code = original
    ? transpile(instrumenter.instrumentSync(sourceText, file), file).outputText
    : instrumenter.instrumentSync(
        compiled.outputText,
        file,
        JSON.parse(compiled.sourceMapText)
      )
  const context = {}
  vm.runInNewContext(code, context)
  for (const value of values) {
    expect(context.choose({ value })).toBe(Math.abs(value))
  }
  return globalThis.structuredClone(context.__coverage__)
}

function hitsByLine(file) {
  const hits = {}
  for (const [id, location] of Object.entries(file.statementMap)) {
    const line = location.start.line
    hits[line] = (hits[line] ?? 0) + file.s[id]
  }
  return hits
}

function write(relative, coverage) {
  const target = path.join(workspace, relative)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, JSON.stringify(coverage))
}

beforeEach(() => {
  workspace = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "tako-source-map-"))
  )
  vi.spyOn(console, "log").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(workspace, { recursive: true, force: true })
})

describe("coverage source coordinates", () => {
  it("maps compiled TSX ranges whose generated closing lines have no source content or mapping", async () => {
    const sourceText = `type Props = { className?: string; id?: string }
const Called = ({ className, ...props }: Props) => (
  <div className={className} {...props} />
)

const Untouched = ({ className, ...props }: Props) => (
  <div className={className} {...props} />
)
`
    const filePath = path.join(workspace, "src/layout.tsx")
    const compiled = await transformWithOxc(sourceText, filePath, {
      lang: "tsx",
      jsx: { runtime: "automatic", development: true },
      sourcemap: true,
    })
    delete compiled.map.sourcesContent
    const instrumented = createInstrumenter().instrumentSync(
      compiled.code,
      filePath,
      compiled.map
    )
    const executable = ts.transpileModule(instrumented, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
      },
    }).outputText
    const context = { exports: {}, require }
    vm.runInNewContext(
      `${executable}\nglobalThis.rendered = Called({ className: "called", id: "active" })`,
      context
    )
    expect(context.rendered.type).toBe("div")
    expect(context.rendered.props).toEqual({
      className: "called",
      id: "active",
    })
    const raw = globalThis.structuredClone(context.__coverage__)
    const before = globalThis.structuredClone(raw)

    const normalized = await canonicalizeCoverageMap(raw, workspace)
    const file = normalized["src/layout.tsx"]

    expect(hitsByLine(file)).toEqual({ 2: 1, 3: 1, 6: 1, 7: 0 })
    expect(
      Object.values(file.fnMap).map((fn) => ({
        declaration: fn.decl.start.line,
        body: fn.loc.start.line,
      }))
    ).toEqual([
      { declaration: 2, body: 3 },
      { declaration: 6, body: 7 },
    ])
    expect(Object.values(file.f)).toEqual([1, 0])
    expect(file).not.toHaveProperty("inputSourceMap")
    expect(raw).toEqual(before)
  })

  it("maps executed JavaScript counters to TypeScript before consuming its source map", async () => {
    const raw = collectedCoverage()
    const before = globalThis.structuredClone(raw)
    const map = await canonicalizeCoverageMap(raw, workspace)
    const file = map["src/sample.ts"]

    expect(hitsByLine(file)).toEqual({ 5: 2, 6: 2 })
    expect(Object.values(file.fnMap)).toEqual([
      expect.objectContaining({
        name: "choose",
        decl: {
          start: { line: 4, column: 9 },
          end: { line: 4, column: 15 },
        },
      }),
    ])
    expect(
      Object.values(file.branchMap)[0].locations.map((loc) => loc.start.line)
    ).toEqual([5, 5])
    expect(Object.values(file.b)).toEqual([[1, 1]])
    expect(
      Object.values(file.statementMap).find((loc) => loc.start.line === 6).end
        .column
    ).toBeNull()
    expect(file).not.toHaveProperty("inputSourceMap")
    expect(await canonicalizeCoverageMap(map, workspace)).toEqual(map)
    expect(raw).toEqual(before)
  })

  it("preserves original-source counters and remaps browser inputs before merging them", async () => {
    const native = collectedCoverage({ original: true, values: [4] })
    const nativeFile = Object.values(native)[0]
    const normalized = await canonicalizeCoverageMap(native, workspace)
    expect(normalized["src/sample.ts"]).toEqual({
      ...nativeFile,
      path: "src/sample.ts",
    })

    const merged = await mergeCoverageMaps(
      [native, collectedCoverage()],
      workspace
    )
    const file = merged["src/sample.ts"]
    expect(Object.keys(merged)).toEqual(["src/sample.ts"])
    expect(hitsByLine(file)).toEqual({ 5: 3, 6: 3 })
    expect(Object.values(file.b)).toEqual([[2, 1]])
    expect(
      Object.values(file.fnMap).every((fn) => fn.decl.start.line === 4)
    ).toBe(true)
    expect(file).not.toHaveProperty("inputSourceMap")
  })

  it("merges persisted unbounded columns with the same remapped source range", async () => {
    const native = collectedCoverage({ original: true, values: [4] })
    const nativeFile = Object.values(native)[0]
    const returnLocation = Object.values(nativeFile.statementMap).find(
      (loc) => loc.start.line === 6
    )
    // Native JSON reports use null for an unbounded end column.
    returnLocation.end.column = null

    const merged = await mergeCoverageMaps(
      [native, collectedCoverage()],
      workspace
    )
    const file = merged["src/sample.ts"]
    const returns = Object.entries(file.statementMap).filter(
      ([, loc]) => loc.start.line === 6
    )
    expect(returns).toHaveLength(1)
    expect(file.s[returns[0][0]]).toBe(3)
  })

  it("writes original TypeScript locations for both report consumers", async () => {
    write(
      "coverage/coverage-final.json",
      collectedCoverage({ original: true, values: [4] })
    )
    write(
      "coverage/runtime/coverage-final.json",
      collectedCoverage({ original: true, values: [4] })
    )
    write(
      ".nyc_output/e2e/coverage-page-one.json",
      collectedCoverage({ values: [-2] })
    )
    write(
      ".nyc_output/e2e/coverage-worker-one.json",
      collectedCoverage({ values: [3] })
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
    const file = JSON.parse(merged)["src/sample.ts"]
    expect(hitsByLine(file)).toEqual({ 5: 3, 6: 3 })
    expect(Object.values(file.b)).toEqual([[2, 1]])
    expect(file).not.toHaveProperty("inputSourceMap")
  })

  it("rejects a mapped source outside the repository before replacing prior output", async () => {
    const raw = collectedCoverage()
    Object.values(raw)[0].inputSourceMap.sources = ["../../outside.ts"]
    write("coverage/coverage-final.json", collectedCoverage({ original: true }))
    write(
      "coverage/runtime/coverage-final.json",
      collectedCoverage({ original: true })
    )
    write(".nyc_output/e2e/coverage-page-one.json", raw)
    write(".nyc_output/e2e/coverage-worker-one.json", {})
    const prior = { retained: "prior result" }
    write(".nyc_output/merged/coverage-final.json", prior)
    write(".nyc_output/coverage-final.json", prior)

    await expect(mergeCoverageReports(workspace)).rejects.toThrow(
      /outside the repository/
    )

    for (const relative of [
      ".nyc_output/merged/coverage-final.json",
      ".nyc_output/coverage-final.json",
    ]) {
      expect(
        JSON.parse(fs.readFileSync(path.join(workspace, relative), "utf8"))
      ).toEqual(prior)
    }
  })

  it("rejects an unusable source map instead of retaining generated coordinates", async () => {
    const raw = collectedCoverage()
    Object.values(raw)[0].inputSourceMap.version = -1

    await expect(canonicalizeCoverageMap(raw, workspace)).rejects.toThrow(
      /Unable to remap coverage source/
    )
  })

  it.each([false, true])(
    "rejects a source whose map loses every location with another usable source=%s",
    async (mixed) => {
      const raw = collectedCoverage()
      Object.values(raw)[0].inputSourceMap.mappings = ""
      if (mixed) {
        const otherPath = path.join(workspace, "src/other.ts")
        const other = Object.values(collectedCoverage({ original: true }))[0]
        raw[otherPath] = { ...other, path: otherPath }
      }
      const before = globalThis.structuredClone(raw)

      await expect(canonicalizeCoverageMap(raw, workspace)).rejects.toThrow(
        /lost all coverage locations/
      )

      expect(raw).toEqual(before)
    }
  )

  it("allows a type-only source map with no executable locations", async () => {
    const raw = collectedCoverage({
      sourceText: "type Empty = { value: number }",
      values: [],
    })

    expect(await canonicalizeCoverageMap(raw, workspace)).toEqual({})
  })

  it("rejects late browser source-map loss before replacing either report", async () => {
    const raw = collectedCoverage()
    Object.values(raw)[0].inputSourceMap.mappings = ""
    write("coverage/coverage-final.json", collectedCoverage({ original: true }))
    write(
      "coverage/runtime/coverage-final.json",
      collectedCoverage({ original: true })
    )
    write(".nyc_output/e2e/coverage-page-one.json", collectedCoverage())
    write(".nyc_output/e2e/coverage-worker-one.json", raw)
    const prior = { retained: "prior result" }
    write(".nyc_output/merged/coverage-final.json", prior)
    write(".nyc_output/coverage-final.json", prior)

    await expect(mergeCoverageReports(workspace)).rejects.toThrow(
      /lost all coverage locations/
    )

    for (const relative of [
      ".nyc_output/merged/coverage-final.json",
      ".nyc_output/coverage-final.json",
    ]) {
      expect(
        JSON.parse(fs.readFileSync(path.join(workspace, relative), "utf8"))
      ).toEqual(prior)
    }
  })
})
