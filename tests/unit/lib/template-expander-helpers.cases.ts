import { describe, expect, it } from 'vitest'
import { createMockContext, getCurrentTimeValues, validateTemplate } from '@/src/shared/template-expander'

export function registerTemplateExpanderHelperCases(): void {
  describe('Template Expander', () => {
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
  })
}
