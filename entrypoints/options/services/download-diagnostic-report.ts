import { createDiagnosticReport } from "@/src/runtime/diagnostic-report"
import type { DiagnosticQuery } from "@/src/runtime/diagnostic-store"

export async function downloadDiagnosticReport(
  query: DiagnosticQuery
): Promise<void> {
  const report = await createDiagnosticReport(query)
  const blob = new Blob([JSON.stringify(report) + "\n"], {
    type: "application/json",
  })
  const url = URL.createObjectURL(blob)
  try {
    const link = document.createElement("a")
    link.href = url
    link.download = `tako-diagnostics-${report.exportedAt.replaceAll(":", "-")}.json`
    link.click()
  } finally {
    // Give Chrome time to consume the URL for its download.
    setTimeout(() => URL.revokeObjectURL(url), 1_000)
  }
}
