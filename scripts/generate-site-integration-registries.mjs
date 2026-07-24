import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import ts from "typescript"

const workspaceRoot = process.cwd()
const manifestPath = path.join(
  workspaceRoot,
  "src/site-integrations/manifest.ts"
)
const generatedDir = path.join(workspaceRoot, "src/runtime/generated")
const generatedDocumentationPath = path.join(
  workspaceRoot,
  "docs/generated/site-integration-registry.md"
)
const checkOnly = process.argv.includes("--check")
// The generated documentation directory is intentionally local-only in this
// repository. Source registries remain a build/CI contract; documentation is
// generated explicitly by maintainers who have that local workspace.
const includeDocumentation = process.argv.includes("--documentation")

const runtimeDefinitions = [
  {
    context: "background",
    typeName: "BackgroundSiteAdapter",
    exportName: "backgroundSiteAdapter",
    collectionName: "backgroundSiteAdapters",
    byIdName: "backgroundSiteAdaptersById",
  },
  {
    context: "offscreen",
    typeName: "OffscreenSiteAdapter",
    exportName: "offscreenSiteAdapter",
    collectionName: "offscreenSiteAdapters",
    byIdName: "offscreenSiteAdaptersById",
  },
]

function fail(message) {
  console.error(message)
  process.exitCode = 1
}

function readManifestSourceFile() {
  const sourceText = fs.readFileSync(manifestPath, "utf8")
  return ts.createSourceFile(
    manifestPath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  )
}

function propertyNameText(name) {
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNumericLiteral(name)
  ) {
    return name.text
  }
  return undefined
}

function getObjectProperty(objectLiteral, propertyName) {
  return objectLiteral.properties.find(
    (property) =>
      ts.isPropertyAssignment(property) &&
      propertyNameText(property.name) === propertyName
  )
}

function getStringProperty(objectLiteral, propertyName) {
  const property = getObjectProperty(objectLiteral, propertyName)
  if (!property || !ts.isStringLiteral(property.initializer)) {
    return undefined
  }
  return property.initializer.text
}

function getBooleanProperty(objectLiteral, propertyName) {
  const property = getObjectProperty(objectLiteral, propertyName)
  if (!property) {
    return undefined
  }
  if (property.initializer.kind === ts.SyntaxKind.TrueKeyword) {
    return true
  }
  if (property.initializer.kind === ts.SyntaxKind.FalseKeyword) {
    return false
  }
  return undefined
}

function getStringArrayProperty(objectLiteral, propertyName) {
  const property = getObjectProperty(objectLiteral, propertyName)
  if (!property || !ts.isArrayLiteralExpression(property.initializer)) {
    return undefined
  }
  const values = []
  for (const element of property.initializer.elements) {
    if (!ts.isStringLiteral(element)) return undefined
    values.push(element.text)
  }
  return values
}

function getRuntimes(objectLiteral) {
  const property = getObjectProperty(objectLiteral, "runtimes")
  if (!property || !ts.isObjectLiteralExpression(property.initializer)) {
    return undefined
  }

  return {
    background: getBooleanProperty(property.initializer, "background"),
    offscreen: getBooleanProperty(property.initializer, "offscreen"),
  }
}

function findManifestArray(sourceFile) {
  let manifestArray

  sourceFile.forEachChild((node) => {
    if (!ts.isVariableStatement(node)) {
      return
    }

    for (const declaration of node.declarationList.declarations) {
      if (
        !ts.isIdentifier(declaration.name) ||
        declaration.name.text !== "SITE_INTEGRATION_MANIFESTS"
      ) {
        continue
      }

      if (
        declaration.initializer &&
        ts.isArrayLiteralExpression(declaration.initializer)
      ) {
        manifestArray = declaration.initializer
      }
    }
  })

  return manifestArray
}

function readManifestEntries() {
  const sourceFile = readManifestSourceFile()
  const manifestArray = findManifestArray(sourceFile)
  if (!manifestArray) {
    fail(
      "Unable to find SITE_INTEGRATION_MANIFESTS array in src/site-integrations/manifest.ts"
    )
    return []
  }

  const entries = []
  for (const element of manifestArray.elements) {
    if (!ts.isObjectLiteralExpression(element)) {
      continue
    }

    const id = getStringProperty(element, "id")
    const name = getStringProperty(element, "name")
    const maturity = getStringProperty(element, "maturity")
    const implementationType = getStringProperty(element, "implementationType")
    const shipped = getBooleanProperty(element, "shipped")
    const enabledByDefault = getBooleanProperty(element, "enabledByDefault")
    const requiresPageProbe = getBooleanProperty(element, "requiresPageProbe")
    const requiresBroadHttpsPermission =
      getBooleanProperty(element, "requiresBroadHttpsPermission") ?? false
    const requiredOrigins = getStringArrayProperty(element, "requiredOrigins")
    const runtimes = getRuntimes(element)

    if (!id) {
      fail("Every site integration manifest entry must have a string id")
      continue
    }

    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
      fail(
        `Site integration id "${id}" must be path-safe: lowercase letters, numbers, and hyphens only`
      )
    }

    if (!name || !maturity || !implementationType) {
      fail(
        `Site integration "${id}" must declare string name, maturity, and implementationType fields`
      )
      continue
    }
    if (typeof shipped !== "boolean") {
      fail(`Site integration "${id}" must declare shipped: boolean`)
      continue
    }
    if (typeof enabledByDefault !== "boolean") {
      fail(`Site integration "${id}" must declare enabledByDefault: boolean`)
      continue
    }
    if (typeof requiresPageProbe !== "boolean") {
      fail(`Site integration "${id}" must declare requiresPageProbe: boolean`)
      continue
    }
    if (!requiredOrigins || requiredOrigins.length === 0) {
      fail(`Site integration "${id}" must declare requiredOrigins`)
      continue
    }

    if (!runtimes) {
      fail(
        `Site integration "${id}" must declare runtimes: { background, offscreen }`
      )
      continue
    }

    for (const context of ["background", "offscreen"]) {
      if (typeof runtimes[context] !== "boolean") {
        fail(
          `Site integration "${id}" runtimes.${context} must be true or false`
        )
      }
    }

    entries.push({
      id,
      name,
      maturity,
      implementationType,
      shipped,
      enabledByDefault,
      requiresPageProbe,
      requiresBroadHttpsPermission,
      requiredOrigins,
      runtimes,
    })
  }

  return entries
}

function toIdentifier(siteId, context) {
  const prefix = siteId
    .split("-")
    .map((part, index) =>
      index === 0 ? part : `${part.charAt(0).toUpperCase()}${part.slice(1)}`
    )
    .join("")
  const contextSuffix = `${context.charAt(0).toUpperCase()}${context.slice(1)}Adapter`
  return `${prefix}${contextSuffix}`
}

function validateRuntimeFile(siteId, context) {
  const runtimeFile = path.join(
    workspaceRoot,
    `src/site-integrations/${siteId}/${context}-runtime.ts`
  )
  if (!fs.existsSync(runtimeFile)) {
    fail(
      `Site integration "${siteId}" declares runtimes.${context}=true but ${path.relative(workspaceRoot, runtimeFile)} does not exist`
    )
  }
}

function generatedHeader() {
  return [
    "// This file is generated by scripts/generate-site-integration-registries.mjs.",
    "// Do not edit it directly.",
    "",
  ].join("\n")
}

function generateRegistrySource(entries, definition) {
  const shippedEntries = entries.filter(
    (entry) => entry.shipped && entry.runtimes[definition.context]
  )
  for (const entry of shippedEntries) {
    validateRuntimeFile(entry.id, definition.context)
  }

  const importLines = [
    `import type { ${definition.typeName} } from '@/src/types/site-integrations'`,
    ...shippedEntries.map((entry) => {
      const alias = toIdentifier(entry.id, definition.context)
      return `import { ${definition.exportName} as ${alias} } from '@/src/site-integrations/${entry.id}/${definition.context}-runtime'`
    }),
  ]

  const identifiers = shippedEntries.map((entry) =>
    toIdentifier(entry.id, definition.context)
  )
  const arrayBody =
    identifiers.length > 0
      ? identifiers.map((identifier) => `  ${identifier},`).join("\n")
      : ""

  return `${generatedHeader()}${importLines.join("\n")}\n\nexport const ${definition.collectionName} = [\n${arrayBody}\n] as const satisfies readonly ${definition.typeName}[]\n\nexport const ${definition.byIdName} = Object.fromEntries(\n  ${definition.collectionName}.map((integration) => [integration.id, integration]),\n) as Readonly<Record<string, ${definition.typeName}>>\n`
}

function escapeMarkdownCell(value) {
  return String(value).replace(/\|/g, "\\|")
}

function generateIntegrationDocumentation(entries) {
  const shippedEntries = entries.filter((entry) => entry.shipped)
  const rows = shippedEntries.map((entry) => {
    const runtimes = runtimeDefinitions
      .map((definition) => definition.context)
      .filter((context) => entry.runtimes[context])
      .join(", ")
    const origins = entry.requiredOrigins
      .map((origin) => `\`${origin}\``)
      .join("<br>")
    return `| \`${escapeMarkdownCell(entry.id)}\` | ${escapeMarkdownCell(entry.name)} | ${entry.maturity} | ${entry.implementationType} | ${entry.enabledByDefault ? "Yes" : "No"} | ${entry.requiresPageProbe ? "Yes" : "No"} | ${entry.requiresBroadHttpsPermission ? "Yes" : "No"} | ${runtimes} | ${origins} |`
  })

  return [
    "<!-- This file is generated by scripts/generate-site-integration-registries.mjs. -->",
    "<!-- Do not edit it directly. -->",
    "",
    "# Shipped site integrations",
    "",
    "This inventory is generated from `src/site-integrations/manifest.ts`, the canonical integration registry.",
    "",
    "| ID | Name | Maturity | Implementation | Enabled by default | Page probe | Broad HTTPS permission | Runtimes | Required origins |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n")
}

function normalizeNewlines(source) {
  return source.replace(/\r\n/g, "\n")
}

function writeOrCheckGeneratedFile(filePath, source) {
  if (!checkOnly) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, source, "utf8")
    return
  }

  if (!fs.existsSync(filePath)) {
    fail(`Generated file is missing: ${path.relative(workspaceRoot, filePath)}`)
    return
  }

  const existingSource = fs.readFileSync(filePath, "utf8")
  if (normalizeNewlines(existingSource) !== normalizeNewlines(source)) {
    fail(
      `Generated file is stale: ${path.relative(workspaceRoot, filePath)}. Run pnpm generate:site-integrations.`
    )
  }
}

const manifestEntries = readManifestEntries()
for (const definition of runtimeDefinitions) {
  const source = generateRegistrySource(manifestEntries, definition)
  const outputPath = path.join(
    generatedDir,
    `site-integration-${definition.context}-registry.ts`
  )
  writeOrCheckGeneratedFile(outputPath, source)
}
const legacyContentRegistryPath = path.join(
  generatedDir,
  "site-integration-content-registry.ts"
)
if (checkOnly && fs.existsSync(legacyContentRegistryPath)) {
  fail(
    "Obsolete generated file exists: src/runtime/generated/site-integration-content-registry.ts"
  )
} else if (!checkOnly && fs.existsSync(legacyContentRegistryPath)) {
  fs.unlinkSync(legacyContentRegistryPath)
}
if (includeDocumentation) {
  writeOrCheckGeneratedFile(
    generatedDocumentationPath,
    generateIntegrationDocumentation(manifestEntries)
  )
}

if (process.exitCode) {
  process.exit(process.exitCode)
}
