export interface CoverageInputState {
  hasVitestCoverage: boolean;
  e2ePageCoverageFileCount: number;
  e2eWorkerCoverageFileCount: number;
}

export function assertCompleteCoverageInputs(inputs: CoverageInputState): void;
