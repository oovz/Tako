import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { ExtensionSettings } from "@/src/domain/settings/types"
import { t } from "@/src/runtime/i18n"
import { validateTemplate } from "@/src/shared/template-expander"
import { TemplateMacros } from "../components/primitives/TemplateMacros"
import { StorageFileOptions } from "./StorageTab-file-options"
import { PathVisualization } from "../components/PathVisualization"

export function StorageTemplates({
  downloads,
  destinationName,
  onChange: updateDownloads,
}: {
  downloads: ExtensionSettings["downloads"]
  destinationName: string
  onChange: (updates: Partial<ExtensionSettings["downloads"]>) => void
}) {
  const looseFiles = downloads.defaultFormat === "none"
  const pathIsValid = validateTemplate(downloads.pathTemplate).valid
  const filenameIsValid = validateTemplate(downloads.fileNameTemplate).valid

  return (
    <div className="@container p-4">
      <div className="options-naming-layout">
        <div className="flex min-w-0 flex-col gap-5">
          {/* Directory Path Template */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="download-path" className="text-sm font-medium">
              {t("options_directoryPathTemplate")}
            </Label>
            <p id="save-subfolder-help" className="options-template-help">
              {t("options_directoryPathTemplateDesc")}
            </p>
            <Input
              id="download-path"
              data-testid="download-path-input"
              value={downloads.pathTemplate}
              aria-invalid={!pathIsValid}
              aria-describedby="save-subfolder-help template-validation-status"
              onChange={(e) =>
                updateDownloads({ pathTemplate: e.target.value })
              }
              placeholder="<SERIES_TITLE>/<CHAPTER_TITLE>"
              className="font-mono text-sm"
            />
            <TemplateMacros
              kind="path"
              value={downloads.pathTemplate}
              onChange={(value) => updateDownloads({ pathTemplate: value })}
            />
          </div>

          {/* Filename Template */}
          <div className="flex flex-col gap-2 border-t border-border/60 pt-4">
            <Label htmlFor="filename-template" className="text-sm font-medium">
              {t(
                looseFiles
                  ? "options_chapterFolderName"
                  : "options_filenameTemplate"
              )}
            </Label>
            <p id="chapter-output-help" className="options-template-help">
              {looseFiles
                ? t("options_chapterFolderNameDesc")
                : t("options_filenameTemplateDesc", [downloads.defaultFormat])}
            </p>
            <div className="options-template-name" data-archive={!looseFiles}>
              <Input
                id="filename-template"
                data-testid="filename-template-input"
                value={downloads.fileNameTemplate}
                aria-invalid={!filenameIsValid}
                aria-describedby="chapter-output-help template-validation-status"
                onChange={(e) =>
                  updateDownloads({
                    fileNameTemplate: e.target.value,
                  })
                }
                placeholder="<CHAPTER_TITLE>"
                className="font-mono text-sm"
              />
              {!looseFiles && (
                <span className="options-file-extension" aria-hidden="true">
                  .{downloads.defaultFormat}
                </span>
              )}
            </div>
            <TemplateMacros
              kind="filename"
              value={downloads.fileNameTemplate}
              onChange={(value) => updateDownloads({ fileNameTemplate: value })}
            />
          </div>
          <StorageFileOptions
            downloads={downloads}
            onChange={updateDownloads}
          />
        </div>
        {/* Real-time Path Visualization */}
        <PathVisualization
          template={downloads.pathTemplate}
          filenameTemplate={downloads.fileNameTemplate}
          format={downloads.defaultFormat}
          destinationName={destinationName}
          fileOptions={downloads}
        />
      </div>
    </div>
  )
}
