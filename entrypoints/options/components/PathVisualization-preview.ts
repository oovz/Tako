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
  const hasErrors = !path.success || !filename.success
  const extension = format === "none" ? "" : `.${format}`
  return {
    hasErrors,
    fullPath: hasErrors
      ? null
      : `${path.expanded}/${filename.expanded}${extension}`,
    errors: path.errors.concat(filename.errors),
    warnings: path.warnings.concat(filename.warnings),
  }
}
