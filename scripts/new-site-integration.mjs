import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import { execSync } from "node:child_process"

const root = process.cwd()
const integrationsDir = path.join(root, "src/site-integrations")

function printUsage() {
  console.log(`
Usage: pnpm new:site-integration <id> [options]

Arguments:
  <id>                Unique lowercase identifier (e.g. mangadex, pixiv-comic)

Options:
  --id <id>                   Unique lowercase identifier (alternative to positional argument)
  --name <name>               Human-readable site name (e.g. "Example Manga")
  --english-name <name>       English site name (defaults to the title-cased identifier)
  --contributor <name>        Contributor name (defaults to git user.name or current user)
  --out-dir <dir>             Source output directory (defaults to src/site-integrations/<id>)
  --fixtures-dir <dir>        Test fixture directory (defaults to tests/fixtures/site-integrations/<id>)
  --help, -h                  Show this help message
`)
}

const argumentOptions = new Map([
  ["--id", { key: "id" }],
  ["--name", { key: "name" }],
  ["--english-name", { key: "englishName" }],
  ["--contributor", { key: "contributor", name: "--contributor" }],
  ["--contributors", { key: "contributor", name: "--contributor" }],
  ["--out-dir", { key: "outDir" }],
  ["--fixtures-dir", { key: "fixturesDir" }],
])

function argumentError(message, showUsage = false) {
  console.error(`Error: ${message}`)
  if (showUsage) printUsage()
  process.exit(1)
}

function readOptionValue(args, index, option) {
  const arg = args[index]
  const equals = arg.indexOf("=")
  if (equals !== -1) {
    return {
      value:
        option.key === "contributor"
          ? arg.split("=")[1]
          : arg.slice(equals + 1),
      consumed: 0,
    }
  }
  if (index + 1 >= args.length || args[index + 1].startsWith("-")) {
    argumentError(`Missing value for ${option.name ?? arg} option.`)
  }
  return { value: args[index + 1], consumed: 1 }
}

function parseArgs(args) {
  const values = {
    id: null,
    name: null,
    englishName: null,
    contributor: null,
    outDir: null,
    fixturesDir: null,
  }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === "--help" || arg === "-h") {
      printUsage()
      process.exit(0)
    }
    const option = argumentOptions.get(arg.split("=")[0])
    if (option) {
      const { value, consumed } = readOptionValue(args, i, option)
      values[option.key] = value
      i += consumed
    } else if (arg.startsWith("-")) {
      argumentError(`Unknown option "${arg}".`, true)
    } else {
      if (values.id) argumentError(`Unexpected argument "${arg}".`, true)
      values.id = arg
    }
  }
  return values
}

function getGitUser() {
  try {
    const gitUser = execSync("git config user.name", {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    }).trim()
    if (gitUser) return gitUser
  } catch {
    // Ignore git error
  }
  return process.env.USER || process.env.USERNAME || "Contributor"
}

function capitalizeIdentifier(str, separator) {
  return str
    .split(/[-_]/)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(separator)
}

function resolveNewDirectory(directory) {
  let ancestor = directory
  const missingSegments = []
  while (true) {
    try {
      fs.lstatSync(ancestor)
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error
      const parent = path.dirname(ancestor)
      if (parent === ancestor) throw error
      missingSegments.push(path.basename(ancestor))
      ancestor = parent
      continue
    }
    if (missingSegments.length === 0) {
      throw new Error(
        `Target directory already exists: ${path.relative(root, directory)}`
      )
    }
    const resolvedAncestor = fs.realpathSync(ancestor)
    if (!fs.statSync(resolvedAncestor).isDirectory()) {
      throw new Error(
        `Output ancestor is not a directory: ${path.relative(root, ancestor)}`
      )
    }
    return path.join(resolvedAncestor, ...missingSegments.reverse())
  }
}

function claimOutputDirectory(directory, createdDirectories) {
  const missingParents = []
  let parent = path.dirname(directory)
  while (!fs.existsSync(parent)) {
    missingParents.push(parent)
    parent = path.dirname(parent)
  }
  for (const missingParent of missingParents.reverse()) {
    try {
      fs.mkdirSync(missingParent)
      createdDirectories.push(missingParent)
    } catch (error) {
      if (error.code !== "EEXIST" || !fs.statSync(missingParent).isDirectory())
        throw error
    }
  }
  fs.mkdirSync(directory)
  createdDirectories.push(directory)
  return fs.realpathSync(directory)
}

function directoryContains(parent, child) {
  const owner = fs.statSync(parent, { bigint: true })
  let current = child
  while (true) {
    const candidate = fs.statSync(current, { bigint: true })
    if (owner.dev === candidate.dev && owner.ino === candidate.ino) return true
    const next = path.dirname(current)
    if (next === current) return false
    current = next
  }
}

function readScaffoldOptions(rawArgs) {
  if (rawArgs.length === 0) {
    printUsage()
    process.exit(1)
  }
  const options = parseArgs(rawArgs)
  if (!options.id) {
    argumentError("Missing required site integration <id>.", true)
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(options.id)) {
    argumentError(
      `Invalid site integration id "${options.id}". Must match pattern ^[a-z0-9][a-z0-9-]*$`
    )
  }
  return options
}

function pathContains(parent, child) {
  const relative = path.relative(parent, child)
  return (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`))
  )
}

function assertSeparateOutputs(directories, contains) {
  if (
    contains(directories.targetDir, directories.targetFixturesDir) ||
    contains(directories.targetFixturesDir, directories.targetDir)
  ) {
    throw new Error("Source and fixture output directories must be separate.")
  }
}

function planOutputDirectories({ id, outDir, fixturesDir }) {
  const directories = {
    targetDir: resolveNewDirectory(
      outDir ? path.resolve(root, outDir) : path.join(integrationsDir, id)
    ),
    targetFixturesDir: resolveNewDirectory(
      fixturesDir
        ? path.resolve(root, fixturesDir)
        : path.join(root, "tests/fixtures/site-integrations", id)
    ),
  }
  assertSeparateOutputs(directories, pathContains)
  return directories
}

function scaffoldContents({
  id,
  name,
  englishName: customEnglishName,
  contributor,
}) {
  const siteName = name || capitalizeIdentifier(id, " ")
  const englishName = customEnglishName || capitalizeIdentifier(id, " ")
  const contributorName = contributor || getGitUser()
  const pascalId = capitalizeIdentifier(id, "")
  const definitionJson = {
    schemaVersion: 1,
    id,
    name: siteName,
    englishName,
    contributors: [contributorName],
    version: "0.1.0",
    shipped: false,
    enabledByDefault: false,
    patterns: {
      domains: [`${id}.example.com`],
      seriesMatches: ["/series/*"],
      excludeMatches: [],
    },
    requiredOrigins: [`https://${id}.example.com/*`],
    optionalOrigins: [],
    policyDefaults: {
      image: { concurrency: 2, delayMs: 500 },
      chapter: { concurrency: 1, delayMs: 1000 },
    },
    retryOwner: "platform",
    pageProbe: "none",
    runtimes: {
      background: true,
      offscreen: true,
      dispatchContext: { mode: "none" },
    },
    imageTransform: {
      kind: "none",
      estimatedCostMs: 0,
    },
    endpointPolicies: [
      {
        id: `${id}-series-page`,
        purpose: `${siteName} series page and chapter catalog`,
        origins: [`https://${id}.example.com/*`],
        originKind: "fixed",
        credentials: "omit",
        redirect: "error",
        responseType: "html",
        maxResponseBytes: 10000000,
      },
    ],
    sessionRefererRules: [],
    customSettings: [],
  }

  const backgroundRuntimeTs = `import type {
  BackgroundSiteAdapter,
  SeriesDataResolutionInput,
  SeriesDataResolutionResult,
  ServiceWorkerIntegration,
} from "@/src/types/site-integrations"
import { ProviderContractError } from "@/src/site-integrations/provider-contract-error"

function resolveSeriesData(
  input: SeriesDataResolutionInput
): Promise<SeriesDataResolutionResult> {
  // TODO: Implement background series data resolution
  void input
  return Promise.reject(new ProviderContractError("not implemented"))
}

const background: ServiceWorkerIntegration = {
  name: "${siteName} Background",
  series: {
    resolveSeriesData,
  },
}

export const backgroundSiteAdapter: BackgroundSiteAdapter = {
  id: "${id}",
  background,
}
`

  const offscreenRuntimeTs = `import type {
  OffscreenIntegration,
  OffscreenSiteAdapter,
} from "@/src/types/site-integrations"
import type { ChapterImagePlan } from "@/src/site-integrations/chapter-plan"
import { ProviderContractError } from "@/src/site-integrations/provider-contract-error"

const offscreen: OffscreenIntegration = {
  name: "${siteName} Offscreen",
  chapter: {
    resolveChapterPlan(): Promise<ChapterImagePlan> {
      // TODO: Implement chapter image plan resolution
      return Promise.reject(new ProviderContractError("not implemented"))
    },
    downloadImage(): Promise<{
      data: ArrayBuffer
      filename: string
      mimeType: string
    }> {
      // TODO: Implement chapter image downloading
      return Promise.reject(new ProviderContractError("not implemented"))
    },
  },
}

export const offscreenSiteAdapter: OffscreenSiteAdapter = {
  id: "${id}",
  offscreen,
}
`

  const contractsTs = `// Provider contract definitions for ${siteName}
export type ${pascalId}Contract = Record<string, unknown>
`

  const fixtureJson = {
    schemaVersion: 1,
    providerId: id,
    data: {},
  }

  return {
    definitionJson,
    backgroundRuntimeTs,
    offscreenRuntimeTs,
    contractsTs,
    fixtureJson,
  }
}

function cleanupOutputDirectories(createdDirectories) {
  for (const directory of createdDirectories.reverse()) {
    try {
      fs.rmdirSync(directory)
    } catch (error) {
      if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code)) {
        console.error(
          `Unable to remove empty output directory ${directory}: ${error.message}`
        )
      }
    }
  }
}

function claimScaffoldDirectories(directories) {
  const createdDirectories = []
  try {
    const claimed = {
      targetDir: claimOutputDirectory(
        directories.targetDir,
        createdDirectories
      ),
      targetFixturesDir: claimOutputDirectory(
        directories.targetFixturesDir,
        createdDirectories
      ),
    }
    assertSeparateOutputs(claimed, directoryContains)
    return claimed
  } catch (error) {
    cleanupOutputDirectories(createdDirectories)
    throw error
  }
}

function writeScaffold({ targetDir, targetFixturesDir }, contents) {
  const {
    definitionJson,
    backgroundRuntimeTs,
    offscreenRuntimeTs,
    contractsTs,
    fixtureJson,
  } = contents
  fs.mkdirSync(path.join(targetDir, "contracts"), { recursive: true })

  // Write files
  fs.writeFileSync(
    path.join(targetDir, "definition.json"),
    JSON.stringify(definitionJson, null, 2) + "\n"
  )
  fs.writeFileSync(
    path.join(targetDir, "background-runtime.ts"),
    backgroundRuntimeTs
  )
  fs.writeFileSync(
    path.join(targetDir, "offscreen-runtime.ts"),
    offscreenRuntimeTs
  )
  fs.writeFileSync(path.join(targetDir, "contracts/index.ts"), contractsTs)
  fs.writeFileSync(
    path.join(targetFixturesDir, "contract.json"),
    JSON.stringify(fixtureJson, null, 2) + "\n"
  )
}

function reportScaffold({ targetDir, targetFixturesDir }) {
  const displayTarget = path.relative(root, targetDir).replaceAll(path.sep, "/")
  const displayFixtures = path
    .relative(root, targetFixturesDir)
    .replaceAll(path.sep, "/")
  console.log(
    `Successfully created site integration scaffold at ${displayTarget}/`
  )
  console.log(`
Created files:
  - ${displayTarget}/definition.json
  - ${displayTarget}/background-runtime.ts
  - ${displayTarget}/offscreen-runtime.ts
  - ${displayTarget}/contracts/index.ts
  - ${displayFixtures}/contract.json

Next steps:
  1. Configure patterns, origins, and endpoint policies in ${displayTarget}/definition.json
  2. Implement series resolution in ${displayTarget}/background-runtime.ts
  3. Implement chapter planning and image downloading in ${displayTarget}/offscreen-runtime.ts
  4. Record deterministic test fixtures in ${displayFixtures}/contract.json
  5. Add contributor notes in ${displayTarget}/README.md when site-specific behavior needs explanation
  6. When implementation and fixtures are complete, set "shipped": true in ${displayTarget}/definition.json
  7. Re-run "pnpm generate:site-integrations && pnpm test:unit" to compile the new integration into runtime registries and verify all tests pass
`)
}

function main() {
  const options = readScaffoldOptions(process.argv.slice(2))
  let directories
  try {
    directories = planOutputDirectories(options)
  } catch (error) {
    argumentError(error.message)
  }
  const contents = scaffoldContents(options)
  try {
    directories = claimScaffoldDirectories(directories)
  } catch (error) {
    argumentError(error.message)
  }
  writeScaffold(directories, contents)
  reportScaffold(directories)
}

main()
