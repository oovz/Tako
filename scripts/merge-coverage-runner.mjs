import fs from "node:fs/promises"
import path from "node:path"
import { existsSync } from "node:fs"
import {
  canonicalizeCoverageMap,
  hasCoverageLocations,
  mergeCoverageMaps,
} from "./coverage-map.mjs"
import { assertCompleteCoverageInputs } from "./coverage-input-policy.mjs"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Load and parse a JSON file. Returns null if the file does not exist.
 *
 * @param {string} filePath
 * @returns {Promise<object|null>}
 */
async function loadJson(filePath) {
  if (!existsSync(filePath)) return null
  const raw = await fs.readFile(filePath, "utf8")
  return JSON.parse(raw)
}

async function selectNativeCoverage(v8Coverage, runtimeCoverage, rootPath) {
  const v8 = await canonicalizeCoverageMap(v8Coverage, rootPath)
  const runtime = await canonicalizeCoverageMap(runtimeCoverage, rootPath)
  const fallback = Object.fromEntries(
    Object.entries(v8).filter(([file]) => !Object.hasOwn(runtime, file))
  )
  return {
    maps: [fallback, runtime],
    hasVitestCoverage: hasCoverageLocations(v8),
    hasRuntimeCoverage: hasCoverageLocations(runtime),
  }
}

async function* readCoverageSources(
  nativeMaps,
  rootPath,
  e2eDirectory,
  e2eFiles,
  usableBrowserInputs
) {
  yield* nativeMaps
  for (const file of e2eFiles) {
    const coverage = await loadJson(path.join(e2eDirectory, file))
    const original = await canonicalizeCoverageMap(coverage, rootPath)
    if (hasCoverageLocations(original)) {
      if (file.startsWith("coverage-page-"))
        usableBrowserInputs.e2ePageCoverageFileCount += 1
      if (file.startsWith("coverage-worker-"))
        usableBrowserInputs.e2eWorkerCoverageFileCount += 1
    }
    yield original
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function mergeCoverageReports(ROOT) {
  const VITEST_COVERAGE_JSON = path.join(
    ROOT,
    "coverage",
    "coverage-final.json"
  )
  const RUNTIME_COVERAGE_JSON = path.join(
    ROOT,
    "coverage",
    "runtime",
    "coverage-final.json"
  )
  const E2E_COVERAGE_DIR = path.join(ROOT, ".nyc_output", "e2e")
  const MERGED_DIR = path.join(ROOT, ".nyc_output", "merged")
  const MERGED_FINAL = path.join(MERGED_DIR, "coverage-final.json")
  console.log("[merge-coverage] Starting coverage merge...")

  // 1. Load both native coverage profiles.
  const vitestCoverage = await loadJson(VITEST_COVERAGE_JSON)
  const runtimeCoverage = await loadJson(RUNTIME_COVERAGE_JSON)
  // 2. Load E2E coverage files
  let e2eFiles = []
  if (existsSync(E2E_COVERAGE_DIR)) {
    const entries = await fs.readdir(E2E_COVERAGE_DIR)
    e2eFiles = entries.filter((f) => f.endsWith(".json"))
  }
  const e2ePageFiles = e2eFiles.filter((file) =>
    file.startsWith("coverage-page-")
  )
  const e2eWorkerFiles = e2eFiles.filter((file) =>
    file.startsWith("coverage-worker-")
  )

  const native = await selectNativeCoverage(
    vitestCoverage,
    runtimeCoverage,
    ROOT
  )
  const coverageInputs = {
    hasVitestCoverage: native.hasVitestCoverage,
    hasRuntimeCoverage: native.hasRuntimeCoverage,
    e2ePageCoverageFileCount: e2ePageFiles.length,
    e2eWorkerCoverageFileCount: e2eWorkerFiles.length,
  }
  assertCompleteCoverageInputs(coverageInputs)

  console.log(
    `[merge-coverage] Vitest source:  ${vitestCoverage ? VITEST_COVERAGE_JSON : "(missing)"}`
  )
  console.log(`[merge-coverage] Runtime source: ${RUNTIME_COVERAGE_JSON}`)
  console.log(
    `[merge-coverage] E2E files:       ${e2eFiles.length} file(s) in ${E2E_COVERAGE_DIR}`
  )
  console.log(
    `[merge-coverage] E2E contexts:    ${e2ePageFiles.length} page, ${e2eWorkerFiles.length} worker coverage file(s)`
  )

  // 3. Remap each input to original sources, then merge by source locations.
  // Istanbul numeric IDs are local to each instrumentation pass.
  const usableBrowserInputs = {
    e2ePageCoverageFileCount: 0,
    e2eWorkerCoverageFileCount: 0,
  }
  const merged = await mergeCoverageMaps(
    readCoverageSources(
      native.maps,
      ROOT,
      E2E_COVERAGE_DIR,
      e2eFiles,
      usableBrowserInputs
    ),
    ROOT
  )
  assertCompleteCoverageInputs({ ...coverageInputs, ...usableBrowserInputs })

  const totalFiles = Object.keys(merged).length
  console.log(`[merge-coverage] Merged coverage: ${totalFiles} file(s) tracked`)

  // 4. Write merged output
  await fs.mkdir(MERGED_DIR, { recursive: true })
  await fs.writeFile(MERGED_FINAL, JSON.stringify(merged, null, 2), "utf8")
  console.log(`[merge-coverage] Wrote merged coverage to ${MERGED_FINAL}`)

  // 5. Also write it where nyc expects it by default (.nyc_output/coverage-final.json)
  const nycRoot = path.join(ROOT, ".nyc_output")
  await fs.mkdir(nycRoot, { recursive: true })
  await fs.writeFile(
    path.join(nycRoot, "coverage-final.json"),
    JSON.stringify(merged, null, 2),
    "utf8"
  )

  console.log(
    "[merge-coverage] Done. Run `pnpm coverage:report` to generate the HTML/LCOV report."
  )
}
