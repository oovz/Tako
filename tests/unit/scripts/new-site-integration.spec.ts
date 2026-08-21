import { afterEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import { execSync } from "node:child_process"
import { fromJSONSchema } from "zod"

const root = process.cwd()
const integrationsDir = path.join(root, "src/site-integrations")
const schemaPath = path.join(integrationsDir, "definition.schema.json")
const testIntegrationId = "scaffold-test-site"
const testIntegrationDir = path.join(
  root,
  "tests/unit/scripts/scaffold-test-site"
)
function cleanupTestIntegration() {
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
        `node scripts/new-site-integration.mjs ${testIntegrationId} --name "Scaffold Test Site" --contributor "Tester" --out-dir "${testIntegrationDir}"`,
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
      expect(
        fs.existsSync(path.join(testIntegrationDir, "fixtures/contract.json"))
      ).toBe(true)
      expect(fs.existsSync(path.join(testIntegrationDir, "README.md"))).toBe(
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
      expect(definition.contributors).toEqual(["Tester"])
      expect(definition.shipped).toBe(false)
      expect(definition.enabledByDefault).toBe(false)
      expect(definition.imageTransform).toEqual({
        kind: "none",
        estimatedCostMs: 0,
      })
      expect(definition.resolution).toBeUndefined()
      expect(definition.fixtures.paths).toEqual([
        `src/site-integrations/${testIntegrationId}/fixtures/contract.json`,
      ])

      // Validate README.md template sections
      const readme = fs.readFileSync(
        path.join(testIntegrationDir, "README.md"),
        "utf8"
      )
      expect(readme).toContain("# Scaffold Test Site")
      expect(readme).toContain("## Approach")
      expect(readme).toContain("## Endpoints")
      expect(readme).toContain("## States covered")
      expect(readme).toContain("## Live smoke")

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

  it("rejects invalid site integration IDs", () => {
    expect(() => {
      execSync("node scripts/new-site-integration.mjs Invalid_ID", {
        encoding: "utf8",
        cwd: root,
        stdio: "pipe",
      })
    }).toThrow()
  })

  it("rejects duplicate site integration creation", () => {
    cleanupTestIntegration()
    execSync(
      `node scripts/new-site-integration.mjs ${testIntegrationId} --out-dir "${testIntegrationDir}"`,
      {
        encoding: "utf8",
        cwd: root,
      }
    )
    expect(() => {
      execSync(
        `node scripts/new-site-integration.mjs ${testIntegrationId} --out-dir "${testIntegrationDir}"`,
        {
          encoding: "utf8",
          cwd: root,
          stdio: "pipe",
        }
      )
    }).toThrow()
  })

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
