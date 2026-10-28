import { afterEach, beforeEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"

const root = process.cwd()
const generator = path.join(
  root,
  "scripts/generate-site-integration-registries.mjs"
)
let workspace: string
let fixturesDirectory: string

function generate() {
  return spawnSync(process.execPath, [generator], {
    cwd: workspace,
    encoding: "utf8",
  })
}

beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "tako-fixture-validation-"))
  const sourceDirectory = path.join(
    workspace,
    "src/site-integrations/mangamillion"
  )
  fixturesDirectory = path.join(
    workspace,
    "tests/fixtures/site-integrations/mangamillion"
  )
  fs.mkdirSync(path.join(sourceDirectory, "contracts"), { recursive: true })
  fs.mkdirSync(fixturesDirectory, { recursive: true })
  const definition = JSON.parse(
    fs.readFileSync(
      path.join(root, "src/site-integrations/mangamillion/definition.json"),
      "utf8"
    )
  )
  definition.shipped = false
  definition.runtimes.background = false
  definition.runtimes.offscreen = false
  fs.writeFileSync(
    path.join(sourceDirectory, "definition.json"),
    JSON.stringify(definition)
  )
  fs.writeFileSync(
    path.join(sourceDirectory, "contracts/index.ts"),
    "export {}\n"
  )
  fs.copyFileSync(
    path.join(root, "src/site-integrations/definition.schema.json"),
    path.join(workspace, "src/site-integrations/definition.schema.json")
  )
  fs.writeFileSync(
    path.join(fixturesDirectory, "contract.json"),
    JSON.stringify({ schemaVersion: 1, providerId: "mangamillion", data: {} })
  )
  for (const locale of ["en", "ja", "zh_CN", "zh_TW", "ko"]) {
    const directory = path.join(workspace, "public/_locales", locale)
    fs.mkdirSync(directory, { recursive: true })
    fs.writeFileSync(path.join(directory, "messages.json"), "{}")
  }
})

afterEach(() => {
  fs.rmSync(workspace, { recursive: true, force: true })
})

describe("site integration fixture validation", () => {
  it("generates an integration with test-owned contracts and optional contributor notes", () => {
    fs.writeFileSync(
      path.join(fixturesDirectory, "captured-reader.json"),
      JSON.stringify({ pages: ["captured image"] })
    )
    fs.writeFileSync(
      path.join(fixturesDirectory, "secondary-contract.json"),
      JSON.stringify({
        schemaVersion: 1,
        providerId: "mangamillion",
        data: { chapter: "secondary" },
      })
    )
    const result = generate()
    expect(result.status, result.stderr).toBe(0)
    expect(
      fs.existsSync(
        path.join(
          workspace,
          "src/runtime/generated/site-integration-catalog.ts"
        )
      )
    ).toBe(true)
  })

  it("rejects an integration whose canonical test contract is missing", () => {
    fs.rmSync(path.join(fixturesDirectory, "contract.json"))
    expect(generate().status).toBe(1)
  })

  it("rejects a supplementary contract owned by another integration", () => {
    fs.writeFileSync(
      path.join(fixturesDirectory, "secondary-contract.json"),
      JSON.stringify({ schemaVersion: 1, providerId: "another-site", data: {} })
    )
    expect(generate().status).toBe(1)
  })
})
