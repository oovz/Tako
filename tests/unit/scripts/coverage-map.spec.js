import { describe, expect, it } from "vitest"

import {
  canonicalizeCoverageMap,
  canonicalizeCoveragePath,
  mergeCoverageMaps,
} from "@/scripts/coverage-map.mjs"

function fileCoverage(filePath, { statementId, line, hits }) {
  return {
    path: filePath,
    statementMap: {
      [statementId]: {
        start: { line, column: 0 },
        end: { line, column: 5 },
      },
    },
    fnMap: {},
    branchMap: {},
    s: { [statementId]: hits },
    f: {},
    b: {},
  }
}

function location(line) {
  return {
    start: { line, column: 0 },
    end: { line, column: 5 },
  }
}

function richCoverage(filePath, id, line, hits) {
  return {
    path: filePath,
    statementMap: { [id]: location(line) },
    fnMap: {
      [id]: {
        name: `fn-${line}`,
        decl: location(line),
        loc: location(line),
        line,
      },
    },
    branchMap: {
      [id]: {
        line,
        type: "if",
        locations: [location(line), location(line)],
      },
    },
    s: { [id]: hits },
    f: { [id]: hits },
    b: { [id]: [hits, 0] },
  }
}

describe("coverage path canonicalization", () => {
  it.each([
    ["C:\\repo\\src\\example.ts", "C:\\repo"],
    ["C:/repo/src/example.ts", "C:\\repo"],
    ["/C:/repo/src/example.ts", "C:\\repo"],
    ["file:///C:/repo/src/example.ts", "C:\\repo"],
    ["/repo/src/example.ts", "/repo"],
    ["src\\example.ts", "C:\\repo"],
  ])("normalizes %s to a repository-relative slash path", (input, root) => {
    expect(canonicalizeCoveragePath(input, root)).toBe("src/example.ts")
  })

  it("canonicalizes both the map key and embedded file path", () => {
    const map = canonicalizeCoverageMap(
      {
        "C:\\repo\\src\\example.ts": fileCoverage(
          "file:///C:/repo/src/example.ts",
          { statementId: "0", line: 1, hits: 1 }
        ),
      },
      "C:\\repo"
    )

    expect(Object.keys(map)).toEqual(["src/example.ts"])
    expect(map["src/example.ts"].path).toBe("src/example.ts")
  })

  it("removes already-applied input source maps before NYC reporting", () => {
    const coverage = fileCoverage("/C:/repo/src/example.ts", {
      statementId: "0",
      line: 1,
      hits: 1,
    })
    coverage.inputSourceMap = {
      version: 3,
      sources: ["C:/repo/src/example.ts"],
      names: [],
      mappings: "AAAA",
      sourcesContent: ["export const value = 1;"],
    }

    const map = canonicalizeCoverageMap(
      { "/C:/repo/src/example.ts": coverage },
      "C:\\repo"
    )

    const serialized = JSON.parse(JSON.stringify(map))
    expect(serialized["src/example.ts"]).not.toHaveProperty("inputSourceMap")
  })

  it("rejects absolute and relative paths outside the repository", () => {
    expect(() =>
      canonicalizeCoveragePath("C:\\other\\example.ts", "C:\\repo")
    ).toThrow(/outside/i)
    expect(() =>
      canonicalizeCoveragePath("..\\other\\example.ts", "C:\\repo")
    ).toThrow(/outside/i)
  })
})

describe("coverage map merging", () => {
  it("merges matching locations and preserves incompatible numeric IDs", () => {
    const merged = mergeCoverageMaps(
      [
        {
          "C:\\repo\\src\\example.ts": fileCoverage(
            "C:\\repo\\src\\example.ts",
            { statementId: "0", line: 1, hits: 2 }
          ),
        },
        {
          "C:/repo/src/example.ts": {
            ...fileCoverage("C:/repo/src/example.ts", {
              statementId: "0",
              line: 2,
              hits: 3,
            }),
            statementMap: {
              0: {
                start: { line: 2, column: 0 },
                end: { line: 2, column: 5 },
              },
              8: {
                start: { line: 1, column: 0 },
                end: { line: 1, column: 5 },
              },
            },
            s: { 0: 3, 8: 5 },
          },
        },
      ],
      "C:\\repo"
    )

    expect(Object.keys(merged)).toEqual(["src/example.ts"])
    const file = merged["src/example.ts"]
    const hitsByLine = Object.fromEntries(
      Object.entries(file.statementMap).map(([id, location]) => [
        location.start.line,
        file.s[id],
      ])
    )
    expect(hitsByLine).toEqual({ 1: 7, 2: 3 })
  })

  it("reindexes functions and branches by location instead of numeric ID", () => {
    const first = richCoverage("C:\\repo\\src\\example.ts", "0", 1, 2)
    const second = richCoverage("C:/repo/src/example.ts", "0", 2, 3)
    const matching = richCoverage("C:/repo/src/example.ts", "8", 1, 5)
    second.fnMap[8] = matching.fnMap[8]
    second.branchMap[8] = matching.branchMap[8]
    second.f[8] = matching.f[8]
    second.b[8] = matching.b[8]

    const merged = mergeCoverageMaps(
      [
        { "C:\\repo\\src\\example.ts": first },
        { "C:/repo/src/example.ts": second },
      ],
      "C:\\repo"
    )["src/example.ts"]

    const functionHitsByLine = Object.fromEntries(
      Object.entries(merged.fnMap).map(([id, entry]) => [
        entry.loc.start.line,
        merged.f[id],
      ])
    )
    const branchHitsByLine = Object.fromEntries(
      Object.entries(merged.branchMap).map(([id, entry]) => [
        entry.locations[0].start.line,
        merged.b[id],
      ])
    )
    expect(functionHitsByLine).toEqual({ 1: 7, 2: 3 })
    expect(branchHitsByLine).toEqual({ 1: [7, 0], 2: [3, 0] })
  })
})
