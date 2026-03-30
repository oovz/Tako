import { describe, expect, it } from 'vitest'
import { expandTemplate } from '@/src/shared/template-expander'
import { useTemplateExpanderTestContext } from './template-expander-test-setup'

export function registerTemplateExpanderExpandCases(): void {
  describe('Template Expander', () => {
    const getMockContext = useTemplateExpanderTestContext()

    describe('expandTemplate - Basic Macro Expansion', () => {
      it('expands all macros correctly', () => {
        const template = '<INTEGRATION_NAME>/<PUBLISHER>/<SERIES_TITLE>/<CHAPTER_TITLE>/<VOLUME_TITLE>/<CHAPTER_NUMBER_PAD2>/<CHAPTER_NUMBER_PAD3>/<VOLUME_NUMBER_PAD2>/<YYYY>/<MM>/<DD>'
        const result = expandTemplate(template, getMockContext())

        expect(result.success).toBe(true)
        expect(result.expanded).toContain('mangadex')
        expect(result.expanded).toContain('Weekly Shonen Jump')
        expect(result.expanded).toContain('Hunter x Hunter')
        expect(result.expanded).toContain('Chapter 1')
        expect(result.expanded).toContain('01')
        expect(result.expanded).toContain('001')
        expect(result.errors).toHaveLength(0)
      })

      it('expands site information macros', () => {
        const template = '<INTEGRATION_NAME>/<PUBLISHER>'
        const result = expandTemplate(template, getMockContext())

        expect(result.success).toBe(true)
        expect(result.expanded).toBe('mangadex/Weekly Shonen Jump')
      })

      it('expands series information macros', () => {
        const template = '<SERIES_TITLE>'
        const result = expandTemplate(template, getMockContext())

        expect(result.success).toBe(true)
        expect(result.expanded).toBe('Hunter x Hunter')
      })

      it('expands chapter information macros', () => {
        const template = '<CHAPTER_NUMBER_PAD3> - <CHAPTER_TITLE>'
        const result = expandTemplate(template, getMockContext())

        expect(result.success).toBe(true)
        expect(result.expanded).toBe('001 - Chapter 1')
      })

      it('expands volume information macros', () => {
        const template = 'Volume <VOLUME_NUMBER_PAD2> - <VOLUME_TITLE>'
        const result = expandTemplate(template, getMockContext())

        expect(result.success).toBe(true)
        expect(result.expanded).toBe('Volume 01 - Volume 1')
      })

      it('expands time macros with current values', () => {
        const template = '<YYYY>-<MM>-<DD>'
        const now = new Date()
        const result = expandTemplate(template, getMockContext())

        expect(result.success).toBe(true)
        expect(result.expanded).toContain(String(now.getFullYear()))
      })
    })

    describe('expandTemplate - Auto-padding', () => {
      it('pads chapter number to 2 digits', () => {
        const context = { ...getMockContext(), chapterNumber: 5 }
        const result = expandTemplate('<CHAPTER_NUMBER_PAD2>', context)

        expect(result.success).toBe(true)
        expect(result.expanded).toBe('05')
      })

      it('pads chapter number to 3 digits', () => {
        const context = { ...getMockContext(), chapterNumber: 5 }
        const result = expandTemplate('<CHAPTER_NUMBER_PAD3>', context)

        expect(result.success).toBe(true)
        expect(result.expanded).toBe('005')
      })

      it('pads volume number to 2 digits', () => {
        const context = { ...getMockContext(), volumeNumber: 1 }
        const result = expandTemplate('<VOLUME_NUMBER_PAD2>', context)

        expect(result.success).toBe(true)
        expect(result.expanded).toBe('01')
      })
    })

    describe('expandTemplate - Error Handling', () => {
      it('errors when critical SERIES_TITLE macro is unavailable', () => {
        const context = { ...getMockContext(), seriesTitle: undefined }
        const result = expandTemplate('<SERIES_TITLE>/<CHAPTER_TITLE>', context)

        expect(result.success).toBe(false)
        expect(result.errors).toContain('Required macros unavailable: <SERIES_TITLE>')
      })

      it('errors when critical CHAPTER_TITLE macro is unavailable', () => {
        const context = { ...getMockContext(), chapterTitle: undefined }
        const result = expandTemplate('<SERIES_TITLE>/<CHAPTER_TITLE>', context)

        expect(result.success).toBe(false)
        expect(result.errors).toContain('Required macros unavailable: <CHAPTER_TITLE>')
      })

      it('warns when optional PUBLISHER macro is unavailable', () => {
        const context = { ...getMockContext(), publisher: undefined }
        const result = expandTemplate('<SERIES_TITLE>/<PUBLISHER>', context)

        expect(result.success).toBe(true)
        expect(result.warnings).toContain('Optional macros unavailable: <PUBLISHER>')
      })

      it('warns when optional VOLUME macros are unavailable', () => {
        const context = { ...getMockContext(), volumeTitle: undefined, volumeNumber: undefined }
        const result = expandTemplate('<SERIES_TITLE>/<VOLUME_TITLE>', context)

        expect(result.success).toBe(true)
        expect(result.warnings.length).toBeGreaterThan(0)
      })

      it('errors on unknown macros', () => {
        const result = expandTemplate('<UNKNOWN_MACRO>', getMockContext())

        expect(result.success).toBe(false)
        expect(result.errors).toContain('Unknown macros in template: <UNKNOWN_MACRO>')
      })

      it('does not error for leading empty path components; warns instead', () => {
        const context = { ...getMockContext(), publisher: undefined }
        const result = expandTemplate('<PUBLISHER>/<SERIES_TITLE>', context)

        expect(result.success).toBe(true)
        expect(result.warnings).toContain('Optional macros unavailable: <PUBLISHER>')
      })
    })

    describe('expandTemplate - Character Sanitization', () => {
      it('removes invalid filesystem characters', () => {
        const context = {
          ...getMockContext(),
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
          ...getMockContext(),
          seriesTitle: 'Series\x00With\x1FControl'
        }
        const result = expandTemplate('<SERIES_TITLE>', context)

        expect(result.success).toBe(true)
        expect(result.expanded).toBe('SeriesWithControl')
      })

      it('removes trailing periods (Windows invalid)', () => {
        const context = {
          ...getMockContext(),
          seriesTitle: 'Series Name.'
        }
        const result = expandTemplate('<SERIES_TITLE>', context)

        expect(result.success).toBe(true)
        expect(result.expanded).not.toMatch(/\.$/)
      })

      it('removes leading periods', () => {
        const context = {
          ...getMockContext(),
          seriesTitle: '.Hidden Series'
        }
        const result = expandTemplate('<SERIES_TITLE>', context)

        expect(result.success).toBe(true)
        expect(result.expanded).not.toMatch(/^\./)
      })
    })
  })
}
