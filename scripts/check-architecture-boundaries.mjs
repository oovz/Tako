import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import ts from "typescript"

const root = path.resolve(process.cwd())
const productionRoots = ["src", "entrypoints", "components"]
const productionExtensions = new Set([".ts", ".tsx"])
const constructorOwners = new Set([
  "QueueRepository",
  "QueueProjectionService",
  "NativeOutputRepository",
  "NativeOutputCoordinator",
  "SettingsRepository",
  "HistoryRepository",
  "RateLimitService",
])
const projectionFunctions = new Set(["projectToQueueView", "updateActionBadge"])
const allowedSetEnablementMapFiles = new Set([
  "entrypoints/background/background-runtime-kernel.ts",
  "src/runtime/site-integration-initialization.ts",
  "entrypoints/background/e2e-state-seed.ts",
])
// Composition wiring, the upgrade boundary and the isolated E2E seed are the
// explicit exceptions to repository-owned durable storage mutation.
const allowedLocalMutationFiles = new Set([
  "entrypoints/background/index.ts",
  "src/runtime/state-schema-migration.ts",
  "entrypoints/background/e2e-state-seed.ts",
])
const domainAmbientNames = new Set([
  "browser",
  "chrome",
  "clearInterval",
  "clearTimeout",
  "setInterval",
  "setTimeout",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "queueMicrotask",
])
const obsoleteProductionPaths = [
  "src/runtime/centralized-state.ts",
  "entrypoints/background/state-manager.ts",
  "entrypoints/background/download-queue-runner.ts",
  "entrypoints/background/download-task-runner-registry.ts",
]

const errors = []
const sourceFiles = new Map()
const graph = new Map()
let internalImportCount = 0

function normalizeRelative(filePath) {
  return path.relative(root, filePath).split(path.sep).join("/")
}

function normalizeAbsolute(filePath) {
  return path.normalize(filePath).toLowerCase()
}

function collectProductionFiles(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      collectProductionFiles(entryPath, files)
      continue
    }

    if (entry.isFile() && productionExtensions.has(path.extname(entry.name))) {
      files.push(entryPath)
    }
  }

  return files
}

function sourceKind(filePath) {
  return path.extname(filePath) === ".tsx"
    ? ts.ScriptKind.TSX
    : ts.ScriptKind.TS
}

function addSourceFile(filePath) {
  const absolutePath = path.resolve(filePath)
  const relativePath = normalizeRelative(absolutePath)
  const source = ts.createSourceFile(
    absolutePath,
    fs.readFileSync(absolutePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    sourceKind(absolutePath)
  )
  const metadata = { absolutePath, relativePath, source }
  sourceFiles.set(normalizeAbsolute(absolutePath), metadata)
  graph.set(normalizeAbsolute(absolutePath), [])
}

function sourceMetadata(filePath) {
  return sourceFiles.get(normalizeAbsolute(filePath))
}

function importBasePath(fromFile, specifier) {
  if (specifier === "@") return root
  if (specifier.startsWith("@/")) return path.join(root, specifier.slice(2))
  if (specifier.startsWith(".")) {
    return path.resolve(path.dirname(fromFile), specifier)
  }
  return undefined
}

function importCandidates(candidate) {
  const candidates = [candidate]
  const extension = path.extname(candidate)
  if ([".js", ".jsx", ".mjs"].includes(extension)) {
    candidates.push(candidate.slice(0, -extension.length) + ".ts")
    candidates.push(candidate.slice(0, -extension.length) + ".tsx")
  }
  if (!extension) {
    candidates.push(`${candidate}.ts`)
    candidates.push(`${candidate}.tsx`)
  }
  candidates.push(path.join(candidate, "index.ts"))
  candidates.push(path.join(candidate, "index.tsx"))
  return candidates
}

function resolveImport(fromFile, specifier) {
  const candidate = importBasePath(fromFile, specifier)
  if (candidate === undefined) return undefined
  for (const possiblePath of importCandidates(candidate)) {
    const metadata = sourceMetadata(possiblePath)
    if (metadata) return metadata
  }
  return undefined
}

function lineAndColumn(metadata, node) {
  if (!node) return { line: 1, column: 1 }
  const position = metadata.source.getLineAndCharacterOfPosition(
    node.getStart(metadata.source)
  )
  return { line: position.line + 1, column: position.character + 1 }
}

function report(metadata, node, message) {
  const location = lineAndColumn(metadata, node)
  errors.push({
    file: metadata.relativePath,
    line: location.line,
    column: location.column,
    message,
  })
}

function reportPath(relativePath, message) {
  errors.push({ file: relativePath, line: 1, column: 1, message })
}

function propertyChain(expression) {
  if (ts.isIdentifier(expression)) return [expression.text]
  if (ts.isPropertyAccessExpression(expression)) {
    const parent = propertyChain(expression.expression)
    return parent ? [...parent, expression.name.text] : undefined
  }
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isNonNullExpression(expression) ||
    ts.isTypeAssertionExpression(expression)
  ) {
    return propertyChain(expression.expression)
  }
  return undefined
}

function isImportSyntax(node) {
  let current = node.parent
  while (current) {
    if (
      ts.isImportDeclaration(current) ||
      ts.isImportEqualsDeclaration(current) ||
      ts.isImportClause(current) ||
      ts.isImportSpecifier(current) ||
      ts.isNamespaceImport(current) ||
      ts.isNamedImports(current)
    ) {
      return true
    }
    current = current.parent
  }
  return false
}

function addGraphEdge(metadata, node, specifier) {
  const target = resolveImport(metadata.absolutePath, specifier)
  if (!target) return

  const fromKey = normalizeAbsolute(metadata.absolutePath)
  graph.get(fromKey).push({
    target: normalizeAbsolute(target.absolutePath),
    node,
  })
  internalImportCount += 1
}

const allowedFetchFiles = new Set([
  "src/site-integrations/http-client.ts",
  "src/runtime/i18n.ts",
])
const allowedConstructorFile = "entrypoints/background/index.ts"
const allowedProjectionFile = "src/storage/queue-projection-service.ts"
const forbiddenDomainImportPrefixes = [
  "src/storage/",
  "src/runtime/",
  "src/site-integrations/",
  "entrypoints/",
  "components/",
]
const domainClockCalls = new Set(["Date.now", "Math.random", "performance.now"])
const domainCryptoCalls = new Set([
  "crypto.randomUUID",
  "crypto.getRandomValues",
])

function declarationModuleReference(node) {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    const specifier = node.moduleSpecifier
    if (specifier && ts.isStringLiteral(specifier)) return specifier
  }
  if (
    ts.isImportEqualsDeclaration(node) &&
    ts.isExternalModuleReference(node.moduleReference) &&
    ts.isStringLiteral(node.moduleReference.expression)
  ) {
    return node.moduleReference
  }
  return undefined
}

function expressionModuleReference(node) {
  if (
    ts.isCallExpression(node) &&
    node.expression.kind === ts.SyntaxKind.ImportKeyword &&
    node.arguments.length >= 1 &&
    ts.isStringLiteralLike(node.arguments[0])
  ) {
    return node.arguments[0]
  }
  if (
    ts.isImportTypeNode(node) &&
    ts.isLiteralTypeNode(node.argument) &&
    ts.isStringLiteral(node.argument.literal)
  ) {
    return node.argument.literal
  }
  return undefined
}

function inspectModuleReference(metadata, node) {
  const reference =
    declarationModuleReference(node) ?? expressionModuleReference(node)
  if (!reference) return
  const specifier = ts.isExternalModuleReference(reference)
    ? reference.expression.text
    : reference.text
  addGraphEdge(metadata, reference, specifier)
  if (metadata.relativePath.startsWith("src/domain/")) {
    inspectDomainImport(metadata, reference, specifier)
  }
}

function inspectDomainImport(metadata, node, specifier) {
  const imported = resolveImport(metadata.absolutePath, specifier)
  if (
    imported &&
    forbiddenDomainImportPrefixes.some((prefix) =>
      imported.relativePath.startsWith(prefix)
    )
  ) {
    report(
      metadata,
      node,
      `Domain code must not import resolved ${imported.relativePath}.`
    )
  }
  if (/(?:^|\/)logger(?:\.[cm]?js|\.ts)?$/.test(specifier)) {
    report(metadata, node, "Domain code must not import the runtime logger.")
  }
}

function inspectDomainIdentifier(metadata, node) {
  if (!ts.isIdentifier(node) || isImportSyntax(node)) return
  if (domainAmbientNames.has(node.text)) {
    report(
      metadata,
      node,
      `Domain code must not use ambient ${node.text}; inject this dependency instead.`
    )
  }
  if (node.text === "logger") {
    report(metadata, node, "Domain code must not use the runtime logger.")
  }
}

function inspectDomainEnvironment(metadata, node) {
  if (
    ts.isPropertyAccessExpression(node) &&
    node.name.text === "env" &&
    ts.isMetaProperty(node.expression) &&
    node.expression.keywordToken === ts.SyntaxKind.ImportKeyword
  ) {
    report(metadata, node, "Domain code must not read import.meta.env.")
  }
}

function inspectDomainCall(metadata, node, chain) {
  const call = chain?.join(".")
  if (domainClockCalls.has(call)) {
    report(
      metadata,
      node,
      "Domain code must not use ambient Date.now(), Math.random(), or performance.now()."
    )
  }
  if (domainCryptoCalls.has(call)) {
    report(
      metadata,
      node,
      "Domain code must not use ambient crypto randomness."
    )
  }
}

function isLocalStorageMutation(chain) {
  if (chain?.length !== 4) return false
  return (
    ["chrome", "browser"].includes(chain[0]) &&
    chain[1] === "storage" &&
    chain[2] === "local" &&
    ["set", "remove", "clear"].includes(chain[3])
  )
}

function inspectStorageCall(metadata, node, chain) {
  if (
    isLocalStorageMutation(chain) &&
    !metadata.relativePath.startsWith("src/storage/") &&
    !allowedLocalMutationFiles.has(metadata.relativePath)
  ) {
    report(
      metadata,
      node,
      "Durable local storage mutations belong in src/storage/; composition, migration and isolated E2E seeding are explicit exceptions."
    )
  }
}

function inspectBrowserCall(metadata, node, chain) {
  const call = chain?.join(".")
  if (
    call === "chrome.runtime.sendMessage" &&
    metadata.relativePath !== "src/runtime/send-runtime-message.ts"
  ) {
    report(
      metadata,
      node,
      "Direct chrome.runtime.sendMessage calls belong only in src/runtime/send-runtime-message.ts."
    )
  }
  if (
    ["chrome.downloads.download", "chrome.downloads.search"].includes(call) &&
    metadata.relativePath !==
      "entrypoints/background/native-output-coordinator.ts"
  ) {
    report(
      metadata,
      node,
      "chrome.downloads.download/search calls belong only in entrypoints/background/native-output-coordinator.ts."
    )
  }
}

function inspectFetchCall(metadata, node) {
  if (
    ts.isIdentifier(node.expression) &&
    node.expression.text === "fetch" &&
    !allowedFetchFiles.has(metadata.relativePath)
  ) {
    report(
      metadata,
      node,
      "Raw fetch() calls belong only in src/site-integrations/http-client.ts or src/runtime/i18n.ts."
    )
  }
}

function inspectProjectionCall(metadata, node, chain) {
  const calledName = chain?.at(-1)
  if (
    calledName &&
    projectionFunctions.has(calledName) &&
    metadata.relativePath !== allowedProjectionFile
  ) {
    report(
      metadata,
      node,
      `${calledName} calls belong only in ${allowedProjectionFile}.`
    )
  }
  if (
    calledName === "setEnablementMap" &&
    !allowedSetEnablementMapFiles.has(metadata.relativePath)
  ) {
    report(
      metadata,
      node,
      "setEnablementMap() calls belong only in runtime initialization modules (entrypoints/background/background-runtime-kernel.ts, src/runtime/site-integration-initialization.ts) and E2E state seed (entrypoints/background/e2e-state-seed.ts)."
    )
  }
}

function inspectConstructor(metadata, node) {
  if (!ts.isNewExpression(node) || !ts.isIdentifier(node.expression)) return
  const constructorName = node.expression.text
  if (!constructorOwners.has(constructorName)) return
  const allowed =
    metadata.relativePath === allowedConstructorFile ||
    (constructorName === "RateLimitService" &&
      metadata.relativePath === "entrypoints/offscreen/main-worker.ts")
  if (!allowed) {
    report(
      metadata,
      node,
      `Only ${allowedConstructorFile}${
        constructorName === "RateLimitService"
          ? " (and entrypoints/offscreen/main-worker.ts for RateLimitService)"
          : ""
      } may construct ${constructorName}.`
    )
  }
}

function inspectNode(metadata, node) {
  inspectModuleReference(metadata, node)
  const isDomain = metadata.relativePath.startsWith("src/domain/")
  if (isDomain) {
    inspectDomainIdentifier(metadata, node)
    inspectDomainEnvironment(metadata, node)
  }
  if (ts.isCallExpression(node)) {
    const chain = propertyChain(node.expression)
    if (isDomain) inspectDomainCall(metadata, node, chain)
    inspectStorageCall(metadata, node, chain)
    inspectBrowserCall(metadata, node, chain)
    inspectFetchCall(metadata, node)
    inspectProjectionCall(metadata, node, chain)
  }
  inspectConstructor(metadata, node)
  ts.forEachChild(node, (child) => inspectNode(metadata, child))
}

function inspectSourceFile(metadata) {
  inspectNode(metadata, metadata.source)
}

function findCycles() {
  const visited = new Set()
  const active = new Set()
  const stack = []
  const reportedCycles = new Set()

  function visit(fileKey) {
    visited.add(fileKey)
    active.add(fileKey)
    stack.push(fileKey)

    for (const edge of graph.get(fileKey)) {
      if (active.has(edge.target)) {
        const start = stack.indexOf(edge.target)
        const cycle = [...stack.slice(start), edge.target]
        const cycleKey = cycle.slice(0, -1).sort().join("|")
        if (!reportedCycles.has(cycleKey)) {
          reportedCycles.add(cycleKey)
          const from = sourceFiles.get(fileKey)
          const cyclePaths = cycle.map(
            (key) => sourceFiles.get(key)?.relativePath ?? key
          )
          report(
            from,
            edge.node,
            `Internal import cycle: ${cyclePaths.join(" -> ")}`
          )
        }
      } else if (!visited.has(edge.target)) {
        visit(edge.target)
      }
    }

    stack.pop()
    active.delete(fileKey)
  }

  for (const fileKey of graph.keys()) {
    if (!visited.has(fileKey)) visit(fileKey)
  }
}

for (const productionRoot of productionRoots) {
  const directory = path.join(root, productionRoot)
  if (fs.existsSync(directory)) {
    for (const filePath of collectProductionFiles(directory))
      addSourceFile(filePath)
  }
}

for (const metadata of sourceFiles.values()) inspectSourceFile(metadata)
findCycles()

for (const obsoletePath of obsoleteProductionPaths) {
  if (fs.existsSync(path.join(root, obsoletePath))) {
    reportPath(obsoletePath, "Obsolete production path must remain deleted.")
  }
}

errors.sort((left, right) =>
  `${left.file}:${left.line}:${left.column}:${left.message}`.localeCompare(
    `${right.file}:${right.line}:${right.column}:${right.message}`
  )
)

if (errors.length > 0) {
  console.error("Architecture boundary violations:")
  for (const error of errors) {
    console.error(
      `- ${error.file}:${error.line}:${error.column} ${error.message}`
    )
  }
  process.exitCode = 1
} else {
  console.log(
    `Architecture boundaries OK (${sourceFiles.size} production files, ${internalImportCount} internal imports).`
  )
}
