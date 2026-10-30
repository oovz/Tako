import process from "node:process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

const scaffold = path.join(process.cwd(), "scripts/new-site-integration.mjs")
let workspace
beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "tako-scaffold-arguments-"))
})
afterEach(() => fs.rmSync(workspace, { recursive: true, force: true }))

function run(args) {
  return spawnSync(process.execPath, [scaffold, ...args], {
    cwd: workspace,
    encoding: "utf8",
  })
}

describe("scaffold argument interface", () => {
  it.each([
    ["primary-user", "secondary-user", "primary-user"],
    ["", "secondary-user", "secondary-user"],
    ["", "", "Contributor"],
  ])(
    "uses the available environment contributor when Git has no name",
    (user, username, expected) => {
      const result = spawnSync(process.execPath, [scaffold, "fallback-site"], {
        cwd: workspace,
        encoding: "utf8",
        env: {
          ...process.env,
          GIT_CONFIG_GLOBAL: path.join(workspace, "absent-git-config"),
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_COUNT: "0",
          USER: user,
          USERNAME: username,
        },
      })
      expect(result.status, result.stderr).toBe(0)
      const definition = JSON.parse(
        fs.readFileSync(
          path.join(
            workspace,
            "src/site-integrations/fallback-site/definition.json"
          ),
          "utf8"
        )
      )
      expect(definition.contributors).toEqual([expected])
    }
  )

  it("uses the environment contributor when Git returns a blank name", () => {
    const result = spawnSync(process.execPath, [scaffold, "fallback-site"], {
      cwd: workspace,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: path.join(workspace, "absent-git-config"),
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "user.name",
        GIT_CONFIG_VALUE_0: "   ",
        USER: "fallback-user",
      },
    })
    expect(result.status, result.stderr).toBe(0)
    const definition = JSON.parse(
      fs.readFileSync(
        path.join(
          workspace,
          "src/site-integrations/fallback-site/definition.json"
        ),
        "utf8"
      )
    )
    expect(definition.contributors).toEqual(["fallback-user"])
  })

  it.each([
    [
      "--id",
      "flag-site",
      "--name",
      "Native name",
      "--english-name",
      "English name",
      "--contributors",
      "Tester",
      "--out-dir",
      "source",
      "--fixtures-dir",
      "fixtures",
    ],
    [
      "--id=flag-site",
      "--name=Native name",
      "--english-name=English name",
      "--contributor=Tester",
      "--out-dir=source",
      "--fixtures-dir=fixtures",
    ],
  ])("supports separated and equals-form options", (...args) => {
    const result = run(args)
    expect(result.status, result.stderr).toBe(0)
    const definition = JSON.parse(
      fs.readFileSync(path.join(workspace, "source/definition.json"), "utf8")
    )
    expect(definition).toMatchObject({
      id: "flag-site",
      name: "Native name",
      englishName: "English name",
      contributors: ["Tester"],
    })
    expect(
      JSON.parse(
        fs.readFileSync(path.join(workspace, "fixtures/contract.json"), "utf8")
      )
    ).toMatchObject({ providerId: "flag-site", data: {} })
  })

  it.each([
    [],
    ["--name", "Only name"],
    ["one-site", "extra"],
    ["--id", "--name"],
    ["site", "--contributors"],
    ["site", "--fixtures-dir"],
    ["site", "--english-name", "--name"],
  ])(
    "rejects incomplete or conflicting arguments %s before writing",
    (...args) => {
      expect(run(args).status).toBe(1)
      expect(fs.readdirSync(workspace)).toEqual([])
    }
  )

  it.each(["--help", "-h"])("shows help for %s without writing", (flag) => {
    const result = run([flag])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Usage: pnpm new:site-integration")
    expect(fs.readdirSync(workspace)).toEqual([])
  })
})
