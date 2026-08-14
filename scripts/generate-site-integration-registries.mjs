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
// Provider capability documentation is part of the same generated-artifact
// contract as the runtime registries. `--documentation` remains accepted for
// existing maintainer commands, but is no longer required.
const includeDocumentation = true

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

const sourceFileCache = new Map()

function readSourceFile(filePath) {
  const cached = sourceFileCache.get(filePath)
  if (cached) return cached

  const sourceText = fs.readFileSync(filePath, "utf8")
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  )
  sourceFileCache.set(filePath, sourceFile)
  return sourceFile
}

function readManifestSourceFile() {
  return readSourceFile(manifestPath)
}

function unwrapExpression(expression) {
  let current = expression
  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current)
  ) {
    current = current.expression
  }
  return current
}

function findVariableInitializer(sourceFile, variableName) {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === variableName &&
        declaration.initializer
      ) {
        return declaration.initializer
      }
    }
  }
  return undefined
}

function resolveImportedInitializer(sourceFile, localName) {
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      continue
    }
    const namedBindings = statement.importClause?.namedBindings
    if (!namedBindings || !ts.isNamedImports(namedBindings)) continue

    const imported = namedBindings.elements.find(
      (element) => element.name.text === localName
    )
    if (!imported) continue

    const modulePath = statement.moduleSpecifier.text
    if (!modulePath.startsWith(".")) return undefined
    const resolvedPath = path.resolve(
      path.dirname(sourceFile.fileName),
      `${modulePath}.ts`
    )
    const importedSourceFile = readSourceFile(resolvedPath)
    const importedName = imported.propertyName?.text ?? imported.name.text
    const initializer = findVariableInitializer(
      importedSourceFile,
      importedName
    )
    return initializer
      ? { expression: initializer, sourceFile: importedSourceFile }
      : undefined
  }
  return undefined
}

function resolveExpression(sourceFile, expression, seen = new Set()) {
  const unwrapped = unwrapExpression(expression)
  if (ts.isIdentifier(unwrapped)) {
    const key = `${sourceFile.fileName}:${unwrapped.text}`
    if (seen.has(key)) return { expression: unwrapped, sourceFile }
    const nextSeen = new Set(seen)
    nextSeen.add(key)

    const localInitializer = findVariableInitializer(sourceFile, unwrapped.text)
    if (localInitializer) {
      return resolveExpression(sourceFile, localInitializer, nextSeen)
    }
    const imported = resolveImportedInitializer(sourceFile, unwrapped.text)
    if (imported) {
      return resolveExpression(
        imported.sourceFile,
        imported.expression,
        nextSeen
      )
    }
  }

  if (ts.isPropertyAccessExpression(unwrapped)) {
    const owner = resolveExpression(sourceFile, unwrapped.expression, seen)
    if (ts.isObjectLiteralExpression(owner.expression)) {
      const property = getObjectProperty(owner.expression, unwrapped.name.text)
      if (property) {
        return resolveExpression(owner.sourceFile, property.initializer, seen)
      }
    }
  }

  return { expression: unwrapped, sourceFile }
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

function getStringProperty(objectLiteral, propertyName, sourceFile) {
  const property = getObjectProperty(objectLiteral, propertyName)
  if (!property) {
    return undefined
  }
  const resolved = sourceFile
    ? resolveExpression(sourceFile, property.initializer).expression
    : unwrapExpression(property.initializer)
  return ts.isStringLiteral(resolved) ? resolved.text : undefined
}

function getBooleanProperty(objectLiteral, propertyName, sourceFile) {
  const property = getObjectProperty(objectLiteral, propertyName)
  if (!property) {
    return undefined
  }
  const resolved = sourceFile
    ? resolveExpression(sourceFile, property.initializer).expression
    : unwrapExpression(property.initializer)
  if (resolved.kind === ts.SyntaxKind.TrueKeyword) {
    return true
  }
  if (resolved.kind === ts.SyntaxKind.FalseKeyword) {
    return false
  }
  return undefined
}

function getNumberProperty(objectLiteral, propertyName, sourceFile) {
  const property = getObjectProperty(objectLiteral, propertyName)
  if (!property) return undefined
  const resolved = resolveExpression(
    sourceFile,
    property.initializer
  ).expression
  return ts.isNumericLiteral(resolved) ? Number(resolved.text) : undefined
}

function readStringArray(sourceFile, expression) {
  const resolved = resolveExpression(sourceFile, expression)
  if (!ts.isArrayLiteralExpression(resolved.expression)) {
    return undefined
  }

  const values = []
  for (const element of resolved.expression.elements) {
    if (ts.isSpreadElement(element)) {
      const spreadValues = readStringArray(
        resolved.sourceFile,
        element.expression
      )
      if (!spreadValues) return undefined
      values.push(...spreadValues)
      continue
    }

    const value = resolveExpression(resolved.sourceFile, element).expression
    if (!ts.isStringLiteral(value)) return undefined
    values.push(value.text)
  }
  return values
}

function getStringArrayProperty(objectLiteral, propertyName, sourceFile) {
  const property = getObjectProperty(objectLiteral, propertyName)
  if (!property) return undefined
  return readStringArray(sourceFile, property.initializer)
}

function getRuntimes(objectLiteral, sourceFile) {
  const property = getObjectProperty(objectLiteral, "runtimes")
  if (!property || !ts.isObjectLiteralExpression(property.initializer)) {
    return undefined
  }

  return {
    background: getBooleanProperty(
      property.initializer,
      "background",
      sourceFile
    ),
    offscreen: getBooleanProperty(
      property.initializer,
      "offscreen",
      sourceFile
    ),
  }
}

function getObjectArrayProperty(objectLiteral, propertyName, sourceFile) {
  const property = getObjectProperty(objectLiteral, propertyName)
  if (!property) return []
  const resolved = resolveExpression(sourceFile, property.initializer)
  if (!ts.isArrayLiteralExpression(resolved.expression)) return undefined

  const values = []
  for (const element of resolved.expression.elements) {
    const value = resolveExpression(resolved.sourceFile, element)
    if (!ts.isObjectLiteralExpression(value.expression)) return undefined
    values.push({
      objectLiteral: value.expression,
      sourceFile: value.sourceFile,
    })
  }
  return values
}

function getNetworkCapabilities(objectLiteral, sourceFile) {
  const property = getObjectProperty(objectLiteral, "network")
  if (!property) {
    return { credentialPolicies: [], sessionRefererRules: [] }
  }
  const network = resolveExpression(sourceFile, property.initializer)
  if (!ts.isObjectLiteralExpression(network.expression)) return undefined

  const rules = getObjectArrayProperty(
    network.expression,
    "sessionRefererRules",
    network.sourceFile
  )
  const credentials = getObjectArrayProperty(
    network.expression,
    "credentialPolicies",
    network.sourceFile
  )
  if (!rules || !credentials) return undefined

  return {
    sessionRefererRules: rules.map(
      ({ objectLiteral, sourceFile: ruleSource }) => ({
        id: getNumberProperty(objectLiteral, "id", ruleSource),
        requestDomains: getStringArrayProperty(
          objectLiteral,
          "requestDomains",
          ruleSource
        ),
        referer: getStringProperty(objectLiteral, "referer", ruleSource),
      })
    ),
    credentialPolicies: credentials.map(
      ({ objectLiteral, sourceFile: credentialSource }) => ({
        purpose: getStringProperty(objectLiteral, "purpose", credentialSource),
        mode: getStringProperty(objectLiteral, "mode", credentialSource),
      })
    ),
  }
}

function getPatternDomains(objectLiteral, sourceFile) {
  const property = getObjectProperty(objectLiteral, "patterns")
  if (!property || !ts.isObjectLiteralExpression(property.initializer)) {
    return undefined
  }
  return getStringArrayProperty(property.initializer, "domains", sourceFile)
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

    const id = getStringProperty(element, "id", sourceFile)
    const name = getStringProperty(element, "name", sourceFile)
    const maturity = getStringProperty(element, "maturity", sourceFile)
    const implementationType = getStringProperty(
      element,
      "implementationType",
      sourceFile
    )
    const shipped = getBooleanProperty(element, "shipped", sourceFile)
    const enabledByDefault = getBooleanProperty(
      element,
      "enabledByDefault",
      sourceFile
    )
    const requiresPageProbe = getBooleanProperty(
      element,
      "requiresPageProbe",
      sourceFile
    )
    const requiresBroadHttpsPermission =
      getBooleanProperty(element, "requiresBroadHttpsPermission", sourceFile) ??
      false
    const requiredOrigins = getStringArrayProperty(
      element,
      "requiredOrigins",
      sourceFile
    )
    const patternDomains = getPatternDomains(element, sourceFile)
    const network = getNetworkCapabilities(element, sourceFile)
    const runtimes = getRuntimes(element, sourceFile)

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
    if (!network) {
      fail(`Site integration "${id}" has an unreadable network declaration`)
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
      patternDomains: patternDomains ?? [],
      ...network,
      runtimes,
    })
  }

  validateNetworkCapabilities(entries)
  return entries
}

function requiredOriginCoversDomain(requiredOrigin, domain) {
  const match = /^https:\/\/([^/]+)\/\*$/.exec(requiredOrigin)
  const hostPattern = match?.[1]
  if (!hostPattern) return false
  if (hostPattern === "*" || hostPattern === domain) return true
  if (!hostPattern.startsWith("*.")) return false

  const baseDomain = hostPattern.slice(2)
  return domain === baseDomain || domain.endsWith(`.${baseDomain}`)
}

function validateNetworkCapabilities(entries) {
  const managedRuleIds = new Set()

  for (const entry of entries) {
    for (const rule of entry.sessionRefererRules) {
      if (
        !Number.isSafeInteger(rule.id) ||
        rule.id < 41_000 ||
        rule.id > 41_999
      ) {
        fail(
          `Site integration "${entry.id}" has a DNR rule outside the extension-managed 41000-41999 range`
        )
        continue
      }
      if (managedRuleIds.has(rule.id)) {
        fail(`Duplicate managed DNR rule id: ${rule.id}`)
      }
      managedRuleIds.add(rule.id)

      if (!rule.requestDomains || rule.requestDomains.length === 0) {
        fail(
          `Site integration "${entry.id}" DNR rule ${rule.id} has no domains`
        )
        continue
      }
      for (const domain of rule.requestDomains) {
        if (
          !entry.requiredOrigins.some((origin) =>
            requiredOriginCoversDomain(origin, domain)
          )
        ) {
          fail(
            `DNR request domain "${domain}" is not covered by requiredOrigins for "${entry.id}"`
          )
        }
      }

      let refererHost
      try {
        refererHost = new URL(rule.referer).hostname
      } catch {
        fail(
          `Site integration "${entry.id}" DNR rule ${rule.id} has no referer`
        )
        continue
      }
      if (!entry.patternDomains.includes(refererHost)) {
        fail(
          `DNR referer host "${refererHost}" is not a page domain for "${entry.id}"`
        )
      }
    }

    for (const policy of entry.credentialPolicies) {
      if (
        !policy.purpose ||
        (policy.mode !== "include" && policy.mode !== "omit")
      ) {
        fail(
          `Site integration "${entry.id}" has an invalid credential policy declaration`
        )
      }
    }
  }
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
    const sessionRules =
      entry.sessionRefererRules.length > 0
        ? entry.sessionRefererRules
            .map(
              (rule) =>
                `\`${rule.id}\`: ${rule.requestDomains.map((domain) => `\`${domain}\``).join(", ")}`
            )
            .join("<br>")
        : "None"
    const credentialPolicies =
      entry.credentialPolicies.length > 0
        ? entry.credentialPolicies
            .map(
              (policy) =>
                `${escapeMarkdownCell(policy.purpose)}: \`${policy.mode}\``
            )
            .join("<br>")
        : "Not provider-declared"
    return `| \`${escapeMarkdownCell(entry.id)}\` | ${escapeMarkdownCell(entry.name)} | ${entry.maturity} | ${entry.implementationType} | ${entry.enabledByDefault ? "Yes" : "No"} | ${entry.requiresPageProbe ? "Yes" : "No"} | ${entry.requiresBroadHttpsPermission ? "Yes" : "No"} | ${runtimes} | ${sessionRules} | ${credentialPolicies} | ${origins} |`
  })

  return [
    "<!-- This file is generated by scripts/generate-site-integration-registries.mjs. -->",
    "<!-- Do not edit it directly. -->",
    "",
    "# Shipped site integrations",
    "",
    "This inventory is generated from `src/site-integrations/manifest.ts`, the canonical integration registry.",
    "",
    "| ID | Name | Maturity | Implementation | Enabled by default | Page probe | Broad HTTPS permission | Runtimes | Session referer rules | Credential policies | Required origins |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
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
