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
  --id <id>           Unique lowercase identifier (alternative to positional argument)
  --name <name>       Human-readable site name (e.g. "Example Manga")
  --author <author>   Author name (defaults to git user.name or current user)
  --help, -h          Show this help message
`)
}

function parseArgs(args) {
  let id = null
  let name = null
  let author = null

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
    } else if (arg === "--author") {
      if (i + 1 >= args.length || args[i + 1].startsWith("-")) {
        console.error("Error: Missing value for --author option.")
        process.exit(1)
      }
      author = args[++i]
    } else if (arg.startsWith("--author=")) {
      author = arg.slice(9)
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

  return { id, name, author }
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

  const { id, name: customName, author: customAuthor } = parseArgs(rawArgs)

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

  const targetDir = path.join(integrationsDir, id)
  if (fs.existsSync(targetDir)) {
    console.error(
      `Error: Site integration directory already exists: src/site-integrations/${id}`
    )
    process.exit(1)
  }

  const siteName = customName || toTitleCase(id)
  const authorName = customAuthor || getGitUser()
  const pascalId = toPascalCase(id)

  const definitionJson = {
    schemaVersion: 1,
    id,
    name: siteName,
    author: authorName,
    version: "0.1.0",
    maturity: "experimental",
    shipped: false,
    enabledByDefault: false,
    implementationType: "dom-scraping",
    volatility: "medium",
    authentication: "anonymous",
    regions: ["global"],
    accountConstraints: [],
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

  console.log(
    `Successfully created site integration scaffold at src/site-integrations/${id}/`
  )
  console.log(`
Created files:
  - src/site-integrations/${id}/definition.json
  - src/site-integrations/${id}/background-runtime.ts
  - src/site-integrations/${id}/offscreen-runtime.ts
  - src/site-integrations/${id}/contracts/index.ts
  - src/site-integrations/${id}/fixtures/contract.json
  - src/site-integrations/${id}/README.md

Next steps:
  1. Configure patterns, origins, and endpoint policies in src/site-integrations/${id}/definition.json
  2. Implement series resolution in src/site-integrations/${id}/background-runtime.ts
  3. Implement chapter planning and image downloading in src/site-integrations/${id}/offscreen-runtime.ts
  4. Record deterministic test fixtures in src/site-integrations/${id}/fixtures/contract.json
  5. Fill in the README.md sections (Approach, Endpoints, States covered, Live smoke)
  6. When implementation and fixtures are complete, set "shipped": true in src/site-integrations/${id}/definition.json
  7. Re-run "pnpm generate:site-integrations && pnpm test:unit" to compile the new integration into runtime registries and verify all tests pass
`)
}

main()
