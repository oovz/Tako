/** Expand filename and directory templates for the Options preview. */

import {
  generateSampleMacroData,
  validateTemplateMacros,
} from "./template-macros"
import { sanitizeFilename } from "./filename-sanitizer"
import {
  buildTemplateValues,
  type TemplateValuesContext,
} from "./template-values"

export type TemplateContext = TemplateValuesContext

export interface ExpansionResult {
  success: boolean
  expanded: string
  errors: string[]
  warnings: string[]
}

/**
 * Expand template macros with context values
 */
export function expandTemplate(
  template: string,
  context: TemplateContext
): ExpansionResult {
  const errors: string[] = []
  const warnings: string[] = []

  const values = new Map(Object.entries(buildTemplateValues(context)))
  const unavailableMacros = new Set<string>()
  const expanded = template.replace(/<([^>]+)>/g, (macro, name: string) => {
    if (!values.has(name)) return macro
    const value = values.get(name)
    if (!value) {
      unavailableMacros.add(macro)
      return ""
    }
    return sanitizePathComponent(value)
  })

  appendUnavailableMacroDiagnostics(unavailableMacros, errors, warnings)
  const { invalidMacros } = validateTemplateMacros(template)
  if (invalidMacros.length > 0) {
    errors.push(
      `Unknown macros in template: ${invalidMacros.map((name) => `<${name}>`).join(", ")}`
    )
  }
  if (errors.length === 0 && expanded.includes("//")) {
    errors.push("Template results in empty path components")
  }

  return {
    success: errors.length === 0,
    expanded: errors.length === 0 ? expanded : template,
    errors,
    warnings,
  }
}

function appendUnavailableMacroDiagnostics(
  unavailableMacros: ReadonlySet<string>,
  errors: string[],
  warnings: string[]
): void {
  const missingCritical = ["<SERIES_TITLE>", "<CHAPTER_TITLE>"].filter(
    (macro) => unavailableMacros.has(macro)
  )
  if (missingCritical.length > 0) {
    errors.push(`Required macros unavailable: ${missingCritical.join(", ")}`)
  } else if (unavailableMacros.size > 0) {
    warnings.push(
      `Optional macros unavailable: ${[...unavailableMacros].join(", ")}`
    )
  }
}

/**
 * Sanitize path component - delegates to sanitizeFilename for cross-platform
 * illegal char + Windows reserved name protection, then applies path-component
 * specific trimming (leading/trailing dots, whitespace).
 */
function sanitizePathComponent(value: string): string {
  const sanitized = sanitizeFilename(value)
  return sanitized
    .replace(/^\./, "") // Remove leading period for safety
    .replace(/\.$/, "") // Remove trailing period (invalid on Windows)
    .trim()
}

/**
 * Get current time values for context
 */
export function getCurrentTimeValues(): Pick<
  TemplateContext,
  "currentYear" | "currentMonth" | "currentDay"
> {
  const now = new Date()
  return {
    currentYear: now.getFullYear(),
    currentMonth: now.getMonth() + 1, // 1-based
    currentDay: now.getDate(),
  }
}

/**
 * Create mock context for template preview
 * Derives values from TEMPLATE_MACROS examples (SSOT)
 */
export function createMockContext(): TemplateContext {
  // Derive from TEMPLATE_MACROS examples (SSOT) - see template-macros.ts
  const macroExamples = generateSampleMacroData()

  return {
    integrationName: macroExamples["INTEGRATION_NAME"],
    publisher: macroExamples["PUBLISHER"],
    seriesTitle: macroExamples["SERIES_TITLE"],
    chapterTitle: macroExamples["CHAPTER_TITLE"],
    chapterNumber: parseInt(macroExamples["CHAPTER_NUMBER_PAD3"], 10),
    volumeTitle: macroExamples["VOLUME_TITLE"],
    volumeNumber: parseInt(macroExamples["VOLUME_NUMBER_PAD2"], 10),
    ...getCurrentTimeValues(),
  }
}

/**
 * Validate template syntax without expanding
 */
export function validateTemplate(template: string): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []

  // Check for balanced angle brackets
  const openBrackets = (template.match(/</g) || []).length
  const closeBrackets = (template.match(/>/g) || []).length
  if (openBrackets !== closeBrackets) {
    errors.push("Unbalanced angle brackets in template")
  }

  // Check for empty template
  if (!template.trim()) {
    errors.push("Template cannot be empty")
  }

  // Check for invalid characters in template structure
  if (template.includes("//")) {
    errors.push("Template contains consecutive slashes")
  }

  for (const macro of validateTemplateMacros(template).invalidMacros) {
    errors.push(`Unknown macro: <${macro}>`)
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}
