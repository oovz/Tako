import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import { fromJSONSchema } from "zod"

const root = process.cwd()
const integrationsDir = path.join(root, "src/site-integrations")
const schemaPath = path.join(integrationsDir, "definition.schema.json")
const generatedDir = path.join(root, "src/runtime/generated")
const documentationPath = path.join(
  root,
  "docs/generated/site-integration-registry.md"
)
const localesDir = path.join(root, "public/_locales")
const supportedLocales = ["en", "ja", "zh_CN", "zh_TW"]
const checkOnly = process.argv.includes("--check")

function fail(message) {
  console.error(message)
  process.exitCode = 1
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"))
  } catch (error) {
    fail(`Unable to read JSON ${path.relative(root, filePath)}: ${error}`)
    return null
  }
}

const schemaDocument = readJson(schemaPath)
let definitionSchema
try {
  definitionSchema = fromJSONSchema(schemaDocument)
} catch (error) {
  fail(`Unable to compile definition.schema.json: ${error}`)
}

function relativePath(filePath) {
  return path.relative(root, filePath).replaceAll(path.sep, "/")
}

function assert(condition, message) {
  if (!condition) fail(message)
}

function originHost(origin) {
  const match = /^https:\/\/([^/]+)\/\*$/.exec(origin)
  return match?.[1]
}

function originCoversHost(origin, host) {
  const pattern = originHost(origin)
  if (!pattern) return false
  if (pattern === "*" || pattern === host) return true
  if (!pattern.startsWith("*.")) return false
  const base = pattern.slice(2)
  return host === base || host.endsWith(`.${base}`)
}

function originCoversOrigin(requiredOrigin, candidateOrigin) {
  const requiredHost = originHost(requiredOrigin)
  const candidateHost = originHost(candidateOrigin)
  if (!requiredHost || !candidateHost) return false
  if (requiredHost === "*" || requiredHost === candidateHost) return true
  if (!requiredHost.startsWith("*.")) return false
  const base = requiredHost.slice(2)
  return (
    candidateHost === base ||
    (candidateHost.startsWith("*.") &&
      candidateHost.slice(2).endsWith(`.${base}`))
  )
}

function assertSettings(id, settings) {
  const ids = new Set()
  for (const field of settings) {
    assert(
      !ids.has(field.id),
      `${id} has duplicate custom setting id ${field.id}`
    )
    ids.add(field.id)
    if (field.type === "select" || field.type === "multiselect") {
      assert(
        Array.isArray(field.options) && field.options.length > 0,
        `${id} setting ${field.id} requires options`
      )
      const values = new Set()
      for (const option of field.options) {
        assert(
          !values.has(option.value),
          `${id} setting ${field.id} has duplicate option ${option.value}`
        )
        values.add(option.value)
      }
      if (field.type === "select") {
        assert(
          typeof field.defaultValue === "string" &&
            values.has(field.defaultValue),
          `${id} setting ${field.id} has an invalid default`
        )
      } else {
        assert(
          Array.isArray(field.defaultValue),
          `${id} setting ${field.id} has an invalid multiselect default`
        )
        assert(
          field.defaultValue.every((value) => values.has(value)),
          `${id} setting ${field.id} has an invalid multiselect default`
        )
      }
    } else {
      assert(
        field.options === undefined,
        `${id} setting ${field.id} cannot declare options`
      )
      const validDefault =
        (field.type === "boolean" && typeof field.defaultValue === "boolean") ||
        (field.type === "string" && typeof field.defaultValue === "string") ||
        (field.type === "number" &&
          typeof field.defaultValue === "number" &&
          Number.isFinite(field.defaultValue))
      assert(validDefault, `${id} setting ${field.id} has an invalid default`)
    }
  }
}

function assertSettingsFieldLocalization(id, definition) {
  const catalogs = new Map()
  for (const locale of supportedLocales) {
    const catalogPath = path.join(localesDir, locale, "messages.json")
    if (!fs.existsSync(catalogPath)) {
      fail(
        `Missing locale catalog for settings field keys: ${relativePath(catalogPath)}`
      )
      continue
    }
    const catalog = readJson(catalogPath) ?? {}
    catalogs.set(locale, catalog)
  }

  const usedKeys = new Set()
  for (const field of definition.customSettings) {
    usedKeys.add(field.labelKey)
    if (field.descriptionKey) usedKeys.add(field.descriptionKey)
    for (const option of field.options ?? []) usedKeys.add(option.labelKey)
  }

  for (const key of usedKeys) {
    for (const locale of supportedLocales) {
      const message = catalogs.get(locale)?.[key]?.message
      if (typeof message !== "string" || message.trim().length === 0) {
        fail(
          `Settings field message key ${key} is missing or empty in ${locale} for ${id}`
        )
      }
    }
  }
}

function assertDefinition(id, definition, definitionPath) {
  const providerDirectory = path.dirname(definitionPath)
  const contractsDirectory = path.join(providerDirectory, "contracts")
  const fixturesDirectory = path.join(providerDirectory, "fixtures")
  assert(
    fs.existsSync(path.join(providerDirectory, "README.md")),
    `${id} must include README.md`
  )
  assert(
    fs.existsSync(contractsDirectory) &&
      fs
        .readdirSync(contractsDirectory, { withFileTypes: true })
        .some((entry) => entry.isFile() && entry.name.endsWith(".ts")),
    `${id} must include at least one TypeScript contract`
  )
  assert(fs.existsSync(fixturesDirectory), `${id} must include fixtures`)
  assert(
    definition.id === id,
    `${relativePath(definitionPath)} id must match directory ${id}`
  )
  assert(
    definition.requiredOrigins.length > 0,
    `${id} must declare requiredOrigins`
  )
  assert(
    definition.patterns.domains.length > 0,
    `${id} must declare patterns.domains`
  )
  for (const strategy of [
    ...definition.resolution.seriesStrategies,
    ...definition.resolution.chapterStrategies,
    ...definition.resolution.imageStrategies,
  ]) {
    assert(
      !/(?:fallback|legacy)/i.test(strategy),
      `${id} declares an obsolete compatibility strategy: ${strategy}`
    )
  }
  for (const domain of definition.patterns.domains) {
    assert(
      definition.requiredOrigins.some((origin) =>
        originCoversHost(origin, domain)
      ),
      `${id} domain ${domain} is not covered by requiredOrigins`
    )
  }
  if (definition.runtimes.dispatchContext.mode === "none") {
    assert(
      definition.runtimes.dispatchContext.schemaVersion === undefined,
      `${id} dispatchContext none must not declare schemaVersion`
    )
  } else {
    assert(
      Number.isInteger(definition.runtimes.dispatchContext.schemaVersion) &&
        definition.runtimes.dispatchContext.schemaVersion > 0,
      `${id} dispatchContext requires a positive schemaVersion`
    )
  }
  const imageTransform = definition.resolution.imageTransform
  assert(
    imageTransform.kind === "none"
      ? imageTransform.estimatedCostMs === 0
      : imageTransform.estimatedCostMs > 0,
    `${id} image transform cost is inconsistent with its declared kind`
  )
  for (const context of ["background", "offscreen"]) {
    if (!definition.runtimes[context]) continue
    assert(
      fs.existsSync(path.join(integrationsDir, id, `${context}-runtime.ts`)),
      `${id} declares ${context} runtime but the bundled file is missing`
    )
  }
  if (definition.pageProbe !== "none") {
    assert(
      fs.existsSync(path.join(integrationsDir, id, "probe.ts")),
      `${id} declares a page probe but the bundled probe.ts file is missing`
    )
  }
  const endpointIds = new Set()
  for (const endpoint of definition.endpointPolicies) {
    assert(
      !endpointIds.has(endpoint.id),
      `${id} has duplicate endpoint id ${endpoint.id}`
    )
    endpointIds.add(endpoint.id)
    for (const origin of endpoint.origins) {
      assert(
        definition.requiredOrigins.some((required) =>
          originCoversOrigin(required, origin)
        ) ||
          definition.optionalOrigins.some((optional) =>
            originCoversOrigin(optional, origin)
          ),
        `${id} endpoint ${endpoint.id} origin ${origin} is not covered by declared origins`
      )
      if (endpoint.originKind === "fixed") {
        assert(
          definition.requiredOrigins.some((required) =>
            originCoversOrigin(required, origin)
          ),
          `${id} fixed endpoint ${endpoint.id} origin ${origin} must be covered by requiredOrigins`
        )
      }
    }
  }
  const dynamicOriginIds = new Set()
  for (const dynamicOrigin of definition.dynamicOrigins) {
    assert(
      !dynamicOriginIds.has(dynamicOrigin.endpointId),
      `${id} has duplicate dynamic origin endpoint ${dynamicOrigin.endpointId}`
    )
    dynamicOriginIds.add(dynamicOrigin.endpointId)
    const target = definition.endpointPolicies.find(
      (endpoint) => endpoint.id === dynamicOrigin.endpointId
    )
    const source = definition.endpointPolicies.find(
      (endpoint) => endpoint.id === dynamicOrigin.sourceEndpointId
    )
    assert(
      target,
      `${id} dynamic origin target endpoint is unknown: ${dynamicOrigin.endpointId}`
    )
    assert(
      source,
      `${id} dynamic origin source endpoint is unknown: ${dynamicOrigin.sourceEndpointId}`
    )
    if (target && source) {
      assert(
        target.originKind === "provider-issued",
        `${id} dynamic origin target must be provider-issued: ${dynamicOrigin.endpointId}`
      )
      assert(
        target.origins.includes(dynamicOrigin.allowedOriginPattern),
        `${id} dynamic origin target must include ${dynamicOrigin.allowedOriginPattern}`
      )
      assert(
        definition.optionalOrigins.includes(dynamicOrigin.allowedOriginPattern),
        `${id} dynamic origin pattern must be declared optional: ${dynamicOrigin.allowedOriginPattern}`
      )
    }
  }
  for (const rule of definition.sessionRefererRules) {
    assert(
      rule.id >= 41000 && rule.id <= 41999,
      `${id} DNR rule ${rule.id} is outside 41000-41999`
    )
    for (const domain of rule.requestDomains) {
      assert(
        definition.requiredOrigins.some((origin) =>
          originCoversHost(origin, domain)
        ),
        `${id} DNR rule ${rule.id} domain ${domain} is not covered by requiredOrigins`
      )
    }
    const referer = new URL(rule.referer)
    assert(
      definition.patterns.domains.includes(referer.hostname),
      `${id} DNR rule ${rule.id} referer host ${referer.hostname} is not a declared page domain`
    )
  }
  assertSettings(id, definition.customSettings)
  assertSettingsFieldLocalization(id, definition)
  const ownedFixturePrefix = `${relativePath(fixturesDirectory)}/`
  assert(definition.fixtures.paths.length > 0, `${id} must declare fixtures`)
  for (const fixturePath of definition.fixtures.paths) {
    assert(
      fixturePath.startsWith(ownedFixturePrefix) &&
        fixturePath.endsWith(".json"),
      `${id} fixtures must be provider-owned JSON files: ${fixturePath}`
    )
    assert(
      fs.existsSync(path.join(root, fixturePath)),
      `${id} fixture path does not exist: ${fixturePath}`
    )
    const fixture = readJson(path.join(root, fixturePath))
    if (fixture) {
      assert(
        fixture.schemaVersion === 1,
        `${id} fixture must use schemaVersion 1: ${fixturePath}`
      )
      assert(
        fixture.providerId === id,
        `${id} fixture providerId mismatch: ${fixturePath}`
      )
      assert(
        typeof fixture.data === "object" &&
          fixture.data !== null &&
          !Array.isArray(fixture.data),
        `${id} fixture data must be an object: ${fixturePath}`
      )
    }
  }
}

function readDefinitions() {
  const providerDirectories = fs
    .readdirSync(integrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  const ids = new Set()
  const endpointIds = new Set()
  const dnrIds = new Set()
  const definitions = []
  for (const id of providerDirectories) {
    const definitionPath = path.join(integrationsDir, id, "definition.json")
    assert(
      fs.existsSync(definitionPath),
      `Missing definition.json for provider directory ${id}`
    )
    if (!fs.existsSync(definitionPath)) continue
    const raw = readJson(definitionPath)
    let definition
    try {
      definition = definitionSchema.parse(raw)
    } catch (error) {
      fail(`Invalid ${relativePath(definitionPath)}: ${error}`)
      continue
    }
    assertDefinition(id, definition, definitionPath)
    assert(!ids.has(definition.id), `Duplicate provider id ${definition.id}`)
    ids.add(definition.id)
    for (const endpoint of definition.endpointPolicies) {
      assert(
        !endpointIds.has(endpoint.id),
        `Duplicate endpoint id ${endpoint.id}`
      )
      endpointIds.add(endpoint.id)
    }
    for (const rule of definition.sessionRefererRules) {
      assert(!dnrIds.has(rule.id), `Duplicate DNR rule id ${rule.id}`)
      dnrIds.add(rule.id)
    }
    definitions.push(definition)
  }
  return definitions.sort((left, right) => left.id.localeCompare(right.id))
}

function generatedHeader() {
  return "// This file is generated by scripts/generate-site-integration-registries.mjs.\n// Do not edit it directly.\n"
}

function identifier(id) {
  return id.replace(/[^a-zA-Z0-9_$]/g, "_")
}

function writeOrCheck(filePath, contents) {
  if (checkOnly) {
    if (!fs.existsSync(filePath)) {
      fail(`Missing generated file: ${relativePath(filePath)}`)
      return
    }
    const existing = fs.readFileSync(filePath, "utf8")
    if (existing !== contents)
      fail(`Generated file is stale: ${relativePath(filePath)}`)
    return
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, contents)
}

function generateCatalog(definitions) {
  return `${generatedHeader()}import type { SiteIntegrationDefinition } from '@/src/site-integrations/definition-types'\n\nexport const siteIntegrationCatalog = ${JSON.stringify(definitions, null, 2)} as const satisfies readonly SiteIntegrationDefinition[]\n\nexport const siteIntegrationCatalogById = Object.fromEntries(\n  siteIntegrationCatalog.map((integration) => [integration.id, integration]),\n) as Readonly<Record<string, SiteIntegrationDefinition>>\n`
}

function generateRuntimeRegistry(definitions, context) {
  const typeName =
    context === "background" ? "BackgroundSiteAdapter" : "OffscreenSiteAdapter"
  const exportName =
    context === "background" ? "backgroundSiteAdapter" : "offscreenSiteAdapter"
  const collectionName =
    context === "background"
      ? "backgroundSiteAdapters"
      : "offscreenSiteAdapters"
  const byIdName =
    context === "background"
      ? "backgroundSiteAdaptersById"
      : "offscreenSiteAdaptersById"
  const selected = definitions.filter(
    (definition) => definition.shipped && definition.runtimes[context]
  )
  const imports = selected.map((definition) => {
    const alias = `${identifier(definition.id)}${context === "background" ? "Background" : "Offscreen"}Adapter`
    return `import { ${exportName} as ${alias} } from '@/src/site-integrations/${definition.id}/${context}-runtime'`
  })
  const values = selected.map(
    (definition) =>
      `${identifier(definition.id)}${context === "background" ? "Background" : "Offscreen"}Adapter`
  )
  return `${generatedHeader()}import type { ${typeName} } from '@/src/types/site-integrations'\n${imports.join("\n")}\n\nexport const ${collectionName} = [\n${values.map((value) => `  ${value},`).join("\n")}\n] as const satisfies readonly ${typeName}[]\n\nexport const ${byIdName} = Object.fromEntries(\n  ${collectionName}.map((integration) => [integration.id, integration]),\n) as Readonly<Record<string, ${typeName}>>\n`
}

function generatePageProbeRegistry(definitions) {
  const selected = definitions.filter(
    (definition) => definition.shipped && definition.pageProbe !== "none"
  )
  const imports = selected.flatMap((definition) => [
    `import { pageProbe as ${identifier(definition.id)}PageProbe } from '@/src/site-integrations/${definition.id}/probe'`,
  ])
  const values = selected.map(
    (definition) => `  ${identifier(definition.id)}PageProbe,`
  )
  return `${generatedHeader()}import type { SiteIntegrationPageProbe } from '@/src/site-integrations/page-probe-contract'\n${imports.join("\n")}\n\nexport const siteIntegrationPageProbes = [\n${values.join("\n")}\n] as const satisfies readonly SiteIntegrationPageProbe[]\n\nexport const siteIntegrationPageProbesById = Object.fromEntries(\n  siteIntegrationPageProbes.map((probe) => [probe.id, probe]),\n) as Readonly<Record<string, SiteIntegrationPageProbe>>\n`
}

function generatePermissions(definitions) {
  const requiredOrigins = [
    ...new Set(
      definitions
        .filter(
          (definition) => definition.shipped && definition.enabledByDefault
        )
        .flatMap((definition) => definition.requiredOrigins)
    ),
  ].sort()
  const optionalOrigins = [
    ...new Set(
      definitions
        .filter((definition) => definition.shipped)
        .flatMap((definition) => definition.optionalOrigins)
    ),
  ].sort()
  return `${generatedHeader()}export interface SiteIntegrationWxtPermissions {\n  requiredOrigins: readonly string[]\n  optionalOrigins: readonly string[]\n}\n\nexport const siteIntegrationWxtPermissions = ${JSON.stringify({ requiredOrigins, optionalOrigins }, null, 2)} as const satisfies SiteIntegrationWxtPermissions\n`
}

function escapeCell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ")
}

function generateDocumentation(definitions) {
  const rows = definitions.map((definition) => {
    const dnr =
      definition.sessionRefererRules.length === 0
        ? "None"
        : definition.sessionRefererRules
            .map((rule) => `${rule.id}: ${rule.requestDomains.join(", ")}`)
            .join("<br>")
    const endpoints = definition.endpointPolicies
      .map(
        (endpoint) =>
          `${endpoint.id} (${endpoint.credentials}, ${endpoint.responseType})`
      )
      .join("<br>")
    const dynamicOrigins =
      definition.dynamicOrigins.length === 0
        ? "None"
        : definition.dynamicOrigins
            .map(
              (dynamicOrigin) =>
                `${dynamicOrigin.endpointId} <= ${dynamicOrigin.sourceEndpointId} (${dynamicOrigin.allowedOriginPattern})`
            )
            .join("<br>")
    return `| \`${escapeCell(definition.id)}\` | ${escapeCell(definition.name)} | ${definition.maturity} | ${definition.implementationType} | ${definition.enabledByDefault ? "Yes" : "No"} | ${definition.pageProbe} | ${definition.runtimes.background ? "background" : ""}${definition.runtimes.offscreen ? "+offscreen" : ""} | ${escapeCell(endpoints)} | ${escapeCell(dynamicOrigins)} | ${escapeCell(dnr)} | ${definition.fixtures.liveFreshnessDays} days |`
  })
  return [
    "<!-- This file is generated by scripts/generate-site-integration-registries.mjs. -->",
    "",
    "# Shipped site integrations",
    "",
    "This inventory is generated from provider `definition.json` files. The definitions are validated against `src/site-integrations/definition.schema.json` before the catalog is emitted.",
    "",
    "| ID | Name | Maturity | Implementation | Enabled by default | Page probe | Runtime surfaces | Endpoint policies | Dynamic origins | Session referer rules | Live freshness |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n")
}

const definitions = readDefinitions()
writeOrCheck(
  path.join(generatedDir, "site-integration-catalog.ts"),
  generateCatalog(definitions)
)
writeOrCheck(
  path.join(generatedDir, "site-integration-background-registry.ts"),
  generateRuntimeRegistry(definitions, "background")
)
writeOrCheck(
  path.join(generatedDir, "site-integration-offscreen-registry.ts"),
  generateRuntimeRegistry(definitions, "offscreen")
)
writeOrCheck(
  path.join(generatedDir, "site-integration-page-probe-registry.ts"),
  generatePageProbeRegistry(definitions)
)
writeOrCheck(
  path.join(generatedDir, "site-integration-wxt-permissions.ts"),
  generatePermissions(definitions)
)
writeOrCheck(documentationPath, generateDocumentation(definitions))

const obsoleteContentRegistry = path.join(
  generatedDir,
  "site-integration-content-registry.ts"
)
if (fs.existsSync(obsoleteContentRegistry)) {
  if (checkOnly)
    fail(
      `Obsolete generated file exists: ${relativePath(obsoleteContentRegistry)}`
    )
  else fs.rmSync(obsoleteContentRegistry)
}

if (process.exitCode) process.exit(process.exitCode)
