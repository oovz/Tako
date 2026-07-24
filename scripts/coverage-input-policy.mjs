/**
 * Fail closed when a combined coverage report is missing either source.
 * A partial report can otherwise look healthy while silently omitting an
 * entire test layer.
 *
 * @param {{hasVitestCoverage: boolean, e2ePageCoverageFileCount: number, e2eWorkerCoverageFileCount: number}} inputs
 */
export function assertCompleteCoverageInputs(inputs) {
  const missing = []
  if (!inputs.hasVitestCoverage) {
    missing.push("Vitest coverage is missing; run `pnpm test:coverage`.")
  }
  if (inputs.e2ePageCoverageFileCount === 0) {
    missing.push("E2E page coverage is missing; run `pnpm test:e2e:coverage`.")
  }
  if (inputs.e2eWorkerCoverageFileCount === 0) {
    missing.push(
      "E2E service-worker coverage is missing; run `pnpm test:e2e:coverage`."
    )
  }

  if (missing.length > 0) {
    throw new Error(`Cannot merge partial coverage. ${missing.join(" ")}`)
  }
}
