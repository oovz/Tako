/**
 * Template Expander Unit Tests
 * Tests for Smart File Naming with macros
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  expandTemplate,
  validateTemplate,
  createMockContext,
  getCurrentTimeValues,
  type TemplateContext
} from '@/src/shared/template-expander'

describe('Template Expander', () => {
  let mockContext: TemplateContext

  beforeEach(() => {
    mockContext = createMockContext()
  })

  describe('expandTemplate - Basic Macro Expansion', () => {
    it('expands all macros correctly', () => {
      const template = '<INTEGRATION_NAME>/<PUBLISHER>/<SERIES_TITLE>/<CHAPTER_TITLE>/<VOLUME_TITLE>/<CHAPTER_NUMBER_PAD2>/<CHAPTER_NUMBER_PAD3>/<VOLUME_NUMBER_PAD2>/<YYYY>/<MM>/<DD>'
      
      const result = expandTemplate(template, mockContext)
      
      expect(result.success).toBe(true)
      expect(result.expanded).toContain('mangadex')
      expect(result.expanded).toContain('Weekly Shonen Jump')
      expect(result.expanded).toContain('Hunter x Hunter')
      expect(result.expanded).toContain('Chapter 1')
      expect(result.expanded).toContain('01') // Pad2 sample
      expect(result.expanded).toContain('001') // Pad3 sample
      expect(result.errors).toHaveLength(0)
    })

    it('expands site information macros', () => {
      const template = '<INTEGRATION_NAME>/<PUBLISHER>'
      const result = expandTemplate(template, mockContext)
      
      expect(result.success).toBe(true)
      expect(result.expanded).toBe('mangadex/Weekly Shonen Jump')
    })

    it('expands series information macros', () => {
      const template = '<SERIES_TITLE>'
      const result = expandTemplate(template, mockContext)
      
      expect(result.success).toBe(true)
      expect(result.expanded).toBe('Hunter x Hunter')
    })

    it('expands chapter information macros', () => {
      const template = '<CHAPTER_NUMBER_PAD3> - <CHAPTER_TITLE>'
      const result = expandTemplate(template, mockContext)
      
      expect(result.success).toBe(true)
      // CHAPTER_TITLE from TEMPLATE_MACROS SSOT
      expect(result.expanded).toBe('001 - Chapter 1')
    })

    it('expands volume information macros', () => {
      const template = 'Volume <VOLUME_NUMBER_PAD2> - <VOLUME_TITLE>'
      const result = expandTemplate(template, mockContext)
      
      expect(result.success).toBe(true)
      // VOLUME_TITLE from TEMPLATE_MACROS SSOT
      expect(result.expanded).toBe('Volume 01 - Volume 1')
    })

    it('expands time macros with current values', () => {
      const template = '<YYYY>-<MM>-<DD>'
      const now = new Date()
      const result = expandTemplate(template, mockContext)
      
      expect(result.success).toBe(true)
      expect(result.expanded).toContain(String(now.getFullYear()))
    })
  })

  describe('expandTemplate - Auto-padding', () => {
    it('pads chapter number to 2 digits', () => {
      const context = { ...mockContext, chapterNumber: 5 }
      const result = expandTemplate('<CHAPTER_NUMBER_PAD2>', context)
      
      expect(result.success).toBe(true)
      expect(result.expanded).toBe('05')
    })

    it('pads chapter number to 3 digits', () => {
      const context = { ...mockContext, chapterNumber: 5 }
      const result = expandTemplate('<CHAPTER_NUMBER_PAD3>', context)
      
      expect(result.success).toBe(true)
      expect(result.expanded).toBe('005')
    })

    it('pads volume number to 2 digits', () => {
      const context = { ...mockContext, volumeNumber: 1 }
      const result = expandTemplate('<VOLUME_NUMBER_PAD2>', context)
      
      expect(result.success).toBe(true)
      expect(result.expanded).toBe('01')
    })
  })

  describe('expandTemplate - Error Handling', () => {
    it('errors when critical SERIES_TITLE macro is unavailable', () => {
      const context = { ...mockContext, seriesTitle: undefined }
      const result = expandTemplate('<SERIES_TITLE>/<CHAPTER_TITLE>', context)
      
      expect(result.success).toBe(false)
      expect(result.errors).toContain('Required macros unavailable: <SERIES_TITLE>')
    })

    it('errors when critical CHAPTER_TITLE macro is unavailable', () => {
      const context = { ...mockContext, chapterTitle: undefined }
      const result = expandTemplate('<SERIES_TITLE>/<CHAPTER_TITLE>', context)
      
      expect(result.success).toBe(false)
      expect(result.errors).toContain('Required macros unavailable: <CHAPTER_TITLE>')
    })

    it('warns when optional PUBLISHER macro is unavailable', () => {
      const context = { ...mockContext, publisher: undefined }
      const result = expandTemplate('<SERIES_TITLE>/<PUBLISHER>', context)
      
      expect(result.success).toBe(true) // Still succeeds
      expect(result.warnings).toContain('Optional macros unavailable: <PUBLISHER>')
    })

    it('warns when optional VOLUME macros are unavailable', () => {
      const context = { ...mockContext, volumeTitle: undefined, volumeNumber: undefined }
      const result = expandTemplate('<SERIES_TITLE>/<VOLUME_TITLE>', context)
      
      expect(result.success).toBe(true) // Still succeeds
      expect(result.warnings.length).toBeGreaterThan(0)
    })

    it('errors on unknown macros', () => {
      const result = expandTemplate('<UNKNOWN_MACRO>', mockContext)
      
      expect(result.success).toBe(false)
      expect(result.errors).toContain('Unknown macros in template: <UNKNOWN_MACRO>')
    })

    it('does not error for leading empty path components; warns instead', () => {
      const context = { ...mockContext, publisher: undefined }
      const result = expandTemplate('<PUBLISHER>/<SERIES_TITLE>', context)
      
      // <PUBLISHER> expands to empty; leading slash tolerated; should warn instead of error
      expect(result.success).toBe(true)
      expect(result.warnings).toContain('Optional macros unavailable: <PUBLISHER>')
    })
  })

  describe('expandTemplate - Character Sanitization', () => {
    it('removes invalid filesystem characters', () => {
      const context = {
        ...mockContext,
        seriesTitle: 'Series: With | Invalid * Characters?'
      }
      const result = expandTemplate('<SERIES_TITLE>', context)
      
      expect(result.success).toBe(true)
      expect(result.expanded).not.toContain(':')
      expect(result.expanded).not.toContain('|')
      expect(result.expanded).not.toContain('*')
      expect(result.expanded).not.toContain('?')
    })

    it('removes control characters', () => {
      const context = {
        ...mockContext,
        seriesTitle: 'Series\x00With\x1FControl'
      }
      const result = expandTemplate('<SERIES_TITLE>', context)
      
      expect(result.success).toBe(true)
      expect(result.expanded).toBe('SeriesWithControl')
    })

    it('removes trailing periods (Windows invalid)', () => {
      const context = {
        ...mockContext,
        seriesTitle: 'Series Name.'
      }
      const result = expandTemplate('<SERIES_TITLE>', context)
      
      expect(result.success).toBe(true)
      expect(result.expanded).not.toMatch(/\.$/)
    })

    it('removes leading periods', () => {
      const context = {
        ...mockContext,
        seriesTitle: '.Hidden Series'
      }
      const result = expandTemplate('<SERIES_TITLE>', context)
      
      expect(result.success).toBe(true)
      expect(result.expanded).not.toMatch(/^\./)
    })
  })

  describe('validateTemplate', () => {
    it('validates correct templates', () => {
      const result = validateTemplate('<SERIES_TITLE>/<CHAPTER_TITLE>')
      
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('rejects templates with unknown macros', () => {
      const result = validateTemplate('<UNKNOWN_MACRO>')
      
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Unknown macro: <UNKNOWN_MACRO>')
    })

    it('rejects templates with unbalanced brackets', () => {
      const result = validateTemplate('<SERIES_TITLE')
      
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Unbalanced angle brackets in template')
    })

    it('rejects empty templates', () => {
      const result = validateTemplate('')
      
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Template cannot be empty')
    })

    it('rejects templates with consecutive slashes', () => {
      const result = validateTemplate('<SERIES_TITLE>//<CHAPTER_TITLE>')
      
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Template contains consecutive slashes')
    })

    it('validates all macros', () => {
      const template = '<YYYY><MM><DD><INTEGRATION_NAME><PUBLISHER><SERIES_TITLE><CHAPTER_TITLE><VOLUME_TITLE><CHAPTER_NUMBER_PAD2><CHAPTER_NUMBER_PAD3><VOLUME_NUMBER_PAD2>'
      const result = validateTemplate(template)
      
      expect(result.valid).toBe(true)
    })
  })

  describe('createMockContext', () => {
    it('creates context with all required fields', () => {
      const context = createMockContext()
      
      expect(context.integrationName).toBeDefined()
      expect(context.publisher).toBeDefined()
      expect(context.seriesTitle).toBeDefined()
      expect(context.chapterTitle).toBeDefined()
      expect(context.chapterNumber).toBeDefined()
      expect(context.currentYear).toBeDefined()
      expect(context.currentMonth).toBeDefined()
      expect(context.currentDay).toBeDefined()
    })

    it('creates context with realistic values', () => {
      const context = createMockContext()
      
      expect(context.seriesTitle).toBe('Hunter x Hunter')
      expect(context.publisher).toBe('Weekly Shonen Jump')
    })
  })

  describe('getCurrentTimeValues', () => {
    it('returns current time values', () => {
      const now = new Date()
      const values = getCurrentTimeValues()
      
      expect(values.currentYear).toBe(now.getFullYear())
      expect(values.currentMonth).toBeGreaterThanOrEqual(1)
      expect(values.currentMonth).toBeLessThanOrEqual(12)
      expect(values.currentDay).toBeGreaterThanOrEqual(1)
      expect(values.currentDay).toBeLessThanOrEqual(31)
    })
  })

  describe('Real-world Use Cases', () => {
    it('handles typical manga download path', () => {
      const template = 'TMD/<SERIES_TITLE>/<CHAPTER_NUMBER_PAD3> - <CHAPTER_TITLE>'
      const result = expandTemplate(template, mockContext)
      
      expect(result.success).toBe(true)
      expect(result.expanded).toBe('TMD/Hunter x Hunter/001 - Chapter 1')
    })

    it('handles publisher-based organization', () => {
      const template = 'Manga/<PUBLISHER>/<SERIES_TITLE>'
      const result = expandTemplate(template, mockContext)
      
      expect(result.success).toBe(true)
      expect(result.expanded).toBe('Manga/Weekly Shonen Jump/Hunter x Hunter')
    })

    it('handles date-based backup', () => {
      const template = 'Backup/<YYYY>-<MM>/<SERIES_TITLE>'
      const result = expandTemplate(template, mockContext)
      
      expect(result.success).toBe(true)
      expect(result.expanded).toMatch(/^Backup\/\d{4}-\d{2}\/Hunter x Hunter$/)
    })

    it('handles site-specific folders', () => {
      const template = '<INTEGRATION_NAME>/<SERIES_TITLE>/<CHAPTER_NUMBER_PAD3>'
      const result = expandTemplate(template, mockContext)
      
      expect(result.success).toBe(true)
      expect(result.expanded).toBe('mangadex/Hunter x Hunter/001')
    })

    it('handles volume-based organization', () => {
      const template = '<SERIES_TITLE>/Volume <VOLUME_NUMBER_PAD2>/<CHAPTER_NUMBER_PAD3> - <CHAPTER_TITLE>'
      const result = expandTemplate(template, mockContext)
      
      expect(result.success).toBe(true)
      expect(result.expanded).toBe('Hunter x Hunter/Volume 01/001 - Chapter 1')
    })
  })
})

