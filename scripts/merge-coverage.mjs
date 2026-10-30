#!/usr/bin/env node
/**
 * Merge Vitest coverage from coverage/coverage-final.json with Playwright
 * coverage from .nyc_output/e2e/ into .nyc_output/merged/coverage-final.json.
 * Run pnpm coverage:all to collect, merge, and report both sources.
 */

import path from "node:path"
import { fileURLToPath } from "node:url"
import { mergeCoverageReports } from "./merge-coverage-runner.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")

mergeCoverageReports(ROOT).catch((err) => {
  console.error("[merge-coverage] Fatal error:", err)
  process.exit(1)
})
