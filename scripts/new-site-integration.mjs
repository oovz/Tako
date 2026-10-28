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

function parseArgs(args) {
  let id = null
  let name = null
  let englishName = null
  let contributor = null
  let outDir = null
  let fixturesDir = null

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === "--help" || arg === "-h") {
      printUsage()
      process.exit(0)
    } else if (arg === "--id") {
      if (i + 1 >= args.length || args[i + 1].startsWith("-")) {
        console.error("Error: Missing value for --id option.")
        process.exit(1)
      }
      id = args[++i]
    } else if (arg.startsWith("--id=")) {
      id = arg.slice(5)
    } else if (arg === "--name") {
      if (i + 1 >= args.length || args[i + 1].startsWith("-")) {
        console.error("Error: Missing value for --name option.")
        process.exit(1)
      }
      name = args[++i]
    } else if (arg.startsWith("--name=")) {
      name = arg.slice(7)
    } else if (arg === "--english-name") {
      if (i + 1 >= args.length || args[i + 1].startsWith("-")) {
        console.error("Error: Missing value for --english-name option.")
        process.exit(1)
      }
      englishName = args[++i]
    } else if (arg.startsWith("--english-name=")) {
      englishName = arg.slice(15)
    } else if (arg === "--contributor" || arg === "--contributors") {
      if (i + 1 >= args.length || args[i + 1].startsWith("-")) {
        console.error("Error: Missing value for --contributor option.")
        process.exit(1)
      }
      contributor = args[++i]
    } else if (
      arg.startsWith("--contributor=") ||
      arg.startsWith("--contributors=")
    ) {
      contributor = arg.split("=")[1]
    } else if (arg === "--out-dir") {
      if (i + 1 >= args.length || args[i + 1].startsWith("-")) {
        console.error("Error: Missing value for --out-dir option.")
        process.exit(1)
      }
      outDir = args[++i]
    } else if (arg.startsWith("--out-dir=")) {
      outDir = arg.slice(10)
    } else if (arg === "--fixtures-dir") {
      if (i + 1 >= args.length || args[i + 1].startsWith("-")) {
        console.error("Error: Missing value for --fixtures-dir option.")
        process.exit(1)
      }
      fixturesDir = args[++i]
    } else if (arg.startsWith("--fixtures-dir=")) {
      fixturesDir = arg.slice(15)
    } else if (arg.startsWith("-")) {
      console.error(`Error: Unknown option "${arg}".`)
      printUsage()
      process.exit(1)
    } else {
      if (id) {
        console.error(`Error: Unexpected argument "${arg}".`)
        printUsage()
        process.exit(1)
      }
      id = arg
    }
  }

  return { id, name, englishName, contributor, outDir, fixturesDir }
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

function toPascalCase(str) {
  return str
    .split(/[-_]/)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join("")
}

function toTitleCase(str) {
  return str
    .split(/[-_]/)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ")
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

function main() {
  const rawArgs = process.argv.slice(2)
  if (rawArgs.length === 0) {
    printUsage()
    process.exit(1)
  }

  const {
    id,
    name: customName,
    englishName: customEnglishName,
    contributor: customContributor,
    outDir,
    fixturesDir,
  } = parseArgs(rawArgs)

  if (!id) {
    console.error("Error: Missing required site integration <id>.")
    printUsage()
    process.exit(1)
  }

  const idPattern = /^[a-z0-9][a-z0-9-]*$/
  if (!idPattern.test(id)) {
    console.error(
      `Error: Invalid site integration id "${id}". Must match pattern ^[a-z0-9][a-z0-9-]*$`
    )
    process.exit(1)
  }

  let targetDir
  let targetFixturesDir
  try {
    targetDir = resolveNewDirectory(
      outDir ? path.resolve(root, outDir) : path.join(integrationsDir, id)
    )
    targetFixturesDir = resolveNewDirectory(
      fixturesDir
        ? path.resolve(root, fixturesDir)
        : path.join(root, "tests/fixtures/site-integrations", id)
    )
  } catch (error) {
    console.error(`Error: ${error.message}`)
    process.exit(1)
  }
  const sourceToFixtures = path.relative(targetDir, targetFixturesDir)
  const fixturesToSource = path.relative(targetFixturesDir, targetDir)
  const overlaps = [sourceToFixtures, fixturesToSource].some(
    (relative) =>
      relative === "" ||
      (!path.isAbsolute(relative) &&
        relative !== ".." &&
        !relative.startsWith(`..${path.sep}`))
  )
  if (overlaps) {
    console.error(
      "Error: Source and fixture output directories must be separate."
    )
    process.exit(1)
  }

  const siteName = customName || toTitleCase(id)
  const contributorName = customContributor || getGitUser()
  const pascalId = toPascalCase(id)

  const definitionJson = {
    schemaVersion: 1,
    id,
    name: siteName,
    englishName: customEnglishName || toTitleCase(id),
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

  const createdDirectories = []
  try {
    targetDir = claimOutputDirectory(targetDir, createdDirectories)
    targetFixturesDir = claimOutputDirectory(
      targetFixturesDir,
      createdDirectories
    )
    if (
      directoryContains(targetDir, targetFixturesDir) ||
      directoryContains(targetFixturesDir, targetDir)
    ) {
      throw new Error("Source and fixture output directories must be separate.")
    }
  } catch (error) {
    for (const directory of createdDirectories.reverse()) {
      try {
        fs.rmdirSync(directory)
      } catch (cleanupError) {
        if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(cleanupError.code)) {
          console.error(
            `Unable to remove empty output directory ${directory}: ${cleanupError.message}`
          )
        }
      }
    }
    console.error(`Error: ${error.message}`)
    process.exit(1)
  }

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

main()
