import { describe, expect, it } from 'vitest'

import { parseChapterNumber, parseVolumeInfo, sanitizeLabel } from '@/src/shared/site-integration-utils'

describe('site integration utils', () => {
  describe('sanitizeLabel', () => {
    it('removes control characters and normalizes whitespace', () => {
      const input = '  Chapter\u0000\u0007   12\n\tSpecial  '
      expect(sanitizeLabel(input)).toBe('Chapter 12 Special')
    })
  })

  describe('parseChapterNumber', () => {
    it('extracts decimal chapter numbers from labels', () => {
      expect(parseChapterNumber('Chapter 12.5 - Bonus')).toBe(12.5)
    })

    it('extracts chapter numbers from full-width numerals', () => {
      expect(parseChapterNumber('第１話')).toBe(1)
    })

    it('returns undefined for labels without numeric value', () => {
      expect(parseChapterNumber('Extra chapter')).toBeUndefined()
    })
  })

  describe('parseVolumeInfo', () => {
    it('parses volume number and keeps normalized label', () => {
      expect(parseVolumeInfo('  Vol. 03  ')).toEqual({
        volumeLabel: 'Vol. 03',
        volumeNumber: 3,
      })
    })

    it('parses full-width volume numerals and keeps normalized label', () => {
      expect(parseVolumeInfo('第３巻')).toEqual({
        volumeLabel: '第３巻',
        volumeNumber: 3,
      })
    })

    it('returns only volumeLabel when no numeric volume is present', () => {
      expect(parseVolumeInfo('Special Edition')).toEqual({ volumeLabel: 'Special Edition' })
    })
  })
})

