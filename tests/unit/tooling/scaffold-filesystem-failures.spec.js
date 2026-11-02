import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import process from "node:process"
import { spawnSync } from "node:child_process"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

const scaffold = path.join(process.cwd(), "scripts/new-site-integration.mjs")
let workspace
let source
let fixtures

beforeEach(() => {
  workspace = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "tako-scaffold-filesystem-"))
  )
  source = path.join(workspace, "source-parent/source")
  fixtures = path.join(workspace, "fixture-parent/fixtures")
})
afterEach(() => fs.rmSync(workspace, { recursive: true, force: true }))

function runWithFilesystemChange(change) {
  const preload = path.join(workspace, "filesystem-boundary.mjs")
  fs.writeFileSync(
    preload,
    `import fs from "node:fs"
import path from "node:path"
const source = ${JSON.stringify(source)}
const fixtures = ${JSON.stringify(fixtures)}
const mkdir = fs.mkdirSync.bind(fs)
const rmdir = fs.rmdirSync.bind(fs)
${change}
`
  )
  return spawnSync(
    process.execPath,
    [
      "--import",
      preload,
      scaffold,
      "filesystem-site",
      "--contributor",
      "Tester",
      "--out-dir",
      source,
      "--fixtures-dir",
      fixtures,
    ],
    { cwd: workspace, encoding: "utf8" }
  )
}

describe("scaffold filesystem ownership failures", () => {
  it("accepts a parent directory created by a concurrent owner before mkdir", () => {
    const result = runWithFilesystemChange(`
fs.mkdirSync = (target, ...args) => {
  if (target === path.dirname(source) && !fs.existsSync(target)) {
    mkdir(target)
    fs.writeFileSync(path.join(target, "concurrent.txt"), "retained")
  }
  return mkdir(target, ...args)
}`)
    expect(result.status, result.stderr).toBe(0)
    expect(
      fs.readFileSync(path.join(path.dirname(source), "concurrent.txt"), "utf8")
    ).toBe("retained")
    expect(
      JSON.parse(fs.readFileSync(path.join(source, "definition.json"), "utf8"))
    ).toMatchObject({ id: "filesystem-site" })
    expect(fs.existsSync(path.join(fixtures, "contract.json"))).toBe(true)
  })

  it("rejects a file claiming a planned parent and preserves the concurrent owner's file", () => {
    const result = runWithFilesystemChange(`
fs.mkdirSync = (target, ...args) => {
  if (target === path.dirname(source) && !fs.existsSync(target)) fs.writeFileSync(target, "concurrent owner")
  return mkdir(target, ...args)
}`)
    expect(result.status).toBe(1)
    expect(fs.readFileSync(path.dirname(source), "utf8")).toBe(
      "concurrent owner"
    )
    expect(fs.existsSync(source)).toBe(false)
    expect(fs.existsSync(fixtures)).toBe(false)
  })

  it("propagates parent creation failure without starting the fixture output", () => {
    const result = runWithFilesystemChange(`
fs.mkdirSync = (target, ...args) => {
  if (target === path.dirname(source)) throw Object.assign(new Error("source access denied"), { code: "EACCES" })
  return mkdir(target, ...args)
}`)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("source access denied")
    expect(fs.existsSync(path.dirname(source))).toBe(false)
    expect(fs.existsSync(path.dirname(fixtures))).toBe(false)
  })

  it.each(["removed", "populated", "permission"])(
    "retains the original claim failure when cleanup is %s",
    (cleanup) => {
      const result = runWithFilesystemChange(`
fs.mkdirSync = (target, ...args) => {
  if (target === fixtures) throw Object.assign(new Error("fixture access denied"), { code: "EACCES" })
  return mkdir(target, ...args)
}
fs.rmdirSync = (target, ...args) => {
  if (target === source) {
    if (${JSON.stringify(cleanup)} === "removed") rmdir(target)
    if (${JSON.stringify(cleanup)} === "populated") fs.writeFileSync(path.join(target, "concurrent.txt"), "retained")
    if (${JSON.stringify(cleanup)} === "permission") throw Object.assign(new Error("cleanup access denied"), { code: "EPERM" })
  }
  return rmdir(target, ...args)
}`)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain("fixture access denied")
      expect(fs.existsSync(path.dirname(fixtures))).toBe(false)
      expect(fs.existsSync(path.join(source, "definition.json"))).toBe(false)
      if (cleanup === "removed") {
        expect(fs.existsSync(path.dirname(source))).toBe(false)
      } else if (cleanup === "populated") {
        expect(
          fs.readFileSync(path.join(source, "concurrent.txt"), "utf8")
        ).toBe("retained")
      } else {
        expect(result.stderr).toContain(
          "Unable to remove empty output directory"
        )
        expect(result.stderr).toContain("cleanup access denied")
        expect(fs.existsSync(source)).toBe(true)
      }
    }
  )
})
