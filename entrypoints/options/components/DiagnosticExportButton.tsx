import { useState } from "react"
import { Button } from "@/components/ui/button"
import { downloadDiagnosticReport } from "../services/download-diagnostic-report"
import type { DiagnosticQuery } from "@/src/runtime/diagnostic-store"
import { t } from "@/src/runtime/i18n"

export function DiagnosticExportButton({ query }: { query: DiagnosticQuery }) {
  const [exporting, setExporting] = useState(false)
  const [failed, setFailed] = useState(false)

  async function exportReport() {
    setFailed(false)
    setExporting(true)
    try {
      await downloadDiagnosticReport(query)
    } catch {
      setFailed(true)
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        data-testid="export-diagnostics"
        disabled={exporting}
        onClick={() => void exportReport()}
      >
        {t(exporting ? "diagnostics_exporting" : "diagnostics_export")}
      </Button>
      {failed && (
        <p
          role="alert"
          data-testid="diagnostics-export-failed"
          className="basis-full text-sm text-destructive"
        >
          {t("diagnostics_exportFailed")}
        </p>
      )}
    </>
  )
}
