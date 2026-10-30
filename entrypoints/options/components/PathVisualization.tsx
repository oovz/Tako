import { useMemo } from "react"
import { AlertCircle, CheckCircle2 } from "lucide-react"

import { createMockContext } from "@/src/shared/template-expander"
import { createPathPreview } from "./PathVisualization-preview"
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

  const { hasErrors, fullPath, errors, warnings } = useMemo(
    () => createPathPreview(template, filenameTemplate, format, mockContext),
    [template, filenameTemplate, format, mockContext]
  )

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
            <p className="text-xs text-destructive">{errors.join("; ")}</p>
          )}
          {warnings.length > 0 && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
              {warnings.join("; ")}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
