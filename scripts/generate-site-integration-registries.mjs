import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import ts from 'typescript'

const workspaceRoot = process.cwd()
const manifestPath = path.join(workspaceRoot, 'src/site-integrations/manifest.ts')
const generatedDir = path.join(workspaceRoot, 'src/runtime/generated')
const checkOnly = process.argv.includes('--check')

const runtimeDefinitions = [
  {
    context: 'content',
    typeName: 'ContentSiteAdapter',
    exportName: 'contentSiteAdapter',
    collectionName: 'contentSiteAdapters',
    byIdName: 'contentSiteAdaptersById',
  },
  {
    context: 'background',
    typeName: 'BackgroundSiteAdapter',
    exportName: 'backgroundSiteAdapter',
    collectionName: 'backgroundSiteAdapters',
    byIdName: 'backgroundSiteAdaptersById',
  },
  {
    context: 'offscreen',
    typeName: 'OffscreenSiteAdapter',
    exportName: 'offscreenSiteAdapter',
    collectionName: 'offscreenSiteAdapters',
    byIdName: 'offscreenSiteAdaptersById',
  },
]

function fail(message) {
  console.error(message)
  process.exitCode = 1
}

function readManifestSourceFile() {
  const sourceText = fs.readFileSync(manifestPath, 'utf8')
  return ts.createSourceFile(manifestPath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

function propertyNameText(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text
  }
  return undefined
}

function getObjectProperty(objectLiteral, propertyName) {
  return objectLiteral.properties.find((property) => (
    ts.isPropertyAssignment(property) &&
    propertyNameText(property.name) === propertyName
  ))
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

function getRuntimes(objectLiteral) {
  const property = getObjectProperty(objectLiteral, 'runtimes')
  if (!property || !ts.isObjectLiteralExpression(property.initializer)) {
    return undefined
  }

  return {
    content: getBooleanProperty(property.initializer, 'content'),
    background: getBooleanProperty(property.initializer, 'background'),
    offscreen: getBooleanProperty(property.initializer, 'offscreen'),
  }
}

function findManifestArray(sourceFile) {
  let manifestArray

  sourceFile.forEachChild((node) => {
    if (!ts.isVariableStatement(node)) {
      return
    }

    for (const declaration of node.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== 'SITE_INTEGRATION_MANIFESTS') {
        continue
      }

      if (declaration.initializer && ts.isArrayLiteralExpression(declaration.initializer)) {
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
    fail('Unable to find SITE_INTEGRATION_MANIFESTS array in src/site-integrations/manifest.ts')
    return []
  }

  const entries = []
  for (const element of manifestArray.elements) {
    if (!ts.isObjectLiteralExpression(element)) {
      continue
    }

    const id = getStringProperty(element, 'id')
    const enabled = getBooleanProperty(element, 'enabled')
    const runtimes = getRuntimes(element)

    if (!id) {
      fail('Every site integration manifest entry must have a string id')
      continue
    }

    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
      fail(`Site integration id "${id}" must be path-safe: lowercase letters, numbers, and hyphens only`)
    }

    if (!runtimes) {
      fail(`Site integration "${id}" must declare runtimes: { content, background, offscreen }`)
      continue
    }

    for (const context of ['content', 'background', 'offscreen']) {
      if (typeof runtimes[context] !== 'boolean') {
        fail(`Site integration "${id}" runtimes.${context} must be true or false`)
      }
    }

    entries.push({ id, enabled: enabled !== false, runtimes })
  }

  return entries
}

function toIdentifier(siteId, context) {
  const prefix = siteId
    .split('-')
    .map((part, index) => index === 0 ? part : `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join('')
  const contextSuffix = `${context.charAt(0).toUpperCase()}${context.slice(1)}Adapter`
  return `${prefix}${contextSuffix}`
}

function validateRuntimeFile(siteId, context) {
  const runtimeFile = path.join(workspaceRoot, `src/site-integrations/${siteId}/${context}-runtime.ts`)
  if (!fs.existsSync(runtimeFile)) {
    fail(`Site integration "${siteId}" declares runtimes.${context}=true but ${path.relative(workspaceRoot, runtimeFile)} does not exist`)
  }
}

function generatedHeader() {
  return [
    '// This file is generated by scripts/generate-site-integration-registries.mjs.',
    '// Do not edit it directly.',
    '',
  ].join('\n')
}

function generateRegistrySource(entries, definition) {
  const enabledEntries = entries.filter((entry) => entry.enabled && entry.runtimes[definition.context])
  for (const entry of enabledEntries) {
    validateRuntimeFile(entry.id, definition.context)
  }

  const importLines = [
    `import type { ${definition.typeName} } from '@/src/types/site-integrations'`,
    ...enabledEntries.map((entry) => {
      const alias = toIdentifier(entry.id, definition.context)
      return `import { ${definition.exportName} as ${alias} } from '@/src/site-integrations/${entry.id}/${definition.context}-runtime'`
    }),
  ]

  const identifiers = enabledEntries.map((entry) => toIdentifier(entry.id, definition.context))
  const arrayBody = identifiers.length > 0
    ? identifiers.map((identifier) => `  ${identifier},`).join('\n')
    : ''

  return `${generatedHeader()}${importLines.join('\n')}\n\nexport const ${definition.collectionName} = [\n${arrayBody}\n] as const satisfies readonly ${definition.typeName}[]\n\nexport const ${definition.byIdName} = Object.fromEntries(\n  ${definition.collectionName}.map((integration) => [integration.id, integration]),\n) as Readonly<Record<string, ${definition.typeName}>>\n`
}

function normalizeNewlines(source) {
  return source.replace(/\r\n/g, '\n')
}

function writeOrCheckGeneratedFile(filePath, source) {
  if (!checkOnly) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, source, 'utf8')
    return
  }

  if (!fs.existsSync(filePath)) {
    fail(`Generated file is missing: ${path.relative(workspaceRoot, filePath)}`)
    return
  }

  const existingSource = fs.readFileSync(filePath, 'utf8')
  if (normalizeNewlines(existingSource) !== normalizeNewlines(source)) {
    fail(`Generated file is stale: ${path.relative(workspaceRoot, filePath)}. Run pnpm generate:site-integrations.`)
  }
}

const manifestEntries = readManifestEntries()
for (const definition of runtimeDefinitions) {
  const source = generateRegistrySource(manifestEntries, definition)
  const outputPath = path.join(generatedDir, `site-integration-${definition.context}-registry.ts`)
  writeOrCheckGeneratedFile(outputPath, source)
}

if (process.exitCode) {
  process.exit(process.exitCode)
}
