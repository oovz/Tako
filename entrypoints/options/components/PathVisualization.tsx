import { useMemo } from "react"
import { AlertCircle, CheckCircle2 } from "lucide-react"

import {
  createMockContext,
  expandTemplate,
  validateTemplate,
} from "@/src/shared/template-expander"
import { t } from "@/src/runtime/i18n"

interface PathVisualizationProps {
  template: string
  filenameTemplate: string
  format: "cbz" | "zip" | "none"
}

export function PathVisualization({
  template,
  filenameTemplate,
  format,
}: PathVisualizationProps) {
  const mockContext = useMemo(() => createMockContext(), [])

  const pathValidation = useMemo(() => validateTemplate(template), [template])
  const filenameValidation = useMemo(
    () => validateTemplate(filenameTemplate),
    [filenameTemplate]
  )

  const pathResult = useMemo(() => {
    if (!pathValidation.valid) {
      return {
        success: false,
        expanded: "",
        errors: pathValidation.errors,
        warnings: [],
      }
    }
    return expandTemplate(template, mockContext)
  }, [template, pathValidation.valid, pathValidation.errors, mockContext])

  const filenameResult = useMemo(() => {
    if (!filenameValidation.valid) {
      return {
        success: false,
        expanded: "",
        errors: filenameValidation.errors,
        warnings: [],
      }
    }
    return expandTemplate(filenameTemplate, mockContext)
  }, [
    filenameTemplate,
    filenameValidation.valid,
    filenameValidation.errors,
    mockContext,
  ])

  const fullPath = useMemo(() => {
    if (!pathResult.success || !filenameResult.success) return null
    const extension = format === "none" ? "" : `.${format}`
    return `${pathResult.expanded}/${filenameResult.expanded}${extension}`
  }, [pathResult, filenameResult, format])

  const hasErrors = !pathResult.success || !filenameResult.success
  const hasWarnings =
    pathResult.warnings.length > 0 || filenameResult.warnings.length > 0

  return (
    <div
      id="template-validation-status"
      role={hasErrors ? "alert" : "status"}
      aria-live="polite"
      className="rounded-lg border border-border bg-muted/40 p-3.5 flex flex-col gap-2"
    >
      <div className="flex items-start gap-2.5">
        {hasErrors ? (
          <AlertCircle className="size-4 text-destructive mt-0.5 shrink-0" />
        ) : (
          <CheckCircle2 className="size-4 text-primary mt-0.5 shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-foreground mb-1">
            {hasErrors
              ? t("options_invalidTemplate")
              : t("options_previewOutput")}
          </p>
          {fullPath ? (
            <p className="text-xs font-mono text-muted-foreground break-all bg-background/80 px-2 py-1 rounded border border-border/40">
              {fullPath}
            </p>
          ) : (
            <p className="text-xs text-destructive">
              {pathResult.errors.concat(filenameResult.errors).join("; ")}
            </p>
          )}
          {hasWarnings && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
              {pathResult.warnings.concat(filenameResult.warnings).join("; ")}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
