import process from "node:process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

const root = process.cwd()
const generator = path.join(
  root,
  "scripts/generate-site-integration-registries.mjs"
)
const locales = ["en", "ja", "ko", "zh_CN", "zh_TW"]
let workspace
let definitionPath
let definition

function generate(...args) {
  return spawnSync(process.execPath, [generator, ...args], {
    cwd: workspace,
    encoding: "utf8",
  })
}

function saveDefinition() {
  fs.writeFileSync(definitionPath, JSON.stringify(definition))
}

function writeCatalog(locale, entries) {
  fs.writeFileSync(
    path.join(workspace, "public/_locales", locale, "messages.json"),
    JSON.stringify(entries)
  )
}

function setting(type, defaultValue, extra = {}) {
  return { id: type, labelKey: "fieldLabel", type, defaultValue, ...extra }
}

const choiceOptions = [
  { value: "a", labelKey: "choiceA" },
  { value: "b", labelKey: "choiceB" },
]

beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "tako-generator-policy-"))
  const scaffold = spawnSync(
    process.execPath,
    [
      path.join(root, "scripts/new-site-integration.mjs"),
      "tooling-site",
      "--contributor",
      "Tester",
    ],
    { cwd: workspace, encoding: "utf8" }
  )
  expect(scaffold.status, scaffold.stderr).toBe(0)
  definitionPath = path.join(
    workspace,
    "src/site-integrations/tooling-site/definition.json"
  )
  definition = JSON.parse(fs.readFileSync(definitionPath, "utf8"))
  fs.copyFileSync(
    path.join(root, "src/site-integrations/definition.schema.json"),
    path.join(workspace, "src/site-integrations/definition.schema.json")
  )
  for (const locale of locales) {
    fs.mkdirSync(path.join(workspace, "public/_locales", locale), {
      recursive: true,
    })
    writeCatalog(locale, {
      fieldLabel: { message: "Field" },
      fieldDescription: { message: "Description" },
      choiceA: { message: "A" },
      choiceB: { message: "B" },
    })
  }
})

afterEach(() => fs.rmSync(workspace, { recursive: true, force: true }))

describe("generator settings validation", () => {
  it("accepts scalar and choice defaults with localized labels, descriptions and options", () => {
    definition.customSettings = [
      setting("boolean", true),
      setting("string", "text", { descriptionKey: "fieldDescription" }),
      setting("number", 2),
      setting("select", "a", { options: choiceOptions }),
      setting("multiselect", ["a", "b"], { options: choiceOptions }),
    ]
    saveDefinition()
    const result = generate()
    expect(result.status, result.stderr).toBe(0)
    expect(generate("--check").status).toBe(0)
  })

  it.each([
    ["scalar default type", [setting("number", "2")]],
    ["scalar options", [setting("string", "text", { options: choiceOptions })]],
    ["missing choices", [setting("select", "a")]],
    [
      "duplicate option values",
      [
        setting("select", "a", {
          options: [
            { value: "a", labelKey: "choiceA" },
            { value: "a", labelKey: "choiceB" },
          ],
        }),
      ],
    ],
    [
      "unknown selected default",
      [setting("select", "c", { options: choiceOptions })],
    ],
    [
      "unknown multiselect default",
      [setting("multiselect", ["c"], { options: choiceOptions })],
    ],
    [
      "non-array multiselect default",
      [setting("multiselect", "a", { options: choiceOptions })],
    ],
    [
      "duplicate settings",
      [setting("boolean", true), setting("boolean", false)],
    ],
  ])("rejects %s", (_reason, settings) => {
    definition.customSettings = settings
    saveDefinition()
    expect(generate().status).toBe(1)
  })

  it.each([
    ["label", "en", "fieldLabel", undefined],
    ["description", "ko", "fieldDescription", { message: "   " }],
    ["option", "ja", "choiceA", { message: 1 }],
  ])(
    "checks the localized %s through the definition consumer",
    (_kind, locale, key, message) => {
      definition.customSettings = [
        setting("select", "a", {
          descriptionKey: "fieldDescription",
          options: choiceOptions,
        }),
      ]
      saveDefinition()
      const catalogPath = path.join(
        workspace,
        "public/_locales",
        locale,
        "messages.json"
      )
      const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"))
      catalog[key] = message
      writeCatalog(locale, catalog)
      expect(generate().status).toBe(1)
    }
  )

  it("requires every supported locale catalog", () => {
    fs.rmSync(path.join(workspace, "public/_locales/ko/messages.json"))
    expect(generate().status).toBe(1)
  })
})

describe("generator definition policies", () => {
  it("rejects provider directories with no definition while inspecting the remaining providers", () => {
    fs.mkdirSync(path.join(workspace, "src/site-integrations/unfinished-site"))
    const result = generate()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      "Missing definition.json for provider directory unfinished-site"
    )
  })

  it("rejects schema-invalid definitions through the CLI", () => {
    delete definition.englishName
    saveDefinition()
    const result = generate()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      "Invalid src/site-integrations/tooling-site/definition.json"
    )
  })

  it("generates registries and permissions for shipped runtime and probe providers", () => {
    definition.shipped = true
    definition.enabledByDefault = true
    definition.pageProbe = "optional"
    definition.runtimes.dispatchContext = { mode: "required", schemaVersion: 1 }
    definition.imageTransform = {
      kind: "integrated-descramble",
      estimatedCostMs: 5,
    }
    definition.requiredOrigins = ["https://*.example.com/*"]
    definition.endpointPolicies[0].origins = ["https://*.example.com/*"]
    definition.optionalOrigins = ["https://cdn.example.net/*"]
    definition.endpointPolicies.push({
      ...definition.endpointPolicies[0],
      id: "tooling-site-cdn",
      originKind: "provider-issued",
      origins: ["https://cdn.example.net/*"],
    })
    definition.sessionRefererRules = [
      {
        id: 41001,
        requestDomains: ["images.example.com"],
        resourceTypes: ["xmlhttprequest"],
        referer: "https://tooling-site.example.com/",
      },
    ]
    saveDefinition()
    fs.writeFileSync(
      path.join(path.dirname(definitionPath), "probe.ts"),
      "export const pageProbe = {}"
    )
    const result = generate()
    expect(result.status, result.stderr).toBe(0)
    const generated = path.join(workspace, "src/runtime/generated")
    expect(
      fs.readFileSync(
        path.join(generated, "site-integration-background-registry.ts"),
        "utf8"
      )
    ).toContain("tooling_siteBackgroundAdapter,")
    expect(
      fs.readFileSync(
        path.join(generated, "site-integration-offscreen-registry.ts"),
        "utf8"
      )
    ).toContain("tooling_siteOffscreenAdapter,")
    expect(
      fs.readFileSync(
        path.join(generated, "site-integration-page-probe-registry.ts"),
        "utf8"
      )
    ).toContain("tooling_sitePageProbe,")
    expect(
      fs.readFileSync(
        path.join(generated, "site-integration-wxt-permissions.ts"),
        "utf8"
      )
    ).toContain("https://*.example.com/*")
    expect(generate("--check").status).toBe(0)
  })

  it.each([
    [
      "uncovered page domain",
      (value) => {
        value.patterns.domains = ["other.example.net"]
      },
    ],
    [
      "inconsistent dispatch context",
      (value) => {
        value.runtimes.dispatchContext.schemaVersion = 1
      },
    ],
    [
      "missing dispatch schema",
      (value) => {
        value.runtimes.dispatchContext.mode = "required"
      },
    ],
    [
      "inconsistent image cost",
      (value) => {
        value.imageTransform.estimatedCostMs = 1
      },
    ],
    [
      "fixed optional origin",
      (value) => {
        value.optionalOrigins = ["https://cdn.example.net/*"]
        value.endpointPolicies[0].origins = value.optionalOrigins
      },
    ],
    [
      "undeclared endpoint origin",
      (value) => {
        value.endpointPolicies[0].origins = ["https://other.example.net/*"]
      },
    ],
    [
      "duplicate endpoint identity",
      (value) => {
        value.endpointPolicies.push({ ...value.endpointPolicies[0] })
      },
    ],
    [
      "uncovered DNR domain",
      (value) => {
        value.sessionRefererRules = [
          {
            id: 41001,
            requestDomains: ["other.example.net"],
            resourceTypes: ["other"],
            referer: "https://tooling-site.example.com/",
          },
        ]
      },
    ],
    [
      "undeclared DNR referer",
      (value) => {
        value.sessionRefererRules = [
          {
            id: 41001,
            requestDomains: ["tooling-site.example.com"],
            resourceTypes: ["other"],
            referer: "https://other.example.net/",
          },
        ]
      },
    ],
  ])("rejects %s", (_reason, edit) => {
    edit(definition)
    saveDefinition()
    expect(generate().status).toBe(1)
  })

  it("rejects a missing declared runtime or probe", () => {
    fs.rmSync(path.join(path.dirname(definitionPath), "offscreen-runtime.ts"))
    definition.pageProbe = "required"
    saveDefinition()
    const result = generate()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("declares offscreen runtime")
    expect(result.stderr).toContain("declares a page probe")
  })

  it("checks generated bytes, missing files and obsolete registry removal", () => {
    const result = generate()
    expect(result.status, result.stderr).toBe(0)
    const generated = path.join(workspace, "src/runtime/generated")
    const catalog = path.join(generated, "site-integration-catalog.ts")
    const original = fs.readFileSync(catalog, "utf8")
    fs.writeFileSync(catalog, original + "\n")
    expect(generate("--check").status).toBe(1)
    fs.rmSync(catalog)
    expect(generate("--check").status).toBe(1)
    const obsolete = path.join(
      generated,
      "site-integration-content-registry.ts"
    )
    fs.writeFileSync(obsolete, "export {}")
    expect(generate("--check").status).toBe(1)
    expect(fs.existsSync(obsolete)).toBe(true)
    expect(generate().status).toBe(0)
    expect(fs.readFileSync(catalog, "utf8")).toBe(original)
    expect(fs.existsSync(obsolete)).toBe(false)
  })
})
