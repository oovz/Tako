import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { ExtensionSettings } from "@/src/domain/settings/types"
import { t } from "@/src/runtime/i18n"
import { validateTemplate } from "@/src/shared/template-expander"
import { SettingsGroup } from "../components/primitives/SettingsGroup"
import { PathVisualization } from "../components/PathVisualization"

const PATH_MACROS = [
  "<SERIES_TITLE>",
  "<CHAPTER_NUMBER>",
  "<CHAPTER_TITLE>",
  "<VOLUME_NUMBER>",
] as const

const FILENAME_MACROS = [
  "<CHAPTER_TITLE>",
  "<CHAPTER_NUMBER>",
  "<CHAPTER_NUMBER_PAD2>",
  "<CHAPTER_NUMBER_PAD3>",
  "<SERIES_TITLE>",
  "<VOLUME_NUMBER>",
] as const

export function StorageTemplates({
  downloads,
  destinationName,
  onChange: updateDownloads,
}: {
  downloads: ExtensionSettings["downloads"]
  destinationName: string
  onChange: (updates: Partial<ExtensionSettings["downloads"]>) => void
}) {
  const pathIsValid = validateTemplate(downloads.pathTemplate).valid
  const filenameIsValid = validateTemplate(downloads.fileNameTemplate).valid

  const insertPathMacro = (macro: string) => {
    const current = downloads.pathTemplate || ""
    const updated =
      current.endsWith("/") || current.length === 0
        ? `${current}${macro}`
        : `${current}/${macro}`
    updateDownloads({ pathTemplate: updated })
  }

  const insertFilenameMacro = (macro: string) => {
    const current = downloads.fileNameTemplate || ""
    const updated = current ? `${current} - ${macro}` : macro
    updateDownloads({ fileNameTemplate: updated })
  }

  return (
    <SettingsGroup title={t("options_fileNaming")}>
      <div className="@container p-4">
        <div className="grid items-start gap-4 @min-[34rem]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="flex min-w-0 flex-col gap-5">
            {/* Directory Path Template */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="download-path" className="text-sm font-medium">
                {t("options_directoryPathTemplate")}
              </Label>
              <Input
                id="download-path"
                data-testid="download-path-input"
                value={downloads.pathTemplate}
                aria-invalid={!pathIsValid}
                aria-describedby="template-validation-status"
                onChange={(e) =>
                  updateDownloads({ pathTemplate: e.target.value })
                }
                placeholder="<SERIES_TITLE>/<CHAPTER_TITLE>"
                className="font-mono text-sm"
              />
              {/* Interactive macro chips */}
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                {PATH_MACROS.map((macro) => (
                  <button
                    key={macro}
                    type="button"
                    onClick={() => insertPathMacro(macro)}
                    className="inline-flex items-center rounded-md border border-border/80 bg-muted/60 px-2 py-0.5 text-xs font-mono text-foreground hover:bg-accent hover:text-accent-foreground transition-colors duration-150 cursor-pointer"
                  >
                    + {macro}
                  </button>
                ))}
              </div>
            </div>

            {/* Filename Template */}
            <div className="flex flex-col gap-2 border-t border-border/60 pt-4">
              <Label
                htmlFor="filename-template"
                className="text-sm font-medium"
              >
                {t("options_filenameTemplate")}
              </Label>
              <Input
                id="filename-template"
                data-testid="filename-template-input"
                value={downloads.fileNameTemplate}
                aria-invalid={!filenameIsValid}
                aria-describedby="template-validation-status"
                onChange={(e) =>
                  updateDownloads({
                    fileNameTemplate: e.target.value,
                  })
                }
                placeholder="<CHAPTER_TITLE>"
                className="font-mono text-sm"
              />
              {/* Interactive macro chips */}
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                {FILENAME_MACROS.map((macro) => (
                  <button
                    key={macro}
                    type="button"
                    onClick={() => insertFilenameMacro(macro)}
                    className="inline-flex items-center rounded-md border border-border/80 bg-muted/60 px-2 py-0.5 text-xs font-mono text-foreground hover:bg-accent hover:text-accent-foreground transition-colors duration-150 cursor-pointer"
                  >
                    + {macro}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {/* Real-time Path Visualization */}
          <PathVisualization
            template={downloads.pathTemplate}
            filenameTemplate={downloads.fileNameTemplate}
            format={downloads.defaultFormat}
            destinationName={destinationName}
          />
        </div>
      </div>
    </SettingsGroup>
  )
}
