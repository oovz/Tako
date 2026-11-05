import { useMemo } from "react"
import { AlertCircle, File, Folder } from "lucide-react"

import { createMockContext } from "@/src/shared/template-expander"
import { createPathPreview } from "./PathVisualization-preview"
import { t } from "@/src/runtime/i18n"

interface PathVisualizationProps {
  template: string
  filenameTemplate: string
  format: "cbz" | "zip" | "none"
  destinationName?: string
}

export function PathVisualization({
  template,
  filenameTemplate,
  format,
  destinationName,
}: PathVisualizationProps) {
  const mockContext = useMemo(() => createMockContext(), [])

  const { hasErrors, fullPath, errors, warnings } = useMemo(
    () => createPathPreview(template, filenameTemplate, format, mockContext),
    [template, filenameTemplate, format, mockContext]
  )

  const lastSlash = fullPath?.lastIndexOf("/") ?? -1
  const directory = fullPath?.slice(0, lastSlash)
  const outputName = fullPath?.slice(lastSlash + 1)
  const OutputIcon = format === "none" ? Folder : File

  return (
    <div
      id="template-validation-status"
      role={hasErrors ? "alert" : "status"}
      aria-live="polite"
      className="min-w-0 rounded-lg border bg-background/70 p-4"
    >
      <p className="flex items-center gap-2 text-sm font-semibold">
        {hasErrors && (
          <AlertCircle aria-hidden="true" className="size-4 text-destructive" />
        )}
        {hasErrors ? t("options_invalidTemplate") : t("options_exampleOutput")}
      </p>
      {outputName ? (
        <div className="mt-3 flex flex-col gap-2 text-xs wrap-anywhere">
          {destinationName && (
            <p className="text-muted-foreground">{destinationName}</p>
          )}
          <p className="flex items-start gap-2 font-mono">
            <Folder
              aria-hidden="true"
              className="size-4 shrink-0 text-muted-foreground"
            />
            <span>{directory}/</span>
          </p>
          <p className="ml-2 flex items-start gap-2 border-l pl-3 font-mono">
            <OutputIcon
              aria-hidden="true"
              className="size-4 shrink-0 text-muted-foreground"
            />
            <span>{outputName}</span>
          </p>
          {format === "none" && (
            <p className="text-muted-foreground">
              {t("options_noArchiveDesc")}
            </p>
          )}
        </div>
      ) : (
        <p className="mt-2 text-xs text-destructive">{errors.join("; ")}</p>
      )}
      {warnings.length > 0 && (
        <p className="mt-2 text-xs text-amber-700">{warnings.join("; ")}</p>
      )}
    </div>
  )
}
