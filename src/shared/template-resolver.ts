/**
 * Download path template resolution utilities (directory-only semantics)
 * Single exported resolver that always returns a DIRECTORY path.
 * Final archive filename (chapter title + format extension) is appended elsewhere.
 * If the user supplies what looks like a filename (e.g. "<CHAPTER>.cbz"), it is treated as a directory name verbatim.
 */

import { validateTemplateMacros, generateSampleMacroData } from './template-macros';
import { validateResolvedPath } from './download-path-validator';
import { sanitizeFilename } from './filename-sanitizer';

export interface TemplateContext {
  date: Date;
  publisher?: string;
  integrationName?: string;
  seriesTitle?: string;
  chapterTitle: string; // REQUIRED for new semantics when resolving per chapter
  volumeTitle?: string;
  format: string; // REQUIRED (used externally when composing final file name)
  chapterNumber?: number;
  volumeNumber?: number;
}

export interface TemplateResolutionResult {
  success: boolean;
  resolvedPath?: string; // directory path only (sanitized, relative)
  error?: string;
}

// Canonical token builder (per chapter) – chapters required for new rule-set.
// Uses local date methods so date macros reflect user's local timezone (for file organization)
function buildTokens(ctx: TemplateContext): Record<string,string|undefined> {
  const pad2 = (n: number) => String(n).padStart(2,'0');
  const pad3 = (n: number) => String(n).padStart(3,'0');
  return {
    'YYYY': String(ctx.date.getFullYear()),
    'MM': pad2(ctx.date.getMonth()+1),
    'DD': pad2(ctx.date.getDate()),
    'PUBLISHER': ctx.publisher,
    'INTEGRATION_NAME': ctx.integrationName,
    'SERIES_TITLE': ctx.seriesTitle,
    'CHAPTER_TITLE': ctx.chapterTitle,
    'VOLUME_TITLE': ctx.volumeTitle,
    'CHAPTER_NUMBER_PAD2': ctx.chapterNumber !== undefined ? pad2(ctx.chapterNumber) : undefined,
    'CHAPTER_NUMBER_PAD3': ctx.chapterNumber !== undefined ? pad3(ctx.chapterNumber) : undefined,
    'VOLUME_NUMBER_PAD2': ctx.volumeNumber !== undefined ? pad2(ctx.volumeNumber) : undefined,
  };
}

// Expand (directory only). Each segment sanitized. Empty segments discarded.
function expandDirectory(template: string, ctx: TemplateContext): string {
  const tokens = buildTokens(ctx);
  const tpl = template || '';
  const rawSegments = tpl.split('/');
  const out: string[] = [];
  for (let seg of rawSegments) {
    seg = seg.replace(/<([^>]+)>/g, (_match, name: string) => tokens[name] ?? '');
    seg = sanitizeFilename(seg.trim());
    if (seg) out.push(seg);
  }
  return out.join('/');
}

/**
 * Resolve a directory template for ONE chapter.
 * - Always per chapter (allows <CHAPTER> macro usage).
 * - Returns error if chapterTitle or format missing (no fallback names).
 * - An empty final directory after expansion is an ERROR (no fallback to series/Chapter).
 * - Treats any extension-looking suffix as part of the directory (not a filename).
 */
export function resolveDownloadDirectory(template: string, ctx: TemplateContext): TemplateResolutionResult {
  try {
    if (!ctx.chapterTitle) {
      return { success: false, error: 'chapterTitle required for directory resolution' };
    }
    if (!ctx.format) {
      return { success: false, error: 'format required for directory resolution' };
    }

  const macroValidation = validateTemplateMacros(template || '');
    if (!macroValidation.isValid) {
      return { success: false, error: macroValidation.error };
    }

  const expanded = expandDirectory(template || '', ctx);
    if (!expanded) {
      return { success: false, error: 'Resolved directory is empty' };
    }

    // Re-use existing resolved path validator by appending placeholder filename.
    const validation = validateResolvedPath(`${expanded}/_placeholder_.cbz`);
    if (!validation.isValid) {
      return { success: false, error: validation.error };
    }
    return { success: true, resolvedPath: expanded };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Unknown directory resolution error' };
  }
}

/**
 * Resolve a file name (no extension) using a template and the same context macros.
 * If the template is empty, defaults to <CHAPTER_TITLE>.
 */
export function resolveFileName(template: string | undefined, ctx: TemplateContext): string {
  const tpl = (template && template.trim()) ? template : '<CHAPTER_TITLE>';
  const macroValidation = validateTemplateMacros(tpl);
  if (!macroValidation.isValid) {
    // Fallback to simple chapter title if invalid
    return sanitizeFilename(ctx.chapterTitle);
  }
  const tokens = buildTokens(ctx);
  let out = tpl.replace(/<([^>]+)>/g, (_match, name: string) => tokens[name] ?? '');
  out = sanitizeFilename(out.trim() || ctx.chapterTitle);
  return out;
}

/**
 * Build a sample TemplateContext from macro examples (Single Source of Truth).
 * Derives preview data from TEMPLATE_MACROS to eliminate duplication.
 */
export function buildSampleContext(): TemplateContext {
  const macroData = generateSampleMacroData();
  return {
    date: new Date(
      parseInt(macroData['YYYY'], 10),
      parseInt(macroData['MM'], 10) - 1,
      parseInt(macroData['DD'], 10)
    ),
    publisher: macroData['PUBLISHER'],
    integrationName: macroData['INTEGRATION_NAME'],
    seriesTitle: macroData['SERIES_TITLE'],
    chapterTitle: macroData['CHAPTER_TITLE'],
    volumeTitle: macroData['VOLUME_TITLE'],
    format: 'cbz',
    chapterNumber: parseInt(macroData['CHAPTER_NUMBER_PAD3'], 10) || undefined,
    volumeNumber: parseInt(macroData['VOLUME_NUMBER_PAD2'], 10) || undefined,
  };
}

/**
 * Preview function returns an example FINAL file path (directory + auto filename)
 * so existing UI expecting a file-like path keeps working.
 */
export function previewTemplate(template: string): string {
  const sampleContext = buildSampleContext();
  const dirRes = resolveDownloadDirectory(template, sampleContext);
  if (!dirRes.success || !dirRes.resolvedPath) return template;
  const fileBase = sanitizeFilename(sampleContext.chapterTitle);
  return `${dirRes.resolvedPath}/${fileBase}.${sampleContext.format}`;
}

/**
 * Check if template has unresolved macros after expansion
 */
export function hasUnresolvedMacros(expandedPath: string): boolean {
  return /<[^>]+>/.test(expandedPath);
}

/**
 * Extract macro names used in a template
 */
export function extractMacrosFromTemplate(template: string): string[] {
  const macroPattern = /<([^>]+)>/g;
  return [...template.matchAll(macroPattern)].map(match => match[1]);
}
