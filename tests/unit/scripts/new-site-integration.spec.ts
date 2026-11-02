import { afterEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import os from "node:os"
import { execSync, execFileSync, spawnSync } from "node:child_process"
import { fromJSONSchema } from "zod"

const root = process.cwd()
const integrationsDir = path.join(root, "src/site-integrations")
const schemaPath = path.join(integrationsDir, "definition.schema.json")
const testIntegrationId = "scaffold-test-site"
const testIntegrationDir = path.join(
  root,
  "tests/unit/scripts/scaffold-test-site"
)
const testFixturesDir = path.join(
  root,
  "tests/unit/scripts/scaffold-test-fixtures"
)
function cleanupTestIntegration() {
  fs.rmSync(testFixturesDir, { recursive: true, force: true })
  if (fs.existsSync(testIntegrationDir)) {
    fs.rmSync(testIntegrationDir, { recursive: true, force: true })
  }
}

describe("new-site-integration script", () => {
  afterEach(() => {
    cleanupTestIntegration()
  })

  it(
    "scaffolds a valid site integration that passes schema and lint checks in isolation",
    { timeout: 60_000 },
    () => {
      cleanupTestIntegration()

      const output = execSync(
        `node scripts/new-site-integration.mjs ${testIntegrationId} --name "Scaffold Test Site" --contributor "Tester" --out-dir "${testIntegrationDir}" --fixtures-dir "${testFixturesDir}"`,
        { encoding: "utf8", cwd: root }
      )

      expect(output).toContain("Successfully created site integration scaffold")

      // Check all expected files exist
      expect(
        fs.existsSync(path.join(testIntegrationDir, "definition.json"))
      ).toBe(true)
      expect(
        fs.existsSync(path.join(testIntegrationDir, "background-runtime.ts"))
      ).toBe(true)
      expect(
        fs.existsSync(path.join(testIntegrationDir, "offscreen-runtime.ts"))
      ).toBe(true)
      expect(
        fs.existsSync(path.join(testIntegrationDir, "contracts/index.ts"))
      ).toBe(true)
      expect(fs.existsSync(path.join(testFixturesDir, "contract.json"))).toBe(
        true
      )

      // Validate definition.json against schema
      const schemaDoc = JSON.parse(fs.readFileSync(schemaPath, "utf8"))
      const definitionSchema = fromJSONSchema(schemaDoc)
      const definition = JSON.parse(
        fs.readFileSync(
          path.join(testIntegrationDir, "definition.json"),
          "utf8"
        )
      )

      expect(() => definitionSchema.parse(definition)).not.toThrow()
      expect(definition.id).toBe(testIntegrationId)
      expect(definition.name).toBe("Scaffold Test Site")
      expect(definition.englishName).toBe("Scaffold Test Site")
      expect(definition.contributors).toEqual(["Tester"])
      expect(definition.shipped).toBe(false)
      expect(definition.enabledByDefault).toBe(false)
      expect(definition.imageTransform).toEqual({
        kind: "none",
        estimatedCostMs: 0,
      })
      expect(definition.resolution).toBeUndefined()
      const fixture = JSON.parse(
        fs.readFileSync(path.join(testFixturesDir, "contract.json"), "utf8")
      )
      expect(fixture).toMatchObject({
        schemaVersion: 1,
        providerId: testIntegrationId,
        data: {},
      })

      // The generated TypeScript stubs must lint cleanly
      expect(() => {
        execSync(
          `pnpm exec eslint tests/unit/scripts/scaffold-test-site --config eslint.config.mjs --max-warnings=0`,
          {
            encoding: "utf8",
            cwd: root,
          }
        )
      }).not.toThrow()
    }
  )

  it("places default source and fixture outputs in their separate workspace roots", () => {
    const workspace = fs.mkdtempSync(
      path.join(os.tmpdir(), "tako-scaffold-defaults-")
    )
    try {
      execFileSync(
        process.execPath,
        [
          path.join(root, "scripts/new-site-integration.mjs"),
          testIntegrationId,
        ],
        {
          encoding: "utf8",
          cwd: workspace,
          stdio: "pipe",
        }
      )
      const source = path.join(
        workspace,
        "src/site-integrations",
        testIntegrationId
      )
      const fixture = JSON.parse(
        fs.readFileSync(
          path.join(
            workspace,
            "tests/fixtures/site-integrations",
            testIntegrationId,
            "contract.json"
          ),
          "utf8"
        )
      )
      expect(fs.existsSync(path.join(source, "background-runtime.ts"))).toBe(
        true
      )
      expect(fs.existsSync(path.join(source, "offscreen-runtime.ts"))).toBe(
        true
      )
      expect(fixture).toMatchObject({
        schemaVersion: 1,
        providerId: testIntegrationId,
        data: {},
      })
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })

  it("rejects invalid site integration IDs", () => {
    expect(() => {
      execSync("node scripts/new-site-integration.mjs Invalid_ID", {
        encoding: "utf8",
        cwd: root,
        stdio: "pipe",
      })
    }).toThrow()
  })

  it("keeps native and English site names in the generated definition", () => {
    execSync(
      `node scripts/new-site-integration.mjs ${testIntegrationId} --name "漫画サイト" --english-name "Example Manga" --out-dir "${testIntegrationDir}" --fixtures-dir "${testFixturesDir}"`,
      { encoding: "utf8", cwd: root, stdio: "pipe" }
    )

    const definition = JSON.parse(
      fs.readFileSync(path.join(testIntegrationDir, "definition.json"), "utf8")
    )
    const definitionSchema = fromJSONSchema(
      JSON.parse(fs.readFileSync(schemaPath, "utf8"))
    )

    expect(definitionSchema.parse(definition)).toMatchObject({
      name: "漫画サイト",
      englishName: "Example Manga",
    })
    delete definition.englishName
    expect(() => definitionSchema.parse(definition)).toThrow()
  })

  it("rejects duplicate site integration creation", () => {
    cleanupTestIntegration()
    execSync(
      `node scripts/new-site-integration.mjs ${testIntegrationId} --out-dir "${testIntegrationDir}" --fixtures-dir "${testFixturesDir}"`,
      {
        encoding: "utf8",
        cwd: root,
      }
    )
    expect(() => {
      execSync(
        `node scripts/new-site-integration.mjs ${testIntegrationId} --out-dir "${testIntegrationDir}" --fixtures-dir "${testFixturesDir}"`,
        {
          encoding: "utf8",
          cwd: root,
          stdio: "pipe",
        }
      )
    }).toThrow()
  })

  it("keeps the source directory absent when the fixture destination already exists", () => {
    fs.mkdirSync(testFixturesDir, { recursive: true })
    fs.writeFileSync(path.join(testFixturesDir, "existing.json"), "retained")

    expect(() => {
      execSync(
        `node scripts/new-site-integration.mjs ${testIntegrationId} --out-dir "${testIntegrationDir}" --fixtures-dir "${testFixturesDir}"`,
        { encoding: "utf8", cwd: root, stdio: "pipe" }
      )
    }).toThrow()

    expect(fs.existsSync(testIntegrationDir)).toBe(false)
    expect(
      fs.readFileSync(path.join(testFixturesDir, "existing.json"), "utf8")
    ).toBe("retained")
  })

  it("rejects an invalid fixture ancestor before writing and allows retry after correction", () => {
    const workspace = fs.mkdtempSync(
      path.join(os.tmpdir(), "tako-scaffold-parent-")
    )
    const source = path.join(workspace, "source")
    const blocker = path.join(workspace, "blocked")
    const fixture = path.join(blocker, "fixtures")
    const run = () =>
      spawnSync(
        process.execPath,
        [
          path.join(root, "scripts/new-site-integration.mjs"),
          testIntegrationId,
          "--contributor",
          "Tester",
          "--out-dir",
          source,
          "--fixtures-dir",
          fixture,
        ],
        { encoding: "utf8", cwd: workspace }
      )
    try {
      fs.writeFileSync(blocker, "existing file")
      const rejected = run()
      expect(rejected.status).toBe(1)
      expect(fs.existsSync(source)).toBe(false)
      expect(fs.readFileSync(blocker, "utf8")).toBe("existing file")

      fs.rmSync(blocker)
      fs.mkdirSync(blocker)
      const retried = run()
      expect(retried.status, retried.stderr).toBe(0)
      expect(fs.existsSync(path.join(source, "background-runtime.ts"))).toBe(
        true
      )
      expect(
        JSON.parse(fs.readFileSync(path.join(fixture, "contract.json"), "utf8"))
      ).toMatchObject({ providerId: testIntegrationId, data: {} })
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })

  it.each(["same", "fixtures-in-source", "source-in-fixtures"])(
    "rejects symlink aliases with %s output ownership before creating files",
    (relation) => {
      const workspace = fs.mkdtempSync(
        path.join(os.tmpdir(), "tako-scaffold-alias-")
      )
      const actual = path.join(workspace, "actual")
      const alias = path.join(workspace, "alias")
      fs.mkdirSync(actual)
      try {
        fs.symlinkSync(
          actual,
          alias,
          process.platform === "win32" ? "junction" : "dir"
        )
        const source = path.join(
          actual,
          "new",
          ...(relation === "source-in-fixtures" ? ["source"] : [])
        )
        const fixture = path.join(
          alias,
          "new",
          ...(relation === "fixtures-in-source" ? ["fixtures"] : [])
        )
        const result = spawnSync(
          process.execPath,
          [
            path.join(root, "scripts/new-site-integration.mjs"),
            testIntegrationId,
            "--contributor",
            "Tester",
            "--out-dir",
            source,
            "--fixtures-dir",
            fixture,
          ],
          { encoding: "utf8", cwd: workspace }
        )
        expect(result.status).toBe(1)
        expect(fs.readdirSync(actual)).toEqual([])
      } finally {
        fs.rmSync(workspace, { recursive: true, force: true })
      }
    }
  )

  for (const relation of ["same", "fixtures-in-source", "source-in-fixtures"]) {
    it(`rejects ${relation} case aliases before writing and preserves existing parent contents`, ({
      skip,
    }) => {
      const workspace = fs.mkdtempSync(
        path.join(os.tmpdir(), "tako-scaffold-case-")
      )
      const parent = path.join(workspace, "existing")
      fs.mkdirSync(parent)
      fs.writeFileSync(path.join(parent, "retained.txt"), "user file")
      try {
        const probe = path.join(parent, "case-probe")
        fs.mkdirSync(probe)
        const aliases = fs.existsSync(path.join(parent, "CASE-PROBE"))
        fs.rmdirSync(probe)
        if (!aliases)
          skip(
            "The temporary filesystem treats differently cased directory names as distinct."
          )

        const source = path.join(
          parent,
          "Source",
          ...(relation === "source-in-fixtures" ? ["source"] : [])
        )
        const fixture = path.join(
          parent,
          "source",
          ...(relation === "fixtures-in-source" ? ["fixtures"] : [])
        )
        const result = spawnSync(
          process.execPath,
          [
            path.join(root, "scripts/new-site-integration.mjs"),
            testIntegrationId,
            "--contributor",
            "Tester",
            "--out-dir",
            source,
            "--fixtures-dir",
            fixture,
          ],
          { encoding: "utf8", cwd: workspace }
        )
        expect(result.status).toBe(1)
        expect(fs.readdirSync(parent)).toEqual(["retained.txt"])
        expect(fs.readFileSync(path.join(parent, "retained.txt"), "utf8")).toBe(
          "user file"
        )
      } finally {
        fs.rmSync(workspace, { recursive: true, force: true })
      }
    })
  }

  it("rejects unknown options", () => {
    expect(() => {
      execSync(
        `node scripts/new-site-integration.mjs ${testIntegrationId} --unknown-option`,
        {
          encoding: "utf8",
          cwd: root,
          stdio: "pipe",
        }
      )
    }).toThrow()
  })

  it("rejects missing option values", () => {
    expect(() => {
      execSync(
        `node scripts/new-site-integration.mjs ${testIntegrationId} --name`,
        {
          encoding: "utf8",
          cwd: root,
          stdio: "pipe",
        }
      )
    }).toThrow()
  })
})
