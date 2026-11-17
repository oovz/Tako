import {
  readDiagnosticSnapshot,
  type DiagnosticEntry,
  type DiagnosticQuery,
} from "./diagnostic-store"

export interface DiagnosticReport {
  format: "tako-diagnostics"
  version: 1
  exportedAt: string
  entries: DiagnosticEntry[]
}

export async function createDiagnosticReport(
  query: DiagnosticQuery
): Promise<DiagnosticReport> {
  const entries = await readDiagnosticSnapshot(query)
  return {
    format: "tako-diagnostics",
    version: 1,
    exportedAt: new Date().toISOString(),
    entries,
  }
}
