import { useOptionsPreview } from "../hooks/useOptionsMotion"
import { useMemo } from "react"
import {
  AlertCircle,
  ChevronRight,
  FileArchive,
  Folder,
  Image,
  FileCode,
} from "lucide-react"
import type { ExtensionSettings } from "@/src/domain/settings/types"
import { createMockContext } from "@/src/shared/template-expander"
import {
  normalizeImageFilename,
  sanitizeFilename,
} from "@/src/shared/filename-sanitizer"
import {
  buildImageOutputFilename,
  buildCoverOutputFilename,
} from "@/src/shared/output-filenames"
import { createPathPreview } from "./PathVisualization-preview"
import { t } from "@/src/runtime/i18n"

type FileOptions = Pick<
  ExtensionSettings["downloads"],
  | "normalizeImageFilenames"
  | "imagePaddingDigits"
  | "includeComicInfo"
  | "includeCoverImage"
>
interface PathVisualizationProps {
  template: string
  filenameTemplate: string
  format: "cbz" | "zip" | "none"
  destinationName?: string
  fileOptions: FileOptions
}

export function PathVisualization({
  template,
  filenameTemplate,
  format,
  destinationName,
  fileOptions,
}: PathVisualizationProps) {
  const context = useMemo(() => createMockContext(), [])
  const chapterLabel = t("options_chapter")
  const outputs = useMemo(
    () =>
      [1, 2, 3].map((chapterNumber) =>
        createPathPreview(template, filenameTemplate, format, {
          ...context,
          chapterNumber,
          chapterTitle: `${chapterLabel} ${chapterNumber}`,
        })
      ),
    [template, filenameTemplate, format, context, chapterLabel]
  )
  const { hasErrors, errors, warnings } = outputs[0]
  const groups = new Map<string, { index: number; name: string }[]>()
  outputs.forEach((output, index) => {
    if (!output.fullPath) return
    const split = output.fullPath.lastIndexOf("/")
    const directory = output.fullPath.slice(0, split)
    const files = groups.get(directory) ?? []
    files.push({ index, name: output.fullPath.slice(split + 1) })
    groups.set(directory, files)
  })
  const images = [0, 1, 2].map((index) => {
    const originalFilename = `scan-${index + 1}.jpg`
    if (format === "none")
      return buildImageOutputFilename({
        index,
        totalImages: 12,
        originalFilename,
        mimeType: "image/jpeg",
        ...fileOptions,
      })
    return fileOptions.normalizeImageFilenames
      ? normalizeImageFilename(
          index,
          12,
          "image/jpeg",
          fileOptions.imagePaddingDigits
        )
      : sanitizeFilename(originalFilename)
  })
  const preview = useOptionsPreview(
    JSON.stringify([outputs, destinationName, fileOptions])
  )
  const OutputIcon = format === "none" ? Folder : FileArchive
  return (
    <div
      ref={preview}
      role="group"
      aria-label={t("options_exampleOutput")}
      className="options-output-preview"
    >
      <span
        id="template-validation-status"
        role={hasErrors ? "alert" : "status"}
        aria-live="polite"
        className="sr-only"
      >
        {hasErrors
          ? errors.join("; ")
          : [
              outputs[0].fullPath,
              format === "none" ? t("options_noArchiveDesc") : "",
              ...warnings,
            ]
              .filter(Boolean)
              .join(". ")}
      </span>
      <p className="flex items-center gap-2 text-sm font-semibold">
        {hasErrors && (
          <AlertCircle aria-hidden="true" className="size-4 text-destructive" />
        )}
        {hasErrors ? t("options_invalidTemplate") : t("options_exampleOutput")}
      </p>
      {hasErrors ? (
        <p className="mt-2 text-xs text-destructive" aria-hidden="true">
          {errors.join("; ")}
        </p>
      ) : (
        <div className="options-output-tree">
          {destinationName && (
            <p className="options-output-destination">{destinationName}</p>
          )}
          {[...groups].map(([directory, files]) => (
            <div key={directory}>
              <div className="options-output-folder">
                <Folder aria-hidden="true" />
                <p className="options-output-path">{directory}/</p>
              </div>
              <div className="options-output-examples">
                {files.map(({ index, name }) => (
                  <details
                    key={index}
                    className="options-output-chapter"
                    open={index === 0}
                  >
                    <summary>
                      <ChevronRight
                        aria-hidden="true"
                        className="output-disclosure"
                      />
                      <OutputIcon aria-hidden="true" />
                      <span>{name}</span>
                    </summary>
                    <ul className="options-output-contents">
                      {fileOptions.includeCoverImage && (
                        <li title={t("options_includeCoverDesc")}>
                          <Image aria-hidden="true" />
                          <span>{buildCoverOutputFilename("image/jpeg")}</span>
                        </li>
                      )}
                      {images.map((filename) => (
                        <li key={filename}>
                          <Image aria-hidden="true" />
                          <span>{filename}</span>
                        </li>
                      ))}
                      <li className="options-output-more">
                        {t("options_moreExampleImages", ["9"])}
                      </li>
                      {fileOptions.includeComicInfo && (
                        <li>
                          <FileCode aria-hidden="true" />
                          <span>ComicInfo.xml</span>
                        </li>
                      )}
                    </ul>
                  </details>
                ))}
              </div>
            </div>
          ))}
          {format === "none" && (
            <p className="options-output-note">{t("options_noArchiveDesc")}</p>
          )}
        </div>
      )}
      {warnings.length > 0 && (
        <p className="mt-2 text-xs text-amber-700">{warnings.join("; ")}</p>
      )}
    </div>
  )
}
