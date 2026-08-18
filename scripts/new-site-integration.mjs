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
  --contributor <name>        Contributor name (defaults to git user.name or current user)
  --out-dir <dir>             Target output directory (defaults to src/site-integrations/<id>)
  --help, -h                  Show this help message
`)
}

function parseArgs(args) {
  let id = null
  let name = null
  let contributor = null
  let outDir = null

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

  return { id, name, contributor, outDir }
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

function main() {
  const rawArgs = process.argv.slice(2)
  if (rawArgs.length === 0) {
    printUsage()
    process.exit(1)
  }

  const {
    id,
    name: customName,
    contributor: customContributor,
    outDir,
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

  const targetDir = outDir
    ? path.resolve(root, outDir)
    : path.join(integrationsDir, id)
  if (fs.existsSync(targetDir)) {
    console.error(
      `Error: Target directory already exists: ${path.relative(root, targetDir)}`
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
    dynamicOrigins: [],
    sessionRefererRules: [],
    customSettings: [],
    fixtures: {
      paths: [`src/site-integrations/${id}/fixtures/contract.json`],
      liveFreshnessDays: 30,
    },
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

  const readmeMd = `# ${siteName}

## Approach

<!-- Describe how this site is handled: API vs HTML parsing, viewer format, auth requirements, etc. -->

- Background: <!-- e.g. HTML series resolution / API series resolution -->
- Offscreen: <!-- e.g. chapter image planning and download / tile descrambling -->
- Page probe: none <!-- or describe if required -->
- Dispatch context: none <!-- or schema version -->
- DNR: none <!-- or referer rules -->

## Endpoints

<!-- List declared endpoint IDs and their purpose -->
- \`${id}-series-page\`: Series metadata and chapter catalog

## States covered

<!-- Document how different content states are handled -->
- Free / readable chapters: <!-- supported -->
- Locked / paywalled chapters: <!-- skipped or handled -->
- Unavailable / deleted series: <!-- error handling -->

## Live smoke

<!-- Notes on live verification, test URLs, and freshness cadence -->
- Freshness cadence: 30 days
`

  // Create directories
  fs.mkdirSync(path.join(targetDir, "contracts"), { recursive: true })
  fs.mkdirSync(path.join(targetDir, "fixtures"), { recursive: true })

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
    path.join(targetDir, "fixtures/contract.json"),
    JSON.stringify(fixtureJson, null, 2) + "\n"
  )
  fs.writeFileSync(path.join(targetDir, "README.md"), readmeMd)

  const displayTarget = path.relative(root, targetDir).replaceAll(path.sep, "/")
  console.log(
    `Successfully created site integration scaffold at ${displayTarget}/`
  )
  console.log(`
Created files:
  - ${displayTarget}/definition.json
  - ${displayTarget}/background-runtime.ts
  - ${displayTarget}/offscreen-runtime.ts
  - ${displayTarget}/contracts/index.ts
  - ${displayTarget}/fixtures/contract.json
  - ${displayTarget}/README.md

Next steps:
  1. Configure patterns, origins, and endpoint policies in ${displayTarget}/definition.json
  2. Implement series resolution in ${displayTarget}/background-runtime.ts
  3. Implement chapter planning and image downloading in ${displayTarget}/offscreen-runtime.ts
  4. Record deterministic test fixtures in ${displayTarget}/fixtures/contract.json
  5. Fill in the README.md sections (Approach, Endpoints, States covered, Live smoke)
  6. When implementation and fixtures are complete, set "shipped": true in ${displayTarget}/definition.json
  7. Re-run "pnpm generate:site-integrations && pnpm test:unit" to compile the new integration into runtime registries and verify all tests pass
`)
}

main()
