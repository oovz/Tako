import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { afterEach, describe, expect, it } from "vitest"

const checker = path.join(
  process.cwd(),
  "scripts/check-architecture-boundaries.mjs"
)
const workspaces: string[] = []

function check(files: Record<string, string>) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "tako-architecture-"))
  workspaces.push(workspace)
  for (const [file, contents] of Object.entries(files)) {
    const target = path.join(workspace, file)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, contents)
  }
  return spawnSync(process.execPath, [checker], {
    cwd: workspace,
    encoding: "utf8",
  })
}

afterEach(() => {
  for (const workspace of workspaces.splice(0))
    fs.rmSync(workspace, { recursive: true, force: true })
})

describe("architecture rule families", () => {
  it.each([
    'import { value } from "@/src/runtime/dependency"',
    'export { value } from "@/src/runtime/dependency.js"',
    'import dependency = require("../runtime/dependency")',
    'const dependency = import("../runtime/dependency")',
    'type Value = import("../runtime/dependency").Value',
  ])("enforces domain imports through %s", (source) => {
    const result = check({
      "src/domain/feature.ts": source,
      "src/runtime/dependency.ts":
        "export const value = 1; export type Value = number",
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      "Domain code must not import resolved src/runtime/dependency.ts"
    )
  })

  it("permits domain dependencies and ambient names within import declarations", () => {
    const result = check({
      "src/domain/feature.ts":
        'import { chrome, logger } from "./dependency"; export type Value = import("./dependency").Value',
      "src/domain/dependency.ts": "export type Value = number",
    })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain("2 production files, 2 internal imports")
  })

  it("checks domain ambient values, environment, clocks and randomness independently", () => {
    const result = check({
      "src/domain/feature.ts": `import logger from "external/logger.js"
        chrome; logger; import.meta.env;
        Date.now(); Math.random(); performance.now();
        crypto.randomUUID(); crypto.getRandomValues(new Uint8Array(1));`,
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("ambient chrome")
    expect(result.stderr).toContain("must not import the runtime logger")
    expect(result.stderr).toContain("must not use the runtime logger")
    expect(result.stderr).toContain("must not read import.meta.env")
    expect(result.stderr.match(/ambient Date.now/g)).toHaveLength(3)
    expect(result.stderr.match(/ambient crypto randomness/g)).toHaveLength(2)
  })

  it.each([
    ["chrome.runtime.sendMessage({})", "Direct chrome.runtime.sendMessage"],
    [
      "chrome.downloads.download({}); chrome.downloads.search({})",
      "chrome.downloads.download/search",
    ],
    ["fetch('https://example.com')", "Raw fetch()"],
    [
      "projectToQueueView(); service.updateActionBadge()",
      "calls belong only in src/storage/queue-projection-service.ts",
    ],
    ["service.setEnablementMap({})", "setEnablementMap() calls belong only"],
    ["new QueueRepository()", "may construct QueueRepository"],
    ["new RateLimitService()", "may construct RateLimitService"],
  ])("checks the owner of %s", (source, diagnostic) => {
    const result = check({ "src/runtime/feature.ts": source })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(diagnostic)
  })

  it("allows each declared call and construction owner", () => {
    const result = check({
      "src/runtime/send-runtime-message.ts": "chrome.runtime.sendMessage({})",
      "entrypoints/background/native-output-coordinator.ts":
        "chrome.downloads.download({}); chrome.downloads.search({})",
      "src/site-integrations/http-client.ts": "fetch('https://example.com')",
      "src/runtime/i18n.ts": "fetch('https://example.com')",
      "src/storage/queue-projection-service.ts":
        "projectToQueueView(); service.updateActionBadge()",
      "src/runtime/site-integration-initialization.ts":
        "service.setEnablementMap({})",
      "entrypoints/background/index.ts":
        "new QueueRepository(); new RateLimitService()",
      "entrypoints/offscreen/main-worker.ts": "new RateLimitService()",
    })
    expect(result.status, result.stderr).toBe(0)
  })

  it("rejects RateLimitService construction in the superseded offscreen launcher", () => {
    const result = check({
      "entrypoints/offscreen/main.ts": "new RateLimitService()",
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("may construct RateLimitService")
  })

  it("unwraps TypeScript and parenthesized call receivers before checking ownership", () => {
    const result = check({
      "src/runtime/feature.ts": `(chrome.runtime.sendMessage)({});
        (chrome.runtime.sendMessage as Function)({});
        chrome.runtime.sendMessage!({});
        (<Function>chrome.runtime.sendMessage)({});`,
    })
    expect(result.status).toBe(1)
    expect(
      result.stderr.match(/Direct chrome.runtime.sendMessage/g)
    ).toHaveLength(4)
  })

  it("reports cycles across resolved index, re-export and dynamic imports", () => {
    const result = check({
      "src/domain/first.ts": 'export { second } from "./second"',
      "src/domain/second/index.ts": 'const third = import("../third")',
      "src/domain/third.ts": 'import { first } from "./first"',
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("Internal import cycle:")
    expect(result.stderr).toContain("src/domain/second/index.ts")
  })

  it("permits a shared dependency without reporting a cycle", () => {
    const result = check({
      "src/domain/first.ts": 'import "./shared"; import "./second"',
      "src/domain/second.ts": 'import "./shared"',
      "src/domain/shared.ts": "export {}",
    })
    expect(result.status, result.stderr).toBe(0)
  })

  it("rejects a restored obsolete runtime path", () => {
    const result = check({ "src/runtime/centralized-state.ts": "export {}" })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      "Obsolete production path must remain deleted"
    )
  })
})
