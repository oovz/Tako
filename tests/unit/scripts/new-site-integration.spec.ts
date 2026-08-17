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
const testIntegrationDir = path.join(integrationsDir, testIntegrationId)

/**
 * Note on shared repository state mutation during this test:
 *
 * This test verifies that newly scaffolded site integrations are immediately
 * compilable, lint-clean, and generator-compliant against current repository types.
 *
 * Lifecycle and Trade-offs:
 * 1. The test creates a temporary integration directory at `src/site-integrations/scaffold-test-site`.
 * 2. It runs `generate-site-integration-registries.mjs`, which incorporates the new
 *    experimental integration into `siteIntegrationCatalog` (with `shipped: false`).
 * 3. It runs `tsc --noEmit` and `eslint` to guarantee that scaffolded stubs stay in sync
 *    with evolving repo types without manual testing.
 * 4. `afterEach` (and the test prelude) immediately removes `src/site-integrations/scaffold-test-site`
 *    and regenerates the catalog back to its pristine state.
 *
 * Because `shipped: false` is set on the scaffold, the temporary integration is excluded
 * from runtime bundle registries (`backgroundSiteAdapters`, `offscreenSiteAdapters`,
 * `siteIntegrationPageProbes`, and permissions).
 */
function cleanupTestIntegration() {
  if (fs.existsSync(testIntegrationDir)) {
    fs.rmSync(testIntegrationDir, { recursive: true, force: true })
    execSync("node scripts/generate-site-integration-registries.mjs", {
      encoding: "utf8",
      cwd: root,
    })
  }
}

describe("new-site-integration script", () => {
  afterEach(() => {
    cleanupTestIntegration()
  })

  it(
    "scaffolds a valid site integration that passes schema and generator checks",
    { timeout: 60_000 },
    () => {
      cleanupTestIntegration()

      const output = execSync(
        `node scripts/new-site-integration.mjs ${testIntegrationId} --name "Scaffold Test Site" --author "Tester"`,
        { encoding: "utf8", cwd: root }
      )

      expect(output).toContain(
        `Successfully created site integration scaffold at src/site-integrations/${testIntegrationId}/`
      )

      // Check files exist
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
      expect(definition.author).toBe("Tester")
      expect(definition.shipped).toBe(false)
      expect(definition.enabledByDefault).toBe(false)
      expect(definition.maturity).toBe("experimental")
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

      // Run generator to ensure the scaffold conforms to all repo rules
      expect(() => {
        execSync("node scripts/generate-site-integration-registries.mjs", {
          encoding: "utf8",
          cwd: root,
        })
      }).not.toThrow()

      // And now --check passes
      expect(() => {
        execSync(
          "node scripts/generate-site-integration-registries.mjs --check",
          {
            encoding: "utf8",
            cwd: root,
          }
        )
      }).not.toThrow()

      // The generated TypeScript stubs must type-check and lint cleanly
      expect(() => {
        execSync("pnpm exec tsc --noEmit", {
          encoding: "utf8",
          cwd: root,
        })
      }).not.toThrow()

      expect(() => {
        execSync(
          `pnpm exec eslint src/site-integrations/${testIntegrationId} --ext .ts --config eslint.config.mjs --max-warnings=0`,
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
    execSync(`node scripts/new-site-integration.mjs ${testIntegrationId}`, {
      encoding: "utf8",
      cwd: root,
    })
    expect(() => {
      execSync(`node scripts/new-site-integration.mjs ${testIntegrationId}`, {
        encoding: "utf8",
        cwd: root,
        stdio: "pipe",
      })
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
