import {
  resolveDownloadDirectory,
  resolveFileName,
} from "@/src/shared/template-resolver"
import {
  expandTemplate,
  validateTemplate,
  type TemplateContext,
  type ExpansionResult,
} from "@/src/shared/template-expander"

function expandPreviewTemplate(
  template: string,
  context: TemplateContext
): ExpansionResult {
  const validation = validateTemplate(template)
  if (!validation.valid) {
    return {
      success: false,
      expanded: "",
      errors: validation.errors,
      warnings: [],
    }
  }
  return expandTemplate(template, context)
}

export function createPathPreview(
  template: string,
  filenameTemplate: string,
  format: "cbz" | "zip" | "none",
  context: TemplateContext
) {
  const path = expandPreviewTemplate(template, context)
  const filename = expandPreviewTemplate(filenameTemplate, context)
  const runtimeContext = {
    ...context,
    date: new Date(),
    chapterTitle: context.chapterTitle ?? "",
    format,
  }
  const directory = resolveDownloadDirectory(template, runtimeContext)
  const leaf = resolveFileName(filenameTemplate, runtimeContext)
  const errors = path.errors.concat(filename.errors)
  if (path.success && directory.error) errors.push(directory.error)
  if (filename.success && leaf.error) errors.push(leaf.error)
  const fullPath =
    errors.length === 0 && directory.resolvedPath && leaf.resolvedName
      ? `${directory.resolvedPath}/${leaf.resolvedName}`
      : null
  const extension = format === "none" ? "" : `.${format}`
  return {
    hasErrors: fullPath === null,
    fullPath: fullPath ? `${fullPath}${extension}` : null,
    errors,
    warnings: path.warnings.concat(filename.warnings),
  }
}
