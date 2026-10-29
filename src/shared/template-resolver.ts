/** Resolve directory and filename templates using chapter metadata. */

import { validateTemplateMacros } from "./template-macros"
import { validateResolvedPath } from "./download-path-validator"
import { sanitizeFilename } from "./filename-sanitizer"
import { buildTemplateValues } from "./template-values"

/** Values required to resolve one chapter's output path. */
export interface TemplateContext {
  date: Date
  publisher?: string
  integrationName?: string
  seriesTitle?: string
  chapterTitle: string
  volumeTitle?: string
  format: string // Used when composing the final filename.
  chapterNumber?: number
  volumeNumber?: number
}

export interface TemplateResolutionResult {
  success: boolean
  resolvedPath?: string // directory path only (sanitized, relative)
  error?: string
}

export interface FilenameResolutionResult {
  success: boolean
  resolvedName?: string
  error?: string
}

// Date macros use the user's local timezone.
function buildTokens(ctx: TemplateContext): Record<string, string | undefined> {
  return buildTemplateValues({
    ...ctx,
    currentYear: ctx.date.getFullYear(),
    currentMonth: ctx.date.getMonth() + 1,
    currentDay: ctx.date.getDate(),
  })
}

// Expand (directory only). Each segment sanitized. Empty segments discarded.
function expandDirectory(template: string, ctx: TemplateContext): string {
  const tokens = buildTokens(ctx)
  const tpl = template || ""
  const rawSegments = tpl.split("/")
  const out: string[] = []
  for (let seg of rawSegments) {
    seg = seg.replace(
      /<([^>]+)>/g,
      (_match, name: string) => tokens[name] ?? ""
    )
    seg = sanitizeFilename(seg.trim())
    if (seg) out.push(seg)
  }
  return out.join("/")
}

/**
 * Resolve a chapter directory, including any <CHAPTER_TITLE> macro.
 * Requires a chapter title and format, and rejects an empty result.
 * A suffix such as .cbz remains part of the directory name.
 */
export function resolveDownloadDirectory(
  template: string,
  ctx: TemplateContext
): TemplateResolutionResult {
  try {
    if (!ctx.chapterTitle) {
      return {
        success: false,
        error: "chapterTitle required for directory resolution",
      }
    }
    if (!ctx.format) {
      return {
        success: false,
        error: "format required for directory resolution",
      }
    }

    const macroValidation = validateTemplateMacros(template || "")
    if (!macroValidation.isValid) {
      return { success: false, error: macroValidation.error }
    }

    const expanded = expandDirectory(template || "", ctx)
    if (!expanded) {
      return { success: false, error: "Resolved directory is empty" }
    }

    // Re-use existing resolved path validator by appending placeholder filename.
    const validation = validateResolvedPath(`${expanded}/_placeholder_.cbz`)
    if (!validation.isValid) {
      return { success: false, error: validation.error }
    }
    return { success: true, resolvedPath: expanded }
  } catch (e) {
    return {
      success: false,
      error:
        e instanceof Error ? e.message : "Unknown directory resolution error",
    }
  }
}

/**
 * Resolve a file name (no extension) using a template and the same context
 * macros. Filename templates are explicit: empty templates, invalid macros,
 * and expansions that contain no usable characters are errors.
 */
export function resolveFileName(
  template: string | undefined,
  ctx: TemplateContext
): FilenameResolutionResult {
  const tpl = template?.trim() ?? ""
  if (!tpl) {
    return { success: false, error: "Filename template is empty" }
  }

  const macroValidation = validateTemplateMacros(tpl)
  if (!macroValidation.isValid) {
    return { success: false, error: macroValidation.error }
  }

  const tokens = buildTokens(ctx)
  const expanded = tpl.replace(
    /<([^>]+)>/g,
    (_match, name: string) => tokens[name] ?? ""
  )
  const resolvedName = sanitizeFilename(expanded.trim())
  if (!resolvedName) {
    return { success: false, error: "Resolved filename is empty" }
  }

  return { success: true, resolvedName }
}
