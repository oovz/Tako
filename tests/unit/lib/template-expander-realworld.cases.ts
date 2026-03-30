import { describe, expect, it } from 'vitest'
import { expandTemplate } from '@/src/shared/template-expander'
import { useTemplateExpanderTestContext } from './template-expander-test-setup'

export function registerTemplateExpanderRealWorldCases(): void {
  describe('Template Expander', () => {
    const getMockContext = useTemplateExpanderTestContext()

    describe('Real-world Use Cases', () => {
      it('handles typical manga download path', () => {
        const template = 'TMD/<SERIES_TITLE>/<CHAPTER_NUMBER_PAD3> - <CHAPTER_TITLE>'
        const result = expandTemplate(template, getMockContext())

        expect(result.success).toBe(true)
        expect(result.expanded).toBe('TMD/Hunter x Hunter/001 - Chapter 1')
      })

      it('handles publisher-based organization', () => {
        const template = 'Manga/<PUBLISHER>/<SERIES_TITLE>'
        const result = expandTemplate(template, getMockContext())

        expect(result.success).toBe(true)
        expect(result.expanded).toBe('Manga/Weekly Shonen Jump/Hunter x Hunter')
      })

      it('handles date-based backup', () => {
        const template = 'Backup/<YYYY>-<MM>/<SERIES_TITLE>'
        const result = expandTemplate(template, getMockContext())

        expect(result.success).toBe(true)
        expect(result.expanded).toMatch(/^Backup\/\d{4}-\d{2}\/Hunter x Hunter$/)
      })

      it('handles site-specific folders', () => {
        const template = '<INTEGRATION_NAME>/<SERIES_TITLE>/<CHAPTER_NUMBER_PAD3>'
        const result = expandTemplate(template, getMockContext())

        expect(result.success).toBe(true)
        expect(result.expanded).toBe('mangadex/Hunter x Hunter/001')
      })

      it('handles volume-based organization', () => {
        const template = '<SERIES_TITLE>/Volume <VOLUME_NUMBER_PAD2>/<CHAPTER_NUMBER_PAD3> - <CHAPTER_TITLE>'
        const result = expandTemplate(template, getMockContext())

        expect(result.success).toBe(true)
        expect(result.expanded).toBe('Hunter x Hunter/Volume 01/001 - Chapter 1')
      })
    })
  })
}
