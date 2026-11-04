import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import process from "node:process"
import { spawnSync } from "node:child_process"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { siteIntegrationWxtPermissions } from "@/src/runtime/generated/site-integration-wxt-permissions"

const repository = process.cwd()
let workspace: string

beforeEach(() => {
  workspace = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "tako-wxt-policy-"))
  )
  fs.mkdirSync(path.join(workspace, "entrypoints"))
  fs.writeFileSync(
    path.join(workspace, "package.json"),
    JSON.stringify({
      name: "tako-policy-probe",
      version: "1.0.0",
      type: "module",
    })
  )
  fs.symlinkSync(
    path.join(repository, "node_modules"),
    path.join(workspace, "node_modules"),
    process.platform === "win32" ? "junction" : "dir"
  )
  fs.writeFileSync(
    path.join(workspace, "entrypoints/background.ts"),
    `import { defineBackground } from "wxt/utils/define-background"
export default defineBackground(() => {
  globalThis.takoPolicyProbe = [__TAKO_E2E_STATE_SEED__, __TAKO_E2E_REDIRECTS__]
})
`
  )
})
afterEach(() => fs.rmSync(workspace, { recursive: true, force: true }))

describe("WXT build artifacts", () => {
  it.each([
    { mode: "production", state: false, redirects: false },
    { mode: "e2e-test", state: true, redirects: true },
  ])(
    "executes the $mode artifact with its configured capabilities",
    ({ mode, state, redirects }) => {
      const runner = `import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"
const require = createRequire(${JSON.stringify(path.join(repository, "package.json"))})
const { build } = await import(pathToFileURL(require.resolve("wxt")).href)
let outputDirectory
const output = await build({
  root: process.cwd(),
  configFile: ${JSON.stringify(path.join(repository, "wxt.config.ts"))},
  mode: ${JSON.stringify(mode)},
  outDir: "dist",
  hooks: { "config:resolved": (wxt) => { outputDirectory = wxt.config.outDir } },
})
await import(pathToFileURL(path.join(outputDirectory, output.manifest.background.service_worker)).href)
fs.writeFileSync("result.json", JSON.stringify({
  manifest: output.manifest,
  probe: globalThis.takoPolicyProbe,
}))
`
      const environment: typeof process.env = {
        ...process.env,
        TAKO_E2E_STATE_SEED: "true",
      }
      delete environment.NODE_ENV
      const execution = spawnSync(
        process.execPath,
        ["--input-type=module", "--eval", runner],
        { cwd: workspace, env: environment, encoding: "utf8", timeout: 30_000 }
      )
      expect(execution.status, execution.stderr).toBe(0)
      const result = JSON.parse(
        fs.readFileSync(path.join(workspace, "result.json"), "utf8")
      )
      expect(result.probe).toEqual([state, redirects])
      if (mode === "production") {
        expect(result.manifest.host_permissions).toEqual([
          ...siteIntegrationWxtPermissions.requiredOrigins,
        ])
        expect(result.manifest.optional_host_permissions).toEqual([
          ...siteIntegrationWxtPermissions.optionalOrigins,
        ])
      } else {
        expect(result.manifest.host_permissions).toEqual([
          ...siteIntegrationWxtPermissions.requiredOrigins,
          ...siteIntegrationWxtPermissions.optionalOrigins,
          "http://127.0.0.1/*",
        ])
        expect(result.manifest.optional_host_permissions).toEqual([])
      }
    },
    30_000
  )
})
