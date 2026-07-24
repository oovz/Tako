#!/usr/bin/env node
/**
 * merge-coverage.mjs
 *
 * Merges Istanbul coverage data from two sources:
 *   1. Vitest unit + integration coverage  → coverage/coverage-final.json
 *   2. Playwright E2E coverage             → .nyc_output/e2e/coverage-*.json
 *
 * The merged output is written to .nyc_output/merged/coverage-final.json and
 * then reported via `nyc report` (text summary + lcov for CI tooling).
 *
 * Usage:
 *   node scripts/merge-coverage.mjs
 *
 * Prerequisites:
 *   - Run `pnpm test:coverage` first to produce coverage/coverage-final.json
 *   - Run `E2E_COVERAGE=true pnpm test:e2e` first to populate .nyc_output/e2e/
 *   - nyc must be available: pnpm add -D nyc  (or use npx nyc)
 */

import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { existsSync } from "node:fs"
import { mergeCoverageMaps } from "./coverage-map.mjs"
import { assertCompleteCoverageInputs } from "./coverage-input-policy.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")

const VITEST_COVERAGE_JSON = path.join(ROOT, "coverage", "coverage-final.json")
const E2E_COVERAGE_DIR = path.join(ROOT, ".nyc_output", "e2e")
const MERGED_DIR = path.join(ROOT, ".nyc_output", "merged")
const MERGED_FINAL = path.join(MERGED_DIR, "coverage-final.json")

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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("[merge-coverage] Starting coverage merge...")

  // 1. Load Vitest coverage
  const vitestCoverage = await loadJson(VITEST_COVERAGE_JSON)
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

  assertCompleteCoverageInputs({
    hasVitestCoverage: vitestCoverage !== null,
    e2ePageCoverageFileCount: e2ePageFiles.length,
    e2eWorkerCoverageFileCount: e2eWorkerFiles.length,
  })

  console.log(
    `[merge-coverage] Vitest source:  ${vitestCoverage ? VITEST_COVERAGE_JSON : "(missing)"}`
  )
  console.log(
    `[merge-coverage] E2E files:       ${e2eFiles.length} file(s) in ${E2E_COVERAGE_DIR}`
  )
  console.log(
    `[merge-coverage] E2E contexts:    ${e2ePageFiles.length} page, ${e2eWorkerFiles.length} worker coverage file(s)`
  )

  // 3. Canonicalize paths and merge by source locations. Istanbul numeric IDs
  // are local to each instrumentation pass and cannot be summed directly.
  const coverageMaps = vitestCoverage ? [vitestCoverage] : []

  for (const file of e2eFiles) {
    const e2eCoverage = await loadJson(path.join(E2E_COVERAGE_DIR, file))
    if (e2eCoverage) {
      coverageMaps.push(e2eCoverage)
    }
  }

  const merged = mergeCoverageMaps(coverageMaps, ROOT)

  const totalFiles = Object.keys(merged).length
  console.log(`[merge-coverage] Merged coverage: ${totalFiles} file(s) tracked`)

  if (totalFiles === 0) {
    console.error("[merge-coverage] No coverage data to merge. Aborting.")
    process.exit(1)
  }

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

main().catch((err) => {
  console.error("[merge-coverage] Fatal error:", err)
  process.exit(1)
})
