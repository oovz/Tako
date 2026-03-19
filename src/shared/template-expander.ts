/**
 * Template Expander - Smart File Naming
 * Expands template macros with proper handling for unavailable values
 */

import { generateSampleMacroData } from './template-macros';

export interface TemplateContext {
  // Site information
  integrationName?: string
  publisher?: string

  // Series information
  seriesTitle?: string

  // Chapter information
  chapterTitle?: string
  chapterNumber?: number

  // Volume information
  volumeTitle?: string
  volumeNumber?: number

  // Time values (always available)
  currentYear: number
  currentMonth: number
  currentDay: number
}

export interface ExpansionResult {
  success: boolean
  expanded: string
  errors: string[]
  warnings: string[]
}

/**
 * Expand template macros with context values
 */
export function expandTemplate(template: string, context: TemplateContext): ExpansionResult {
  const errors: string[] = []
  const warnings: string[] = []
  
  let expanded = template
  
  // Track which macros were unavailable
  const unavailableMacros: string[] = []
  
  // Site macros
  if (template.includes('<INTEGRATION_NAME>')) {
    if (context.integrationName) {
      expanded = expanded.replace(/<INTEGRATION_NAME>/g, sanitizePathComponent(context.integrationName))
    } else {
      unavailableMacros.push('<INTEGRATION_NAME>')
    }
  }

  if (template.includes('<PUBLISHER>')) {
    if (context.publisher) {
      expanded = expanded.replace(/<PUBLISHER>/g, sanitizePathComponent(context.publisher))
    } else {
      unavailableMacros.push('<PUBLISHER>')
      expanded = expanded.replace(/<PUBLISHER>/g, '')
    }
  }

  // Series macros
  if (template.includes('<SERIES_TITLE>')) {
    if (context.seriesTitle) {
      expanded = expanded.replace(/<SERIES_TITLE>/g, sanitizePathComponent(context.seriesTitle))
    } else {
      unavailableMacros.push('<SERIES_TITLE>')
      expanded = expanded.replace(/<SERIES_TITLE>/g, '')
    }
  }

  // Chapter macros
  if (template.includes('<CHAPTER_TITLE>')) {
    if (context.chapterTitle) {
      expanded = expanded.replace(/<CHAPTER_TITLE>/g, sanitizePathComponent(context.chapterTitle))
    } else {
      unavailableMacros.push('<CHAPTER_TITLE>')
      expanded = expanded.replace(/<CHAPTER_TITLE>/g, '')
    }
  }

  if (template.includes('<CHAPTER_NUMBER_PAD2>')) {
    if (context.chapterNumber !== undefined) {
      expanded = expanded.replace(/<CHAPTER_NUMBER_PAD2>/g, String(context.chapterNumber).padStart(2, '0'))
    } else {
      unavailableMacros.push('<CHAPTER_NUMBER_PAD2>')
      expanded = expanded.replace(/<CHAPTER_NUMBER_PAD2>/g, '')
    }
  }

  if (template.includes('<CHAPTER_NUMBER_PAD3>')) {
    if (context.chapterNumber !== undefined) {
      expanded = expanded.replace(/<CHAPTER_NUMBER_PAD3>/g, String(context.chapterNumber).padStart(3, '0'))
    } else {
      unavailableMacros.push('<CHAPTER_NUMBER_PAD3>')
      expanded = expanded.replace(/<CHAPTER_NUMBER_PAD3>/g, '')
    }
  }

  // Volume macros
  if (template.includes('<VOLUME_TITLE>')) {
    if (context.volumeTitle) {
      expanded = expanded.replace(/<VOLUME_TITLE>/g, sanitizePathComponent(context.volumeTitle))
    } else {
      unavailableMacros.push('<VOLUME_TITLE>')
      expanded = expanded.replace(/<VOLUME_TITLE>/g, '')
    }
  }

  if (template.includes('<VOLUME_NUMBER_PAD2>')) {
    if (context.volumeNumber !== undefined) {
      expanded = expanded.replace(/<VOLUME_NUMBER_PAD2>/g, String(context.volumeNumber).padStart(2, '0'))
    } else {
      unavailableMacros.push('<VOLUME_NUMBER_PAD2>')
      expanded = expanded.replace(/<VOLUME_NUMBER_PAD2>/g, '')
    }
  }

  // Date macros (always available)
  expanded = expanded.replace(/<YYYY>/g, String(context.currentYear))
  expanded = expanded.replace(/<MM>/g, String(context.currentMonth).padStart(2, '0'))
  expanded = expanded.replace(/<DD>/g, String(context.currentDay).padStart(2, '0'))
  
  // Check for unavailable macros that would result in invalid paths
  if (unavailableMacros.length > 0) {
    // Critical macros that cannot be missing
    const criticalMacros = ['<SERIES_TITLE>', '<CHAPTER_TITLE>']
    const missingCritical = unavailableMacros.filter(m => criticalMacros.includes(m))
    
    if (missingCritical.length > 0) {
      errors.push(`Required macros unavailable: ${missingCritical.join(', ')}`)
    } else {
      warnings.push(`Optional macros unavailable: ${unavailableMacros.join(', ')}`)
    }
  }
  
  // Check for remaining unexpanded macros (typos or unknown macros)
  const remainingMacros = expanded.match(/<[A-Z_]+>/g)
  if (remainingMacros) {
    errors.push(`Unknown macros in template: ${remainingMacros.join(', ')}`)
  }
  
  // Validate result
  if (errors.length > 0) {
    return {
      success: false,
      expanded: template, // Return original on error
      errors,
      warnings
    }
  }
  
  // Check for empty path components (invalid)
  const pathParts = expanded.split('/')
  const emptyParts = pathParts.filter((part, idx) => part === '' && idx !== 0 && idx !== pathParts.length - 1)
  if (emptyParts.length > 0) {
    errors.push('Template results in empty path components')
    return {
      success: false,
      expanded: template,
      errors,
      warnings
    }
  }
  
  return {
    success: true,
    expanded,
    errors,
    warnings
  }
}

/**
 * Sanitize path component - remove invalid filesystem characters
 */
function sanitizePathComponent(value: string): string {
  // Remove invalid Windows/Unix filesystem characters
  // Invalid: < > : " | ? * \ and control characters
  return value
    .split('')
    .filter(char => {
      const code = char.charCodeAt(0)
      // Remove control characters (0x00-0x1F)
      if (code <= 31) return false
      // Remove invalid path characters
      return !['<', '>', ':', '"', '|', '?', '*', '\\'].includes(char)
    })
    .join('')
    .replace(/\.$/, '') // Remove trailing period (invalid on Windows)
    .replace(/^\./, '') // Remove leading period for safety
    .trim()
}

/**
 * Get current time values for context
 */
export function getCurrentTimeValues(): Pick<TemplateContext, 'currentYear' | 'currentMonth' | 'currentDay'> {
  const now = new Date()
  return {
    currentYear: now.getFullYear(),
    currentMonth: now.getMonth() + 1, // 1-based
    currentDay: now.getDate()
  }
}

/**
 * Create mock context for template preview
 * Derives values from TEMPLATE_MACROS examples (SSOT)
 */
export function createMockContext(): TemplateContext {
  // Derive from TEMPLATE_MACROS examples (SSOT) - see template-macros.ts
  const macroExamples = generateSampleMacroData();
  
  return {
    integrationName: macroExamples['INTEGRATION_NAME'],
    publisher: macroExamples['PUBLISHER'],
    seriesTitle: macroExamples['SERIES_TITLE'],
    chapterTitle: macroExamples['CHAPTER_TITLE'],
    chapterNumber: parseInt(macroExamples['CHAPTER_NUMBER_PAD3'], 10),
    volumeTitle: macroExamples['VOLUME_TITLE'],
    volumeNumber: parseInt(macroExamples['VOLUME_NUMBER_PAD2'], 10),
    ...getCurrentTimeValues()
  };
}

/**
 * Validate template syntax without expanding
 */
export function validateTemplate(template: string): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  
  // Check for balanced angle brackets
  const openBrackets = (template.match(/</g) || []).length
  const closeBrackets = (template.match(/>/g) || []).length
  if (openBrackets !== closeBrackets) {
    errors.push('Unbalanced angle brackets in template')
  }
  
  // Check for empty template
  if (!template.trim()) {
    errors.push('Template cannot be empty')
  }
  
  // Check for invalid characters in template structure
  if (template.includes('//')) {
    errors.push('Template contains consecutive slashes')
  }
  
  // Check for known macro typos (case-sensitive)
  const macroPattern = /<([A-Z_]+)>/g
  const macros = Array.from(template.matchAll(macroPattern), m => m[1])
  const validMacros = [
    'YYYY', 'MM', 'DD',
    'INTEGRATION_NAME', 'PUBLISHER',
    'SERIES_TITLE', 'CHAPTER_TITLE', 'VOLUME_TITLE',
    'CHAPTER_NUMBER_PAD2', 'CHAPTER_NUMBER_PAD3', 'VOLUME_NUMBER_PAD2'
  ]
  
  for (const macro of macros) {
    if (!validMacros.includes(macro)) {
      errors.push(`Unknown macro: <${macro}>`)
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  }
}
