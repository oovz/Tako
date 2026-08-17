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
  "DestinationIssueRepository",
  "RateLimitService",
])
const projectionFunctions = new Set(["projectToQueueView", "updateActionBadge"])
const allowedSetEnablementMapFiles = new Set([
  "entrypoints/background/background-runtime-kernel.ts",
  "src/runtime/site-integration-initialization.ts",
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

function resolveImport(fromFile, specifier) {
  let candidate
  if (specifier === "@") {
    candidate = root
  } else if (specifier.startsWith("@/")) {
    candidate = path.join(root, specifier.slice(2))
  } else if (specifier.startsWith(".")) {
    candidate = path.resolve(path.dirname(fromFile), specifier)
  } else {
    return undefined
  }

  const candidates = [candidate]
  const extension = path.extname(candidate)
  if (extension === ".js" || extension === ".jsx" || extension === ".mjs") {
    candidates.push(candidate.slice(0, -extension.length) + ".ts")
    candidates.push(candidate.slice(0, -extension.length) + ".tsx")
  }
  if (!extension) {
    candidates.push(`${candidate}.ts`)
    candidates.push(`${candidate}.tsx`)
  }
  candidates.push(path.join(candidate, "index.ts"))
  candidates.push(path.join(candidate, "index.tsx"))

  for (const possiblePath of candidates) {
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

function inspectSourceFile(metadata) {
  const { source, relativePath } = metadata
  const isDomain = relativePath.startsWith("src/domain/")
  const allowedDirectMessageFile =
    relativePath === "src/runtime/send-runtime-message.ts"
  const allowedDownloadsFile =
    relativePath === "entrypoints/background/native-output-coordinator.ts"
  const allowedFetchFiles = new Set([
    "src/site-integrations/http-client.ts",
    "src/runtime/i18n.ts",
  ])
  const allowedConstructorFile = "entrypoints/background/index.ts"
  const allowedProjectionFile = "src/storage/queue-projection-service.ts"

  function recordModuleReference(node, specifier) {
    addGraphEdge(metadata, node, specifier)
    if (!isDomain) return

    const imported = resolveImport(metadata.absolutePath, specifier)
    if (
      imported &&
      [
        "src/storage/",
        "src/runtime/",
        "src/site-integrations/",
        "entrypoints/",
        "components/",
      ].some((prefix) => imported.relativePath.startsWith(prefix))
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

  function visit(node) {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      recordModuleReference(node.moduleSpecifier, node.moduleSpecifier.text)
    }

    if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      if (ts.isStringLiteral(node.moduleSpecifier)) {
        recordModuleReference(node.moduleSpecifier, node.moduleSpecifier.text)
      }
    }

    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      recordModuleReference(
        node.moduleReference,
        node.moduleReference.expression.text
      )
    }

    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length >= 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      recordModuleReference(node.arguments[0], node.arguments[0].text)
    }

    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      recordModuleReference(node.argument.literal, node.argument.literal.text)
    }

    if (isDomain) {
      if (
        ts.isIdentifier(node) &&
        domainAmbientNames.has(node.text) &&
        !isImportSyntax(node)
      ) {
        report(
          metadata,
          node,
          `Domain code must not use ambient ${node.text}; inject this dependency instead.`
        )
      }

      if (
        ts.isIdentifier(node) &&
        node.text === "logger" &&
        !isImportSyntax(node)
      ) {
        report(metadata, node, "Domain code must not use the runtime logger.")
      }

      if (
        ts.isPropertyAccessExpression(node) &&
        node.name.text === "env" &&
        ts.isMetaProperty(node.expression) &&
        node.expression.keywordToken === ts.SyntaxKind.ImportKeyword
      ) {
        report(metadata, node, "Domain code must not read import.meta.env.")
      }

      if (
        ts.isCallExpression(node) &&
        (JSON.stringify(propertyChain(node.expression)) ===
          JSON.stringify(["Date", "now"]) ||
          JSON.stringify(propertyChain(node.expression)) ===
            JSON.stringify(["Math", "random"]) ||
          JSON.stringify(propertyChain(node.expression)) ===
            JSON.stringify(["performance", "now"]))
      ) {
        report(
          metadata,
          node,
          "Domain code must not use ambient Date.now(), Math.random(), or performance.now()."
        )
      }

      if (
        ts.isCallExpression(node) &&
        (JSON.stringify(propertyChain(node.expression)) ===
          JSON.stringify(["crypto", "randomUUID"]) ||
          JSON.stringify(propertyChain(node.expression)) ===
            JSON.stringify(["crypto", "getRandomValues"]))
      ) {
        report(
          metadata,
          node,
          "Domain code must not use ambient crypto randomness."
        )
      }
    }

    if (ts.isCallExpression(node)) {
      const chain = propertyChain(node.expression)
      if (
        JSON.stringify(chain) ===
        JSON.stringify(["chrome", "runtime", "sendMessage"])
      ) {
        if (!allowedDirectMessageFile) {
          report(
            metadata,
            node,
            "Direct chrome.runtime.sendMessage calls belong only in src/runtime/send-runtime-message.ts."
          )
        }
      }

      if (
        (JSON.stringify(chain) ===
          JSON.stringify(["chrome", "downloads", "download"]) ||
          JSON.stringify(chain) ===
            JSON.stringify(["chrome", "downloads", "search"])) &&
        !allowedDownloadsFile
      ) {
        report(
          metadata,
          node,
          "chrome.downloads.download/search calls belong only in entrypoints/background/native-output-coordinator.ts."
        )
      }

      if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === "fetch" &&
        !allowedFetchFiles.has(relativePath)
      ) {
        report(
          metadata,
          node,
          "Raw fetch() calls belong only in src/site-integrations/http-client.ts or src/runtime/i18n.ts."
        )
      }

      const calledName = chain?.at(-1)
      if (
        calledName &&
        projectionFunctions.has(calledName) &&
        relativePath !== allowedProjectionFile
      ) {
        report(
          metadata,
          node,
          `${calledName} calls belong only in ${allowedProjectionFile}.`
        )
      }
      if (
        calledName === "setEnablementMap" &&
        !allowedSetEnablementMapFiles.has(relativePath)
      ) {
        report(
          metadata,
          node,
          "setEnablementMap() calls belong only in runtime initialization modules (entrypoints/background/background-runtime-kernel.ts, src/runtime/site-integration-initialization.ts) and E2E state seed (entrypoints/background/e2e-state-seed.ts)."
        )
      }
    }

    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      constructorOwners.has(node.expression.text)
    ) {
      const constructorName = node.expression.text
      const allowed =
        relativePath === allowedConstructorFile ||
        (constructorName === "RateLimitService" &&
          relativePath === "entrypoints/offscreen/main.ts")
      if (!allowed) {
        report(
          metadata,
          node,
          `Only ${allowedConstructorFile}${
            constructorName === "RateLimitService"
              ? " (and entrypoints/offscreen/main.ts for RateLimitService)"
              : ""
          } may construct ${constructorName}.`
        )
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(source)
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
